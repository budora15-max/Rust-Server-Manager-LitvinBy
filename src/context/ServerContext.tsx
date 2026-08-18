import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RustServer } from '@/types';
import i18n from '@/i18n';

const STORAGE_KEY = 'rsm.servers';

// Демо-серверы убраны: в продакшн-режиме фейковые «онлайн» серверы с игроками
// вводят пользователя в заблуждение. Первый запуск встречает пустым списком.
const DEFAULT_SERVERS: RustServer[] = [];

/** Генерация безопасного RCON-пароля: Rust отключает RCON для слабых/известных паролей. */
function generateRconPassword(): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 14; i++) {
    const rand =
      typeof crypto !== 'undefined' && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0]
        : Math.floor(Math.random() * 0xffffffff);
    out += chars[rand % chars.length];
  }
  return out;
}

interface ServerContextValue {
  servers: RustServer[];
  getServer: (id: string | undefined) => RustServer | undefined;
  startServer: (id: string) => void;
  stopServer: (id: string) => void;
  restartServer: (id: string) => void;
  updateServer: (id: string, patch: Partial<RustServer>) => void;
  addServer: (input: NewServerInput) => string;
  removeServer: (id: string) => void;
}

export interface NewServerInput {
  name: string;
  identity: string;
  gamemode?: string;
  port?: number;
  maxPlayers?: number;
  seed?: number;
  worldSize?: number;
  map?: string;
  rconPassword?: string;
}

const ServerContext = createContext<ServerContextValue | null>(null);

