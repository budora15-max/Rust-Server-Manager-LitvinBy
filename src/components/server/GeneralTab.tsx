import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, FileCode2, FolderOpen, Gamepad2, HardDrive, Info, KeyRound, Map as MapIcon, RefreshCw, Save, ShieldAlert, Tag, Upload } from 'lucide-react';
import type { RustServer, ServerConfigResult } from '@/types';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { formatUptime } from '@/lib/utils';

/** Пароли, которые Rust считает «очень небезопасными» и полностью отключает RCON. */
const INSECURE_RCON_PASSWORDS = ['changeme', 'password', '123456', 'admin', 'qwerty', 'test', 'server', 'rust'];

const isInsecureRconPassword = (p: string): boolean =>
  p.length < 8 || INSECURE_RCON_PASSWORDS.includes(p.toLowerCase().trim());

/** Значение конвара gamemode для записи в server.cfg (пусто = обычный Vanilla). */
const cfgGamemode = (g: string): string => {
  const v = g.trim();
  return v ? v : '""';
};

/** Чтение gamemode из server.cfg: убираем кавычки пустого значения `""`. */
const normalizeGamemode = (v?: string): string => (v || '').trim().replace(/^"+|"+$/g, '');

/** Путь к папке сохранений сервера: <installPath>/server/<identity>. */
function serverIdentityPath(installPath: string, identity: string): string {
  const base = installPath.trim().replace(/[\\/]+$/, '');
  return `${base ? `${base}/` : ''}server/${identity.trim() || '<identity>'}`;
}

/** Доступные теги сервера (server.tags), максимум 3. */
const SERVER_TAGS = ['pve', 'roleplay', 'creative', 'minigame', 'training', 'battlefield', 'broyale', 'builds'] as const;

/** Частота вайпов как тег (часть server.tags). */
const WIPE_FREQUENCY_TAGS = ['weekly', 'biweekly', 'monthly'] as const;

/** Регион как тег (часть server.tags). */
const REGION_TAGS = ['eu', 'na', 'ru', 'sa', 'as', 'oc', 'af'] as const;

/** Пустую строку пишем как `""` — так Rust очищает предыдущее значение конвара. */
const cfgStr = (v?: string): string => (v ?? '').trim() || '""';

/** Чтение строки из server.cfg: кавычки `""` → пустая строка. */
const readCfgStr = (v?: string): string => (v ?? '').replace(/^"+|"+$/g, '');

/** Многострочное описание → одна строка с литеральными \n для server.cfg. */
const cfgDescription = (v: string): string => (v ?? '').replace(/\r?\n/g, '\\n');

/** Из server.cfg: литеральные \n → переносы строк для textarea. */
const readDescription = (v?: string): string => (v ?? '').replace(/\\n/g, '\n');

/** server.tags из server.cfg → массив тегов. */
const readTags = (v?: string): string[] =>
  (v ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/** Разбор server.tags: контентные теги (≤3) + частота вайпов + регион. */
function splitTags(cfgTags?: string): { tags: string[]; wipeFrequencyTag: string; regionTag: string } {
  const all = readTags(cfgTags);
  const wipe = all.find((t) => (WIPE_FREQUENCY_TAGS as readonly string[]).includes(t)) ?? '';
  const region = all.find((t) => (REGION_TAGS as readonly string[]).includes(t)) ?? '';
  const content = all.filter((t) => t !== wipe && t !== region);
  return { tags: content.slice(0, 3), wipeFrequencyTag: wipe, regionTag: region };
}

/** Теги → строка для server.cfg (контент + частота вайпов + регион, через запятую). */
function tagsToCfg(tags: string[], wipeFrequencyTag: string, regionTag: string): string {
  return [...tags, wipeFrequencyTag, regionTag].filter(Boolean).join(',');
}

/** Проверка URL (http/https). */
const isValidHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

interface GeneralTabProps {
  server: RustServer;
  onSave: (patch: Partial<RustServer>) => void;
}

interface GeneralForm {
  identity: string;
  gamemode: string;
  name: string;
  level: string;
  levelurl: string;
  description: string;
  url: string;
  headerImage: string;
  logoImage: string;
  tags: string[];
  wipeFrequencyTag: string;
  regionTag: string;
  saveInterval: string;
  additionalArgs: string;
  tickrate: string;
  queryport: string;
  password: string;
  steamBetaBranch: string;
  seed: string;
  worldSize: string;
  port: string;
  maxPlayers: string;
  rconPassword: string;
  installPath: string;
  rconHost: string;
  rconPort: string;
  autoRestartOnCrash: boolean;
  autoRestartOnHang: boolean;
  hangTimeoutMinutes: string;
  startWithManager: boolean;
  autoUpdateOnRestart: boolean;
  eac: boolean;
}

export function GeneralTab({ server, onSave }: GeneralTabProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<GeneralForm>({
    identity: server.identity,
    gamemode: server.gamemode ?? '',
    name: server.name,
    level: server.map || 'Procedural Map',
    levelurl: server.levelurl ?? '',
    description: server.description ?? '',
    url: server.url ?? '',
    headerImage: server.headerImage ?? '',
    logoImage: server.logoImage ?? '',
    tags: server.tags ?? [],
    wipeFrequencyTag: server.wipeFrequencyTag ?? '',
    regionTag: server.regionTag ?? '',
    saveInterval: String(server.saveInterval ?? 300),
    additionalArgs: server.additionalArgs ?? '',
    tickrate: String(server.tickrate ?? 30),
    queryport: String(server.queryport ?? server.port + 1),
    password: server.password ?? '',
    steamBetaBranch: server.steamBetaBranch ?? '',
    seed: String(server.seed),
    worldSize: String(server.worldSize),
    port: String(server.port),
    maxPlayers: String(server.maxPlayers),
    rconPassword: server.rconPassword,
    installPath: server.installPath,
    rconHost: server.rconHost,
    rconPort: String(server.rconPort),
    autoRestartOnCrash: server.autoRestartOnCrash !== false,
    autoRestartOnHang: server.autoRestartOnHang === true,
    hangTimeoutMinutes: String(server.hangTimeoutMinutes || 10),
    startWithManager: server.startWithManager === true,
    autoUpdateOnRestart: server.autoUpdateOnRestart === true,
    eac: server.eac !== false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof GeneralForm, string>>>({});
  const [saved, setSaved] = useState(false);
  const [configInfo, setConfigInfo] = useState<ServerConfigResult | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [pathCheck, setPathCheck] = useState<
    { state: 'idle' | 'checking' | 'ok' | 'bad'; exe?: string } | undefined
  >(undefined);

  const set = (key: keyof GeneralForm) => (value: string) => {
    // При смене игрового порта автоматически сдвигаем RCON-порт (игра + 2),
    // если он ещё не был изменён пользователем вручную.
    if (key === 'port') {
      const oldPort = Number(form.port);
      const newPort = Number(value);
      if (newPort > 0) {
        const patch: Partial<GeneralForm> = { port: value };
        if (form.rconPort === String(oldPort + 2)) patch.rconPort = String(newPort + 2);
        if (form.queryport === String(oldPort + 1)) patch.queryport = String(newPort + 1);
        if (Object.keys(patch).length > 1) {
          setForm((prev) => ({ ...prev, ...patch }));
          setErrors((prev) => ({ ...prev, port: undefined, rconPort: undefined, queryport: undefined }));
          setSaved(false);
          return;
        }
      }
    }
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSaved(false);
  };

  const setBool =
    (key: 'autoRestartOnCrash' | 'autoRestartOnHang' | 'startWithManager' | 'autoUpdateOnRestart' | 'eac') =>
    (value: boolean) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    };

  const browseInstallPath = async () => {
    const picked = await window.rustManager?.pickFolder();
    if (picked) set('installPath')(picked);
  };

  /** Применение импортированного сервера к форме. */
  const applyServer = (s: RustServer) => {
    setForm({
      identity: s.identity,
      gamemode: s.gamemode ?? '',
      name: s.name,
      level: s.map || 'Procedural Map',
      levelurl: s.levelurl ?? '',
      description: s.description ?? '',
      url: s.url ?? '',
      headerImage: s.headerImage ?? '',
      logoImage: s.logoImage ?? '',
      tags: s.tags ?? [],
      wipeFrequencyTag: s.wipeFrequencyTag ?? '',
      regionTag: s.regionTag ?? '',
      saveInterval: String(s.saveInterval ?? 300),
      additionalArgs: s.additionalArgs ?? '',
      tickrate: String(s.tickrate ?? 30),
      queryport: String(s.queryport ?? s.port + 1),
      password: s.password ?? '',
      steamBetaBranch: s.steamBetaBranch ?? '',
      seed: String(s.seed),
      worldSize: String(s.worldSize),
      port: String(s.port),
      maxPlayers: String(s.maxPlayers),
      rconPassword: s.rconPassword,
      installPath: s.installPath,
      rconHost: s.rconHost,
      rconPort: String(s.rconPort),
      autoRestartOnCrash: s.autoRestartOnCrash !== false,
      autoRestartOnHang: s.autoRestartOnHang === true,
      hangTimeoutMinutes: String(s.hangTimeoutMinutes || 10),
      startWithManager: s.startWithManager === true,
      autoUpdateOnRestart: s.autoUpdateOnRestart === true,
      eac: s.eac !== false,
    });
  };

  const doExportConfig = async () => {
    const bridge = window.rustManager;
    if (!bridge) return;
    try {
      const res = await bridge.serverExportConfig(server);
      if (res.ok && res.path) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: t('general.exportedTo', { path: res.path }),
        }));
      } else if (!res.canceled) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.error ?? t('general.exportFailed'),
        }));
      }
    } catch {
      // IPC недоступен
    }
  };

  const doImportConfig = async () => {
    const bridge = window.rustManager;
    if (!bridge) return;
    try {
      const res = await bridge.serverImportConfig(server);
      if (res.ok && res.server) {
        onSave(res.server);
        applyServer(res.server);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        void loadConfig(true);
      } else if (!res.canceled) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.error ?? t('general.importFailed'),
        }));
      }
    } catch {
      // IPC недоступен
    }
  };

  // Чтение/заполнение формы из server.cfg
  const loadConfig = async (silent = false) => {
    const bridge = window.rustManager;
    if (!bridge) return;
    if (!silent) setConfigBusy(true);
    try {
      const res = await bridge.configRead(server);
      setConfigInfo(res);
      if (res.ok) {
        const parsedTags = splitTags(res.config['server.tags']);
        setForm((prev) => ({
          ...prev,
          identity: res.config['server.identity'] ?? prev.identity,
          gamemode: normalizeGamemode(res.config['gamemode']) ?? prev.gamemode,
          name: res.config['server.name'] ? readCfgStr(res.config['server.name']) : prev.name,
          level: res.config['server.level'] ? readCfgStr(res.config['server.level']) : prev.level,
          levelurl: readCfgStr(res.config['server.levelurl']),
          description: readDescription(readCfgStr(res.config['server.description'])),
          url: readCfgStr(res.config['server.url']),
          headerImage: readCfgStr(res.config['server.headerimage']),
          logoImage: readCfgStr(res.config['server.logoimage']),
          tags: res.config['server.tags'] !== undefined ? parsedTags.tags : prev.tags,
          wipeFrequencyTag:
            res.config['server.tags'] !== undefined ? parsedTags.wipeFrequencyTag : prev.wipeFrequencyTag,
          regionTag: res.config['server.tags'] !== undefined ? parsedTags.regionTag : prev.regionTag,
          saveInterval: res.config['server.saveinterval'] ?? prev.saveInterval,
          tickrate: res.config['server.tickrate'] ?? prev.tickrate,
          queryport: res.config['server.queryport'] ?? prev.queryport,
          password: readCfgStr(res.config['server.password']),
          eac: res.config['server.eac'] !== undefined ? res.config['server.eac'] !== '0' : prev.eac,
          seed: res.config['server.seed'] ?? prev.seed,
          worldSize: res.config['server.worldsize'] ?? prev.worldSize,
          port: res.config['server.port'] ?? prev.port,
          maxPlayers: res.config['server.maxplayers'] ?? prev.maxPlayers,
          rconPassword: res.config['rcon.password'] ?? prev.rconPassword,
          rconPort: res.config['rcon.port'] ?? prev.rconPort,
        }));
      }
    } catch {
      setConfigInfo({
        ok: false,
        exists: false,
        path: '',
        config: {},
        rawLines: [],
        message: 'Failed to read server.cfg.',
      });
    } finally {
      setConfigBusy(false);
    }
  };

  useEffect(() => {
    loadConfig(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Проверка наличия исполняемого файла сервера в указанной папке
  useEffect(() => {
    const path = form.installPath.trim();
    const bridge = window.rustManager;
    if (!path || !bridge?.serverFindExe) {
      setPathCheck(undefined);
      return;
    }
    let stale = false;
    setPathCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await bridge.serverFindExe(path);
        if (!stale) {
          setPathCheck(res.found ? { state: 'ok', exe: res.exePath } : { state: 'bad' });
        }
      } catch {
        if (!stale) setPathCheck(undefined);
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [form.installPath]);

  /** Переключение тега сервера (максимум 3). */
  const toggleTag = (tag: string) => {
    setForm((prev) => {
      if (prev.tags.includes(tag)) return { ...prev, tags: prev.tags.filter((x) => x !== tag) };
      if (prev.tags.length >= 3) return prev; // максимум 3 тега
      return { ...prev, tags: [...prev.tags, tag] };
    });
    setSaved(false);
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof GeneralForm, string>> = {};

    if (!form.name.trim()) next.name = t('general.errors.nameRequired');
    else {
      const hasCyrillic = /[а-яё]/i.test(form.name);
      const limit = hasCyrillic ? 32 : 64;
      if (form.name.trim().length > limit) next.name = t('general.errors.nameTooLong', { limit });
    }

    if (!form.identity.trim()) next.identity = t('general.errors.identityRequired');

    const seed = Number(form.seed);
    if (!form.seed || !Number.isInteger(seed) || seed <= 0)
      next.seed = t('general.errors.seedInvalid');

    const worldSize = Number(form.worldSize);
    if (!form.worldSize || !Number.isInteger(worldSize) || worldSize < 1000 || worldSize > 6000)
      next.worldSize = t('general.errors.worldSizeInvalid');

    const port = Number(form.port);
    if (!form.port || !Number.isInteger(port) || port < 1024 || port > 65535)
      next.port = t('general.errors.portInvalid');

    const tickrate = Number(form.tickrate);
    if (!form.tickrate || !Number.isInteger(tickrate) || tickrate < 10 || tickrate > 100)
      next.tickrate = t('general.errors.tickrateInvalid');

    const queryport = Number(form.queryport);
    if (!form.queryport || !Number.isInteger(queryport) || queryport < 1024 || queryport > 65535)
      next.queryport = t('general.errors.queryportInvalid');

    const maxPlayers = Number(form.maxPlayers);
    if (!form.maxPlayers || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 500)
      next.maxPlayers = t('general.errors.maxPlayersInvalid');

    if (form.rconPassword.length < 8) next.rconPassword = t('general.errors.rconPasswordMin');
    else if (!/^[A-Za-z0-9_.\-]*$/.test(form.rconPassword))
      next.rconPassword = t('general.errors.rconPasswordChars');

    if (!form.rconHost.trim()) next.rconHost = t('general.errors.rconHostRequired');

    const rconPort = Number(form.rconPort);
    if (!form.rconPort || !Number.isInteger(rconPort) || rconPort < 1 || rconPort > 65535)
      next.rconPort = t('general.errors.rconPortInvalid');

    const hangMin = Number(form.hangTimeoutMinutes);
    if (!form.hangTimeoutMinutes || !Number.isInteger(hangMin) || hangMin < 1 || hangMin > 120)
      next.hangTimeoutMinutes = t('general.errors.hangTimeoutInvalid');

    if (form.levelurl.trim() && !isValidHttpUrl(form.levelurl.trim()))
      next.levelurl = t('general.errors.urlInvalid');
    if (form.url.trim() && !isValidHttpUrl(form.url.trim())) next.url = t('general.errors.urlInvalid');
    if (form.headerImage.trim() && !isValidHttpUrl(form.headerImage.trim()))
      next.headerImage = t('general.errors.urlInvalid');
    if (form.logoImage.trim() && !isValidHttpUrl(form.logoImage.trim()))
      next.logoImage = t('general.errors.urlInvalid');

    const saveInterval = Number(form.saveInterval);
    if (!form.saveInterval || !Number.isInteger(saveInterval) || saveInterval < 30 || saveInterval > 3600)
      next.saveInterval = t('general.errors.saveIntervalInvalid');

    if (form.tags.length > 3) next.tags = t('general.errors.tooManyTags');

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      identity: form.identity.trim(),
      gamemode: form.gamemode.trim(),
      name: form.name.trim(),
      map: form.level.trim(),
      levelurl: form.levelurl.trim(),
      tags: form.tags,
      wipeFrequencyTag: form.wipeFrequencyTag,
      regionTag: form.regionTag,
      description: form.description,
      url: form.url.trim(),
      headerImage: form.headerImage.trim(),
      logoImage: form.logoImage.trim(),
      saveInterval: Number(form.saveInterval) || 300,
      additionalArgs: form.additionalArgs.trim(),
      tickrate: Number(form.tickrate) || 30,
      queryport: Number(form.queryport) || Number(form.port) + 1,
      password: form.password,
      eac: form.eac,
      steamBetaBranch: form.steamBetaBranch.trim(),
      autoUpdateOnRestart: form.autoUpdateOnRestart,
      seed: Number(form.seed),
      worldSize: Number(form.worldSize),
      port: Number(form.port),
      maxPlayers: Number(form.maxPlayers),
      rconPassword: form.rconPassword,
      installPath: form.installPath.trim(),
      rconHost: form.rconHost.trim(),
      rconPort: Number(form.rconPort),
      autoRestartOnCrash: form.autoRestartOnCrash,
      autoRestartOnHang: form.autoRestartOnHang,
      hangTimeoutMinutes: Number(form.hangTimeoutMinutes) || 10,
      startWithManager: form.startWithManager,
    });

    // Дублируем ключевые настройки в server.cfg
    if (window.rustManager) {
      const cfg: Record<string, string> = {
        'server.identity': form.identity.trim(),
        'gamemode': cfgGamemode(form.gamemode),
        'server.name': cfgStr(form.name),
        'server.description': cfgDescription(form.description),
        'server.level': form.level.trim(),
        'server.levelurl': cfgStr(form.levelurl),
        'server.tags': tagsToCfg(form.tags, form.wipeFrequencyTag, form.regionTag),
        'server.url': cfgStr(form.url),
        'server.headerimage': cfgStr(form.headerImage),
        'server.logoimage': cfgStr(form.logoImage),
        'server.saveinterval': form.saveInterval.trim() || '300',
        'server.tickrate': form.tickrate.trim() || '30',
        'server.queryport': form.queryport.trim() || String(Number(form.port) + 1),
        'server.password': cfgStr(form.password),
        'server.eac': form.eac ? '1' : '0',
        'server.seed': form.seed.trim(),
        'server.worldsize': form.worldSize.trim(),
        'server.port': form.port.trim(),
        'server.maxplayers': form.maxPlayers.trim(),
        'rcon.password': form.rconPassword,
        'rcon.port': form.rconPort.trim(),
      };
      window.rustManager.configSave(server, cfg).then((res) => {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.ok
            ? t('general.savedTo', { path: res.path || '' })
            : t('general.saveFailed', { error: res.error }),
        }));
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const configLabel = configInfo
    ? configInfo.ok
      ? configInfo.message ?? t('general.settingsLoaded', { count: Object.keys(configInfo.config).length })
      : configInfo.message ?? t('general.unavailable')
    : t('general.notLoaded');

  const gamemodeLabel = (value?: string) =>
    value ? t(`general.gamemodes.${value}`, { defaultValue: value }) : t('general.gamemodes.none');

  const info = [
    { label: t('general.gamemodeLabel'), value: gamemodeLabel(server.gamemode) },
    { label: t('general.map'), value: server.map },
    { label: t('general.seed'), value: String(server.seed) },
    { label: t('general.worldSize'), value: String(server.worldSize) },
    { label: t('general.port'), value: String(server.port) },
    { label: t('general.rconPort'), value: String(server.rconPort) },
    { label: t('general.rconHost'), value: server.rconHost || '127.0.0.1' },
    { label: t('general.uptime'), value: formatUptime(server.uptimeSeconds) },
    { label: t('general.plugins'), value: String(server.installedPlugins) },
  ];

  return (
    <div>
      {/* Статус server.cfg */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileCode2 className="h-4 w-4 shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-textMain">{t('general.cfgStatus')}</span>
          <span className="truncate text-textMuted">
            {configBusy ? t('general.reading') : configLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {configInfo?.path && (
            <span className="hidden max-w-xs truncate font-mono text-xs text-textMuted lg:inline">
              {configInfo.path}
            </span>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={() => void doExportConfig()}>
            <Download className="h-3.5 w-3.5" /> {t('general.exportConfig')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void doImportConfig()}>
            <Upload className="h-3.5 w-3.5" /> {t('general.importConfig')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => loadConfig(false)} disabled={configBusy}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('general.reload')}
          </Button>
        </div>
      </div>

      <div className="grid max-w-5xl gap-4 lg:grid-cols-3">
      {/* Текущие параметры сервера */}
      <div className="rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <HardDrive className="h-4 w-4 text-accent" /> {t('general.properties')}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {info.map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-[#1a1e26] p-3">
              <p className="text-xs text-textMuted">{label}</p>
              <p className="mt-0.5 truncate font-semibold text-textMain">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Форма конфигурации */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[#232833] bg-surface p-5 lg:col-span-2"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <KeyRound className="h-4 w-4 text-accent" /> {t('general.configuration')}
        </div>

        {/* Раздел «Server gamemode & identity» */}
        <div className="mt-4 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
              <Gamepad2 className="h-4 w-4 text-accent" /> {t('general.gamemodeIdentityTitle')}
            </div>
            <span className="font-mono text-xs text-textMuted">gamemode · server.identity</span>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="server-gamemode" className="mb-1.5 block text-sm font-medium text-textMain">
                {t('general.gamemodeLabel')}
              </label>
              <select
                id="server-gamemode"
                value={form.gamemode}
                onChange={(e) => set('gamemode')(e.target.value)}
                className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors hover:border-[#3a4150] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              >
                <option value="">{t('general.gamemodes.none')}</option>
                <option value="softcore">{t('general.gamemodes.softcore')}</option>
                <option value="hardcore">{t('general.gamemodes.hardcore')}</option>
                <option value="primitive">{t('general.gamemodes.primitive')}</option>
              </select>
              <p className="mt-1.5 text-xs text-textMuted">{t('general.gamemodeHint')}</p>
            </div>
            <div>
              <Input
                label={t('general.identityLabel')}
                hint={t('general.identityHint')}
                value={form.identity}
                onChange={(e) => set('identity')(e.target.value)}
                error={errors.identity}
              />
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-textMuted">
                <FolderOpen className="h-3 w-3 shrink-0" />
                {t('general.identityPath')}: {serverIdentityPath(form.installPath, form.identity)}
              </p>
            </div>
          </div>
        </div>

        {/* Информация о сервере */}
        <div className="mt-4 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <Info className="h-4 w-4 text-accent" /> {t('general.serverInfoTitle')}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input
              label={t('general.nameLabel')}
              hint={t('general.nameHint')}
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              error={errors.name}
            />
            <Input
              label={t('general.urlLabel')}
              hint={t('general.urlHint')}
              value={form.url}
              onChange={(e) => set('url')(e.target.value)}
              error={errors.url}
            />
            <Input
              label={t('general.headerImageLabel')}
              hint={t('general.headerImageHint')}
              value={form.headerImage}
              onChange={(e) => set('headerImage')(e.target.value)}
              error={errors.headerImage}
            />
            <Input
              label={t('general.logoImageLabel')}
              hint={t('general.logoImageHint')}
              value={form.logoImage}
              onChange={(e) => set('logoImage')(e.target.value)}
              error={errors.logoImage}
            />
            <div className="sm:col-span-2">
              <label htmlFor="server-description" className="mb-1.5 block text-sm font-medium text-textMain">
                {t('general.descriptionLabel')}
              </label>
              <textarea
                id="server-description"
                rows={3}
                value={form.description}
                onChange={(e) => set('description')(e.target.value)}
                placeholder={t('general.descriptionPlaceholder')}
                className="w-full rounded-lg border border-[#2a2f3a] bg-[#0f1115] px-3 py-2 text-sm text-textMain transition-colors hover:border-[#3a4150] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
              <p className="mt-1.5 text-xs text-textMuted">{t('general.descriptionHint')}</p>
            </div>
          </div>
        </div>

        {/* Карта и мир */}
        <div className="mt-4 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <MapIcon className="h-4 w-4 text-accent" /> {t('general.worldTitle')}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="server-level" className="mb-1.5 block text-sm font-medium text-textMain">
                {t('general.levelLabel')}
              </label>
              <select
                id="server-level"
                value={form.level}
                onChange={(e) => set('level')(e.target.value)}
                className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors hover:border-[#3a4150] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              >
                <option value="Procedural Map">{t('general.levelProcedural')}</option>
                <option value="CraggyIsland">CraggyIsland</option>
              </select>
              <p className="mt-1.5 text-xs text-textMuted">{t('general.levelHint')}</p>
            </div>
            <Input
              label={t('general.levelUrlLabel')}
              hint={t('general.levelUrlHint')}
              value={form.levelurl}
              onChange={(e) => set('levelurl')(e.target.value)}
              error={errors.levelurl}
            />
          </div>
        </div>

        {/* Теги сервера */}
        <div className="mt-4 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <Tag className="h-4 w-4 text-accent" /> {t('general.tagsTitle')}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-textMain">{t('general.tagsLabel')}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {SERVER_TAGS.map((tag) => (
                  <label
                    key={tag}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#0f1115] px-2.5 py-2 text-xs text-textMain transition-colors hover:bg-[#14181f]"
                  >
                    <input
                      type="checkbox"
                      checked={form.tags.includes(tag)}
                      onChange={() => toggleTag(tag)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {tag}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-textMuted">{t('general.tagsHint')}</p>
              {errors.tags && <p className="mt-1 text-xs text-red-400">{errors.tags}</p>}
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="server-wipe-tag" className="mb-1.5 block text-sm font-medium text-textMain">
                  {t('general.wipeTagLabel')}
                </label>
                <select
                  id="server-wipe-tag"
                  value={form.wipeFrequencyTag}
                  onChange={(e) => set('wipeFrequencyTag')(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors hover:border-[#3a4150] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                >
                  <option value="">{t('general.tagNone')}</option>
                  {WIPE_FREQUENCY_TAGS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-textMuted">{t('general.wipeTagHint')}</p>
              </div>
              <div>
                <label htmlFor="server-region-tag" className="mb-1.5 block text-sm font-medium text-textMain">
                  {t('general.regionTagLabel')}
                </label>
                <select
                  id="server-region-tag"
                  value={form.regionTag}
                  onChange={(e) => set('regionTag')(e.target.value)}
                  className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors hover:border-[#3a4150] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                >
                  <option value="">{t('general.tagNone')}</option>
                  {REGION_TAGS.map((v) => (
                    <option key={v} value={v}>
                      {v.toUpperCase()}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-textMuted">{t('general.regionTagHint')}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label={t('general.seedLabel')}
            hint={t('general.seedHint')}
            value={form.seed}
            onChange={(e) => set('seed')(e.target.value)}
            error={errors.seed}
          />
          <Input
            label={t('general.worldSizeLabel')}
            hint={t('general.worldSizeHint')}
            value={form.worldSize}
            onChange={(e) => set('worldSize')(e.target.value)}
            error={errors.worldSize}
          />
          <Input
            label={t('general.portLabel')}
            hint={t('general.portHint')}
            value={form.port}
            onChange={(e) => set('port')(e.target.value)}
            error={errors.port}
          />
          <Input
            label={t('general.tickrateLabel')}
            hint={t('general.tickrateHint')}
            value={form.tickrate}
            onChange={(e) => set('tickrate')(e.target.value)}
            error={errors.tickrate}
          />
          <Input
            label={t('general.queryportLabel')}
            hint={t('general.queryportHint')}
            value={form.queryport}
            onChange={(e) => set('queryport')(e.target.value)}
            error={errors.queryport}
          />
          <Input
            label={t('general.maxPlayersLabel')}
            hint={t('general.maxPlayersHint')}
            value={form.maxPlayers}
            onChange={(e) => set('maxPlayers')(e.target.value)}
            error={errors.maxPlayers}
          />
          <Input
            label={t('general.rconPasswordLabel')}
            type="password"
            togglePassword
            hint={t('general.rconPasswordHint')}
            value={form.rconPassword}
            onChange={(e) => set('rconPassword')(e.target.value)}
            error={errors.rconPassword}
          />
          {isInsecureRconPassword(form.rconPassword) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t('general.rconInsecureWarning')}
            </p>
          )}
          <Input
            label={t('general.passwordLabel')}
            type="password"
            togglePassword
            hint={t('general.passwordHint')}
            value={form.password}
            onChange={(e) => set('password')(e.target.value)}
          />
          <div className="sm:col-span-2">
            <div className="flex gap-2">
              <Input
                label={t('general.installPathLabel')}
                hint={t('general.installPathHint')}
                placeholder={t('general.installPathPlaceholder')}
                value={form.installPath}
                onChange={(e) => set('installPath')(e.target.value)}
                className="flex-1"
              />
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={browseInstallPath}>
                  <FolderOpen className="h-4 w-4" /> {t('general.browse')}
                </Button>
              </div>
            </div>
            {pathCheck?.state === 'checking' && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-textMuted">
                <RefreshCw className="h-3 w-3 animate-spin" /> {t('general.installPathChecking')}
              </p>
            )}
            {pathCheck?.state === 'ok' && pathCheck.exe && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {t('general.installPathValid', { exe: pathCheck.exe })}
              </p>
            )}
            {pathCheck?.state === 'bad' && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {t('general.installPathInvalid')}
              </p>
            )}
          </div>
          <Input
            label={t('general.rconHostLabel')}
            hint={t('general.rconHostHint')}
            value={form.rconHost}
            onChange={(e) => set('rconHost')(e.target.value)}
            error={errors.rconHost}
          />
          <Input
            label={t('general.rconPortLabel')}
            hint={t('general.rconPortHint')}
            value={form.rconPort}
            onChange={(e) => set('rconPort')(e.target.value)}
            error={errors.rconPort}
          />
          <Input
            label={t('general.saveIntervalLabel')}
            hint={t('general.saveIntervalHint')}
            value={form.saveInterval}
            onChange={(e) => set('saveInterval')(e.target.value)}
            error={errors.saveInterval}
          />
          <Input
            label={t('general.additionalArgsLabel')}
            hint={t('general.additionalArgsHint')}
            value={form.additionalArgs}
            onChange={(e) => set('additionalArgs')(e.target.value)}
            className="sm:col-span-2"
          />
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
            <input
              type="checkbox"
              checked={form.eac}
              onChange={(e) => setBool('eac')(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="font-medium text-textMain">{t('general.eacLabel')}</span>
              <span className="mt-0.5 block text-xs text-textMuted">{t('general.eacHint')}</span>
            </span>
          </label>
          <Input
            label={t('general.steamBetaLabel')}
            hint={t('general.steamBetaHint')}
            value={form.steamBetaBranch}
            onChange={(e) => set('steamBetaBranch')(e.target.value)}
          />
        </div>

        {/* Защита сервера: автоперезапуск при падении / зависании */}
        <div className="mt-6 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <ShieldAlert className="h-4 w-4 text-accent" /> {t('general.watchdogTitle')}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.autoRestartOnCrash}
                onChange={(e) => setBool('autoRestartOnCrash')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.autoRestartCrash')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.autoRestartCrashHint')}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.autoRestartOnHang}
                onChange={(e) => setBool('autoRestartOnHang')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.autoRestartHang')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.autoRestartHangHint')}
                </span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <Input
                label={t('general.hangTimeoutLabel')}
                hint={t('general.hangTimeoutHint')}
                value={form.hangTimeoutMinutes}
                onChange={(e) => set('hangTimeoutMinutes')(e.target.value)}
                error={errors.hangTimeoutMinutes}
                className="max-w-xs"
              />
            </div>
            <label className="sm:col-span-2 flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.startWithManager}
                onChange={(e) => setBool('startWithManager')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.startWithManager')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.startWithManagerHint')}
                </span>
              </span>
            </label>
            <label className="sm:col-span-2 flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.autoUpdateOnRestart}
                onChange={(e) => setBool('autoUpdateOnRestart')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.autoUpdateLabel')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">{t('general.autoUpdateHint')}</span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button type="submit">
            <Save className="h-4 w-4" /> {t('general.save')}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {t('general.saved')}
            </span>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}