function loadInitial(): RustServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RustServer[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Миграция старых демо-данных: сервер без installPath не может быть реально online.
        return parsed.map((s) =>
          !s.installPath && (s.status === 'online' || s.status === 'sim')
            ? { ...s, status: 'offline' as const, onlinePlayers: 0, cpu: 0, lastError: undefined }
            : s
        );
      }
    }
  } catch {
    // повреждённые данные — используем дефолты
  }
  return DEFAULT_SERVERS;
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<RustServer[]>(loadInitial);

  // Актуальный список для эффектов (избегаем пересоздания при каждом рендере)
  const serversRef = useRef(servers);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  }, [servers]);

  // Актуальный список серверов для main-процесса (трей / автозапуск серверов).
  useEffect(() => {
    window.rustManager?.syncServers(servers);
  }, [servers]);

  // Базовый подсчёт плагинов (installedPlugins) для карточек и «Свойств сервера»
  // при старте менеджера — чтобы не показывать 0 при реально установленных плагинах.
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge) return;
    let stale = false;
    void (async () => {
      for (const s of serversRef.current) {
        if (!s.installPath) continue;
        try {
          const res = await bridge.pluginsList(s);
          if (!stale && res?.ok && Array.isArray(res.plugins) && s.installedPlugins !== res.plugins.length) {
            const count = res.plugins.length;
            setServers((prev) =>
              prev.map((x) =>
                x.id === s.id && x.installedPlugins !== count ? { ...x, installedPlugins: count } : x
              )
            );
          }
        } catch {
          // IPC недоступен (браузерное демо) — пропускаем
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, []);

  const setStatus = (id: string, status: RustServer['status']) =>
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));

  const setServerError = (id: string, error?: string) =>
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, lastError: error } : s)));

  /** PID внешнего процесса (запущен вне менеджера) — чтобы кнопка «Остановить» работала. */
  const setExternalPid = (id: string, pid?: number) =>
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, externalPid: pid } : s)));

  const delaySetStatus = (id: string, status: RustServer['status'], ms: number) =>
    setTimeout(() => setStatus(id, status), ms);

  // После перезапуска менеджера PID процессов не переносятся между сессиями.
  // Сверяем сохранённые статусы с реальным состоянием в main-процессе и в ОС:
  // «online»/«sim» из прошлой сессии без запущенного процесса — это ложь.
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge) return;
    let cancelled = false;
    (async () => {
      const list = serversRef.current;
      for (const s of list) {
        if (s.status === 'offline' || s.status === 'crashed') continue;
        try {
          const st = await bridge.serverStatus(s.id);
          if (cancelled) return;
          if (st.running) {
            setStatus(s.id, 'online');
            if (st.pid) setExternalPid(s.id, st.pid);
            continue;
          }
          // Менеджер не знает процесс — проверяем ОС: сервер мог быть запущен
          // вне менеджера или в прошлой сессии менеджера.
          if (!s.installPath) {
            setStatus(s.id, 'offline');
            continue;
          }
          const ext = await bridge.serverDetectExternal([s]);
          if (cancelled) return;
          if (ext[s.id]) {
            setExternalPid(s.id, ext[s.id]);
            setStatus(s.id, 'online');
          } else {
            setStatus(s.id, 'offline');
          }
        } catch {
          // IPC недоступен — оставляем прежний статус
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Неожиданное завершение процесса (закрыто окно сервера, краш и т.п.) —
  // обновляем статус сразу, не дожидаясь перезапуска менеджера.
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.onServerProcessExit) return;
    return bridge.onServerProcessExit((event) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === event.serverId
            ? {
                ...s,
                status: 'crashed',
                lastError:
                  event.code === null
                    ? i18n.t('serverPage.processExited')
                    : i18n.t('serverPage.processExitedCode', { code: event.code }),
              }
            : s
        )
      );
    });
  }, []);

  // Watchdog: менеджер сам перезапускает сервер после падения/зависания.
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.onServerAutoRestart) return;
    return bridge.onServerAutoRestart((event) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === event.serverId
            ? { ...s, status: 'starting', lastError: undefined }
            : s
        )
      );
      pollUntilRunning(event.serverId, 30);
    });
  }, []);

  // Процесс реально запущен (обычный старт или авторестарт watchdog).
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.onServerProcessRunning) return;
    return bridge.onServerProcessRunning((event) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === event.serverId
            ? { ...s, status: 'online', lastError: undefined, externalPid: undefined }
            : s
        )
      );
    });
  }, []);

  const pollUntilRunning = (id: string, attempts: number) => {
    if (attempts <= 0) {
      setStatus(id, 'crashed');
      return;
    }
    window.rustManager
      ?.serverStatus(id)
      .then((st) => {
        if (st.running) setStatus(id, 'online');
        else setTimeout(() => pollUntilRunning(id, attempts - 1), 2000);
      })
      .catch(() => setStatus(id, 'crashed'));
  };

  const pollUntilStopped = (id: string, attempts: number) => {
    if (attempts <= 0) {
      setStatus(id, 'offline');
      return;
    }
    window.rustManager
      ?.serverStatus(id)
      .then((st) => {
        if (!st.running) setStatus(id, 'offline');
        else setTimeout(() => pollUntilStopped(id, attempts - 1), 2000);
      })
      .catch(() => setStatus(id, 'offline'));
  };

  const startServer = (id: string) => {
    setStatus(id, 'starting');
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    if (window.rustManager) {
      window.rustManager
        .serverStart(server)
        .then((res) => {
          if (res.success && res.mode === 'real') {
            setServerError(id, undefined);
            setExternalPid(id, undefined);
            pollUntilRunning(id, 20);
          } else if (res.success && res.mode === 'sim') {
            // Симуляция: процесс не запущен — показываем честный статус вместо «Online».
            setServerError(
              id,
              i18n.t('serverPage.simModeDetail', {
                path: server.installPath || '—',
                exes: 'RustDedicatedServer.exe / RustDedicated.exe',
              })
            );
            setStatus(id, 'sim');
          } else {
            setServerError(
              id,
              i18n.t('serverPage.startFailed', { error: res.error ?? 'Unknown error' })
            );
            setStatus(id, 'crashed');
          }
        })
        .catch(() => {
          setServerError(id, i18n.t('serverPage.startFailed', { error: i18n.t('serverPage.managerUnreachable') }));
          setStatus(id, 'crashed');
        });
    } else {
      setServerError(id, 'Browser demo — simulated start.');
      delaySetStatus(id, 'sim', 1200);
    }
  };

  const stopServer = (id: string) => {
    setStatus(id, 'stopping');
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    if (window.rustManager) {
      window.rustManager
        .serverStop(server)
        .then((res) => {
          if (res.success && res.mode === 'real') {
            setExternalPid(id, undefined);
            pollUntilStopped(id, 10);
          } else {
            setServerError(id, undefined);
            setStatus(id, 'offline');
          }
        })
        .catch(() => setStatus(id, 'offline'));
    } else {
      setServerError(id, undefined);
      delaySetStatus(id, 'offline', 1200);
    }
  };

  const restartServer = (id: string) => {
    setStatus(id, 'stopping');
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    if (window.rustManager) {
      window.rustManager
        .serverRestart(server)
        .then((res) => {
          if (res.success && res.mode === 'real') {
            setServerError(id, undefined);
            pollUntilRunning(id, 25);
          } else if (res.success && res.mode === 'sim') {
            setServerError(id, res.error);
            delaySetStatus(id, 'sim', 1200);
          } else {
            setServerError(
              id,
              i18n.t('serverPage.startFailed', { error: res.error ?? 'Unknown error' })
            );
            setStatus(id, 'crashed');
          }
        })
        .catch(() => {
          setServerError(id, i18n.t('serverPage.startFailed', { error: i18n.t('serverPage.managerUnreachable') }));
          setStatus(id, 'crashed');
        });
    } else {
      setServerError(id, 'Browser demo — simulated restart.');
      delaySetStatus(id, 'sim', 1200);
    }
  };

  // Автозапуск серверов с флагом startWithManager (один раз при старте менеджера).
  const autoStartTriedRef = useRef(false);
  const startServerRef = useRef(startServer);
  useEffect(() => {
    startServerRef.current = startServer;
  });

  useEffect(() => {
    if (autoStartTriedRef.current) return;
    autoStartTriedRef.current = true;
    if (!window.rustManager) return;
    const timer = setTimeout(() => {
      for (const s of serversRef.current) {
        if (!s.startWithManager) continue;
        if (s.status === 'online' || s.status === 'starting' || s.status === 'sim') continue;
        startServerRef.current(s.id);
      }
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateServer = (id: string, patch: Partial<RustServer>) =>
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  /** Добавление нового сервера в менеджер (с дефолтными значениями). */
  const addServer = (input: NewServerInput): string => {
    const port = input.port ?? 28015;
    const server: RustServer = {
      id: `srv_${Date.now()}`,
      name: input.name.trim() || 'Unnamed Server',
      identity: input.identity.trim() || 'server',
      gamemode: input.gamemode?.trim() || '',
      status: 'offline',
      onlinePlayers: 0,
      maxPlayers: input.maxPlayers ?? 100,
      cpu: 0,
      ram: 0,
      seed: input.seed ?? Math.floor(Math.random() * 2_147_483_647) + 1,
      worldSize: input.worldSize ?? 4000,
      port,
      rconPassword: input.rconPassword ?? generateRconPassword(),
      map: input.map?.trim() || 'Procedural Map',
      uptimeSeconds: 0,
      installedPlugins: 0,
      installPath: '',
      rconHost: '127.0.0.1',
      rconPort: port + 2,
      tickrate: 30,
      queryport: port + 1,
      password: '',
      eac: true,
      steamBetaBranch: '',
      autoRestartOnCrash: true,
      autoRestartOnHang: false,
      hangTimeoutMinutes: 10,
    };
    setServers((prev) => [...prev, server]);
    return server.id;
  };

  /** Удаление сервера из менеджера (файлы на диске не затрагиваются). */
  const removeServer = (id: string) =>
    setServers((prev) => prev.filter((s) => s.id !== id));

  const getServer = (id: string | undefined) => servers.find((s) => s.id === id);

  const value = useMemo<ServerContextValue>(
    () => ({ servers, getServer, startServer, stopServer, restartServer, updateServer, addServer, removeServer }),
    [servers]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServer must be used within ServerProvider');
  return ctx;
}
