import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, webContents } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { RconManager } from './rcon';
import { MetricsCollector } from './metrics';
import { executeWipe } from './wipe';
import { readServerConfig, saveServerConfig } from './config';
import { checkPluginUpdates, deletePlugin, listPlugins, readPluginConfig, savePluginConfig, setPluginEnabled, updateAllPlugins, updatePlugin } from './plugins';
import { cancelUpdate, updateRustServer, type SteamProgressEvent } from './steamcmd';
import { getMarketplaceList, installMarketplacePlugin, searchMarketplace } from './marketplace';
import { sendWebhookEvent, sendWebhookTest, saveWebhookConfig, loadWebhookConfig, type WebhookConfig } from './discord';
import { getLocale, initLocale, setLocale } from './locale';
import { createWorldBackup, deleteWorldBackup, listWorldBackups, restoreWorldBackup } from './backup';
import { setOnProcessExit, setOnServerLog, startServer, statusOf, stopAll, stopServer, findExecutableInfo, detectExternalServers, readServerLogTail, readServerLogFile, setOnAutoRestart, setOnServerRunning, isProcessRunning } from './rust-process';
import type { PluginInfo, RconConnectPayload, ScheduledWipeEntry, ServerPayload, ServerStartResult, WipeOptions, WipeResult } from './types';
import type { BackupScheduleInput, RestartScheduleInput, ScheduledTask } from './types';
import { TaskScheduler, type TaskActions } from './tasks';
import { appendMetric, readMetricsHistory } from './metrics-history';
import {
  clearNotifications,
  listNotifications,
  loadNotifications,
  markAllNotificationsRead,
  pushNotification,
  setNotificationBroadcast,
} from './notifications';
import {
  loadTelegramConfig,
  saveTelegramConfig,
  sendTelegramEvent,
  sendTelegramTest,
  type TelegramConfig,
} from './telegram';
import {
  checkLocalPorts,
  closeFirewallPort,
  getFirewallRule,
  openFirewallPort,
  probeExternal,
} from './ports';
import { getModsStatus, installOxide, removeMod } from './mods';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** true — пользователь явно вышел (трей → «Выход»); тогда закрытие окна завершает приложение. */
let quitting = false;

const DEV_URL = 'http://localhost:3000';

/**
 * Резервная иконка трея (16×16 «щит», base64) — если build/tray.png вдруг недоступен.
 * Тот же рисунок, что генерирует scripts/gen-icons.js.
 */
const TRAY_ICON_FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVRjYBh+4EGYxX98mCgD1lgpYMWjBhBpAC5DiNaMHJXImkkyAN0VJGtGdwnD8AYAGZ8z1AAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Настройки приложения (userData/settings.json).
// ---------------------------------------------------------------------------

interface AppSettings {
  /** Останавливать ли серверы при полном выходе из менеджера. По умолчанию false:
   *  серверы продолжают работать («откреплённый» режим) и подхватываются
   *  менеджером при следующем запуске. */
  stopServersOnExit: boolean;
}

const DEFAULT_SETTINGS: AppSettings = { stopServersOnExit: false };

let settings: AppSettings = { ...DEFAULT_SETTINGS };

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsFilePath(), 'utf8');
    settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    /* нет прав на запись — настройка не критична */
  }
}

/** Файл автозапуска на Linux (XDG autostart). */
function linuxAutostartFile(): string {
  return path.join(os.homedir(), '.config', 'autostart', 'rust-server-manager.desktop');
}

function createWindow(): void {
  // Иконка окна/панели задач (важно для dev-режима и Linux; в упакованном
  // Windows-приложении иконку несёт сам exe).
  const winIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'));
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Rust Server Manager',
    icon: winIcon.isEmpty() ? undefined : winIcon,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    // Vite может подняться чуть позже Electron — повторяем попытки подключения.
    const loadWithRetry = (attempt = 0): void => {
      mainWindow?.loadURL(DEV_URL).catch(() => {
        if (attempt < 60) {
          setTimeout(() => loadWithRetry(attempt + 1), 500);
        }
      });
    };
    loadWithRetry();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    // Сворачиваем в трей вместо полного закрытия — серверы продолжают работать.
    // Если трей недоступен (не создался), закрытие завершает приложение — иначе
    // окно «застряло» бы скрытым без возможности вернуться.
    if (!quitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
      showTrayHintOnce();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

/** Одноразовая подсказка при первом сворачивании в трей: как вернуть иконку из «скрытых значков». */
function showTrayHintOnce(): void {
  const hintFile = path.join(app.getPath('userData'), 'tray-hint-shown');
  try {
    if (fs.existsSync(hintFile)) return;
    fs.writeFileSync(hintFile, new Date().toISOString());
  } catch {
    return; // не критично — просто пропускаем подсказку
  }
  try {
    new Notification({
      title: 'Rust Server Manager',
      body: 'Приложение свёрнуто в трей. Если иконка не видна — нажмите «^» рядом с часами и перетащите её на панель задач.',
    }).show();
  } catch {
    /* noop */
  }
}

app.whenReady().then(() => {
  loadSettings();
  // AUMID нужен для системных уведомлений на Windows (иначе Notification не показывается).
  app.setAppUserModelId('com.rustservermanager.app');
  initLocale();
  loadScheduledWipes();
  startWipeScheduler();
  loadNotifications();
  setNotificationBroadcast(() => broadcast('notifications:changed', {}));
  taskScheduler.load();
  taskScheduler.start();
  registerIpc();
  createTray();
  createWindow();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('window-all-closed', () => {
  // Окно скрывается в трей — приложение продолжает работать (следит за серверами).
  if (quitting && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  // «Откреплённый» режим: по умолчанию серверы НЕ останавливаются при выходе
  // менеджера и продолжают работать в фоне. При следующем запуске менеджер
  // найдёт их по installPath и снова подключится (detectExternalServers).
  // Включив настройку stopServersOnExit (трей), можно вернуть прежнее поведение.
  if (settings.stopServersOnExit) stopAll();
  taskScheduler.stop();
  metricsCollector.stopAll();
  rconManager.dispose();
});

// ---------------------------------------------------------------------------
// IPC: реальные операции — процессы, RCON, плагины, вайпы, конфиги, метрики.
// ---------------------------------------------------------------------------

const rconManager = new RconManager();

/** Последний известный список серверов (для трея и автозапуска из main). */
let cachedServers: ServerPayload[] = [];

/** Подключение к WebRcon (если нужно — с переподключением) и отправка команды. */
async function ensureRconSend(server: ServerPayload, command: string): Promise<boolean> {
  if (rconManager.isConnected(server.id)) return rconManager.send(server.id, command).ok;
  try {
    const r = await rconManager.connect({
      serverId: server.id,
      host: server.rconHost || '127.0.0.1',
      port: server.rconPort || server.port + 2,
      password: server.rconPassword,
    });
    if (!r.ok) return false;
    return rconManager.send(server.id, command).ok;
  } catch {
    return false;
  }
}

function formatMb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------------
// RustEdit: определение и открытие кастомной карты (custommap.*.map).
// ---------------------------------------------------------------------------

interface RusteditMapInfo {
  ok: boolean;
  isCustom: boolean;
  fileName?: string;
  filePath?: string;
  size?: number;
  seed?: number;
  error?: string;
}

/** Файл кастомной карты RustEdit (custommap.*.map) в identity-папке сервера. */
function rusteditMapInfo(server: ServerPayload): RusteditMapInfo {
  if (!server.installPath) return { ok: false, isCustom: false, error: 'no-install-path' };
  const identityDir = path.join(server.installPath, 'server', server.identity);
  try {
    if (!fs.existsSync(identityDir)) return { ok: false, isCustom: false };
    const maps = fs
      .readdirSync(identityDir)
      .filter((f) => /\.map$/i.test(f) && !/^proceduralmap/i.test(f))
      .sort();
    if (maps.length === 0) return { ok: false, isCustom: false };
    const fileName = maps[0];
    const m = /\.(\d+)\.(\d+)\.map$/i.exec(fileName);
    return {
      ok: true,
      isCustom: true,
      fileName,
      filePath: path.join(identityDir, fileName),
      size: m ? Number(m[1]) : undefined,
      seed: m ? Number(m[2]) : undefined,
    };
  } catch (err) {
    return { ok: false, isCustom: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Поиск RustEdit.exe в типовых местах установки. */
function findRustEditExe(): string | null {
  const bases = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    os.homedir(),
  ].filter((d): d is string => Boolean(d));
  for (const base of bases) {
    const exe = path.join(base, 'RustEdit', 'RustEdit.exe');
    if (fs.existsSync(exe)) return exe;
  }
  // Ограниченный поиск по типовым папкам пользователя (Documents/Desktop/Downloads).
  const scanDirs = [
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Downloads'),
  ];
  for (const dir of scanDirs) {
    try {
      const hit = fs.readdirSync(dir).find((e) => /RustEdit/i.test(e));
      if (hit) {
        const exe = path.join(dir, hit, 'RustEdit.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch {
      /* нет доступа — пропускаем */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// RustEdit: расширение Oxide.Ext.RustEdit.dll (нужно для запуска кастомных карт).
// Файл поставляется вместе с RustEdit (в папке установки редактора).
// ---------------------------------------------------------------------------

/** Путь к папке Oxide сервера (там лежат расширения Oxide). */
function oxideDir(server: ServerPayload): string {
  return path.join(server.installPath ?? '', 'oxide');
}

/** Статус расширения RustEdit на сервере (Oxide.Ext.RustEdit.dll в папке oxide). */
function rusteditExtensionStatus(server: ServerPayload): { ok: boolean; installed: boolean; path?: string } {
  if (!server.installPath) return { ok: false, installed: false };
  const p = path.join(oxideDir(server), 'Oxide.Ext.RustEdit.dll');
  return { ok: true, installed: fs.existsSync(p), path: p };
}

/** Поиск Oxide.Ext.RustEdit.dll в установке RustEdit (рядом с exe / Documents\RustEdit). */
function findRustEditDll(): string | null {
  const exe = findRustEditExe();
  if (exe) {
    const p = path.join(path.dirname(exe), 'Oxide.Ext.RustEdit.dll');
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.join(os.homedir(), 'Documents', 'RustEdit', 'Oxide.Ext.RustEdit.dll'),
    path.join(os.homedir(), 'Downloads', 'Oxide.Ext.RustEdit.dll'),
    path.join(os.homedir(), 'Desktop', 'Oxide.Ext.RustEdit.dll'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/** Иконка в трее + быстрые действия. Файл build/tray.png генерируется скриптом gen-icons. */
function createTray(): void {
  if (tray) return;
  // Диагностика: состояние трея пишется в userData/tray-debug.log.
  const trayLog = (msg: string): void => {
    try {
      fs.appendFileSync(
        path.join(app.getPath('userData'), 'tray-debug.log'),
        `[${new Date().toISOString()}] ${msg}\n`
      );
    } catch {
      /* noop */
    }
  };
  const iconPath = path.join(app.getAppPath(), 'build', 'tray.png');
  trayLog(`appPath=${app.getAppPath()} iconPath=${iconPath} exists=${fs.existsSync(iconPath)}`);
  try {
    let image = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
    trayLog(`image empty=${image.isEmpty()} size=${JSON.stringify(image.getSize())}`);
    if (image.isEmpty()) {
      // Встроенная резервная иконка — трей всегда видимый, даже если PNG пропал.
      image = nativeImage.createFromDataURL(TRAY_ICON_FALLBACK);
    }
    tray = new Tray(image.resize({ width: 16, height: 16 }));
    tray.setToolTip('Rust Server Manager');
    trayLog(`trayCreated=${Boolean(tray)} destroyed=${tray.isDestroyed()}`);
  } catch (err) {
    trayLog(`ERROR: ${String(err)}`);
    console.error('Tray creation failed:', err);
    tray = null;
    return;
  }
  const ru = getLocale() === 'ru';
  const menu = Menu.buildFromTemplate([
    { label: 'Rust Server Manager', enabled: false },
    { type: 'separator' },
    { label: ru ? 'Открыть менеджер' : 'Open Manager', click: () => showWindow() },
    {
      label: ru ? 'Запустить все серверы' : 'Start all servers',
      click: () => {
        for (const s of cachedServers) {
          if (!s.installPath || isProcessRunning(s.id)) continue;
          void startServer(s);
        }
      },
    },
    { label: ru ? 'Остановить все серверы' : 'Stop all servers', click: () => stopAll() },
    {
      label: ru ? 'Останавливать серверы при выходе' : 'Stop servers on exit',
      id: 'stop-on-exit',
      type: 'checkbox',
      checked: settings.stopServersOnExit,
      click: (item) => {
        settings.stopServersOnExit = item.checked;
        saveSettings();
      },
    },
    { type: 'separator' },
    {
      label: ru ? 'Выход' : 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

/** Обработчики задач планировщика (перезапуски / предупреждения / автобэкапы / авторазбаны). */
function taskSchedulerActions(): TaskActions {
  return {
    onRestart(task: ScheduledTask): void {
      const server = task.server;
      const wasRunning = isProcessRunning(server.id);
      task.lastResult = wasRunning
        ? 'Server restarted'
        : 'Not running — nothing to restart';
      if (wasRunning) {
        stopServer(server.id);
        // Даём портам освободиться и поднимаем сервер заново (с автообновлением при флаге).
        setTimeout(() => void startServerWithAutoUpdate(server), 5000);
      }
      taskScheduler.save();
      broadcast('tasks:changed', {});
      pushNotification({
        id: `restart_${server.id}_${Date.now()}`,
        at: Date.now(),
        serverId: server.id,
        serverName: server.name,
        kind: 'restart',
        title: getLocale() === 'ru' ? 'Перезапуск по расписанию' : 'Scheduled restart',
        body:
          getLocale() === 'ru'
            ? `Сервер «${server.name}» перезапущен`
            : `Server "${server.name}" was restarted`,
        read: false,
      });
      void sendTelegramEvent(server.id, {
        serverId: server.id,
        event: 'server-restart',
        serverName: server.name,
      });
    },

    onWarning(task: ScheduledTask): void {
      const msg = (task.warnMessage ?? 'Server restart')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      void ensureRconSend(task.server, `server.message "${msg}"`).then(() => {
        broadcast('tasks:changed', {});
      });
    },

    onBackup(task: ScheduledTask): void {
      const res = createWorldBackup(task.server, task.label || 'auto');
      if (res.ok && res.entry) {
        const retention = task.retention ?? 5;
        const all = listWorldBackups(task.server);
        if (all.length > retention) {
          for (const b of all.slice(retention)) deleteWorldBackup(task.server, b.id);
        }
        task.lastResult = `Backup OK: ${res.entry.fileCount} file(s), ${formatMb(res.entry.sizeBytes)}`;
      } else {
        task.lastResult = `Backup failed: ${res.error ?? 'unknown error'}`;
      }
      taskScheduler.save();
      broadcast('tasks:changed', {});
      pushNotification({
        id: `backup_${task.serverId}_${Date.now()}`,
        at: Date.now(),
        serverId: task.serverId,
        serverName: task.server.name,
        kind: 'backup',
        title: getLocale() === 'ru' ? 'Автобэкап' : 'Auto backup',
        body: task.lastResult ?? '',
        read: false,
      });
      void sendTelegramEvent(task.serverId, {
        serverId: task.serverId,
        event: 'backup',
        serverName: task.server.name,
        message: task.lastResult,
      });
    },

    onUnban(task: ScheduledTask): void {
      const target = (task.steamId || '').trim();
      void ensureRconSend(task.server, `unbanid "${target}"`).then((ok) => {
        if (ok && target) {
          pushNotification({
            id: `unban_${task.serverId}_${Date.now()}`,
            at: Date.now(),
            serverId: task.serverId,
            serverName: task.server.name,
            kind: 'unban',
            title: getLocale() === 'ru' ? 'Авторазбан' : 'Auto unban',
            body:
              getLocale() === 'ru'
                ? `Бан игрока ${task.playerName || target} снят`
                : `Ban lifted for ${task.playerName || target}`,
            read: false,
          });
        }
        if (!ok && target) {
          // Не смогли связаться с сервером — пробуем ещё раз через 10 минут.
          taskScheduler.add({
            ...task,
            id: `unban_${task.serverId}_${Date.now()}`,
            nextRun: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
        }
        broadcast('tasks:changed', {});
      });
    },
  };
}

const taskScheduler = new TaskScheduler(
  path.join(app.getPath('userData'), 'scheduled-tasks.json'),
  taskSchedulerActions()
);
// Уведомление о краше процесса (неожиданный exit без команды остановки)
setOnProcessExit(({ server, code }) => {
  sendWebhookEvent(server.id, {
    serverId: server.id,
    event: 'server-crash',
    serverName: server.name,
    map: server.map,
  });
  pushNotification({
    id: `crash_${server.id}_${Date.now()}`,
    at: Date.now(),
    serverId: server.id,
    serverName: server.name,
    kind: 'crash',
    title: getLocale() === 'ru' ? 'Краш сервера' : 'Server crashed',
    body:
      getLocale() === 'ru'
        ? `Сервер «${server.name}» аварийно завершился (код ${code ?? '?'})`
        : `Server "${server.name}" crashed unexpectedly (code ${code ?? '?'})`,
    read: false,
  });
  void sendTelegramEvent(server.id, {
    serverId: server.id,
    event: 'server-crash',
    serverName: server.name,
    map: server.map,
  });
  // Сообщаем рендереру, чтобы статус сервера обновился сразу, а не после перезапуска.
  broadcast('server:process-exit', { serverId: server.id, code });
});

// Поток лога запущенных серверов (stdout/stderr RustDedicatedServer.exe) → консоль приложения
setOnServerLog((line) => broadcast('server:log', line));

// Watchdog: авторестарт запланирован / процесс запущен автоматически
setOnAutoRestart((info) => {
  broadcast('server:auto-restart', info);
  const srv = cachedServers.find((s) => s.id === info.serverId);
  pushNotification({
    id: `auto_${info.serverId}_${Date.now()}`,
    at: Date.now(),
    serverId: info.serverId,
    serverName: srv?.name ?? info.serverId,
    kind: 'autorestart',
    title: getLocale() === 'ru' ? 'Авторестарт сервера' : 'Server auto-restart',
    body:
      getLocale() === 'ru'
        ? `Попытка ${info.attempt}, через ${Math.round(info.delayMs / 1000)} c`
        : `Attempt ${info.attempt}, in ${Math.round(info.delayMs / 1000)}s`,
    read: false,
  });
});
setOnServerRunning((info) => broadcast('server:process-running', info));

const metricsCollector = new MetricsCollector(rconManager, (sample) => {
  appendMetric(sample);
  for (const wc of webContents.getAllWebContents()) {
    wc.send('metrics:data', sample);
  }
});

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    wc.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Планировщик вайпов: расписание хранится в userData и выполняется в main.
// ---------------------------------------------------------------------------

function scheduleFile(): string {
  return path.join(app.getPath('userData'), 'scheduled-wipes.json');
}

let scheduledWipes: ScheduledWipeEntry[] = [];
let wipeSchedulerStarted = false;

function loadScheduledWipes(): void {
  try {
    const raw = fs.readFileSync(scheduleFile(), 'utf8');
    const parsed = JSON.parse(raw) as ScheduledWipeEntry[];
    scheduledWipes = Array.isArray(parsed) ? parsed : [];
  } catch {
    scheduledWipes = [];
  }
}

function saveScheduledWipes(): void {
  try {
    fs.mkdirSync(path.dirname(scheduleFile()), { recursive: true });
    fs.writeFileSync(scheduleFile(), JSON.stringify(scheduledWipes, null, 2), 'utf8');
  } catch {
    // файл недоступен — не критично
  }
}

function nextWipeDate(freq: ScheduledWipeEntry['frequency'], from: Date): Date {
  const d = new Date(from);
  if (freq === 'Daily') d.setDate(d.getDate() + 1);
  else if (freq === 'Weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Вайп с остановкой и перезапуском сервера (если он был запущен). */
async function runWipe(server: ServerPayload, options: WipeOptions): Promise<WipeResult & { restarted?: boolean }> {
  const wasRunning = isProcessRunning(server.id);
  if (wasRunning) stopServer(server.id);

  const result = executeWipe(server, options);

  if (result.ok && options.regenerateSeed && result.newSeed && result.newSeed !== server.seed) {
    server.seed = result.newSeed;
    broadcast('server:seed-changed', { serverId: server.id, seed: result.newSeed });
  }

  if (wasRunning && result.ok) {
    // даём портам освободиться и поднимаем сервер заново
    setTimeout(() => void startServer(server), 5000);
    return { ...result, restarted: true };
  }
  return result;
}

async function executeScheduledWipe(entry: ScheduledWipeEntry): Promise<void> {
  const result = await runWipe(entry.server, {
    wipeMap: entry.wipeMap,
    wipeDb: entry.wipeDb,
    regenerateSeed: entry.regenerateSeed,
  });
  entry.lastResult = result.ok
    ? `Deleted ${result.deletedFiles.length} file(s)${result.restarted ? ' (server restarted)' : ''}`
    : `Error: ${result.message ?? 'unknown'}`;
  entry.nextRun = nextWipeDate(entry.frequency, new Date()).toISOString();
  saveScheduledWipes();
  broadcast('wipes:executed', {
    serverId: entry.serverId,
    ok: result.ok,
    newSeed: result.newSeed,
    deleted: result.deletedFiles.length,
    message: result.message,
    restarted: result.restarted ?? false,
  });
  broadcast('wipes:schedule-changed', {});
  pushNotification({
    id: `wipe_${entry.serverId}_${Date.now()}`,
    at: Date.now(),
    serverId: entry.serverId,
    serverName: entry.server.name,
    kind: 'wipe',
    title: getLocale() === 'ru' ? 'Вайп по расписанию' : 'Scheduled wipe',
    body: entry.lastResult ?? '',
    read: false,
  });
  void sendTelegramEvent(entry.serverId, {
    serverId: entry.serverId,
    event: 'server-wipe',
    serverName: entry.server.name,
    map: entry.server.map,
    seed: result.newSeed ?? entry.server.seed,
    message: entry.lastResult,
  });
}

function startWipeScheduler(): void {
  if (wipeSchedulerStarted) return;
  wipeSchedulerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const entry of scheduledWipes) {
      const due = entry.nextRun ? Date.parse(entry.nextRun) : NaN;
      if (!Number.isNaN(due) && due <= now) {
        void executeScheduledWipe(entry);
      }
    }
  }, 30_000).unref();
}

/** Поля сервера для экспорта/импорта конфигурации (без транзиентного состояния). */
const EXPORT_FIELDS: Array<keyof ServerPayload> = [
  'identity',
  'gamemode',
  'name',
  'installPath',
  'port',
  'seed',
  'worldSize',
  'maxPlayers',
  'rconHost',
  'rconPort',
  'rconPassword',
  'map',
  'levelurl',
  'tags',
  'wipeFrequencyTag',
  'regionTag',
  'description',
  'url',
  'headerImage',
  'logoImage',
  'saveInterval',
  'additionalArgs',
  'autoUpdateOnRestart',
  'tickrate',
  'queryport',
  'password',
  'eac',
  'steamBetaBranch',
  'autoRestartOnCrash',
  'autoRestartOnHang',
  'hangTimeoutMinutes',
  'startWithManager',
];

function pickServerFields(s: ServerPayload): Partial<ServerPayload> {
  const out: Partial<ServerPayload> = {};
  for (const k of EXPORT_FIELDS) {
    const v = s[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Автообновление сервера и Oxide перед запуском (по флагу autoUpdateOnRestart).
 * Прогресс транслируется в тот же канал, что и ручное обновление (server:update-progress).
 */
async function maybeAutoUpdate(server: ServerPayload): Promise<{ ok: boolean; error?: string }> {
  if (!server.autoUpdateOnRestart || !server.installPath) return { ok: true };
  const ru = getLocale() === 'ru';
  try {
    broadcast('server:update-progress', {
      serverId: server.id,
      message: ru ? 'Автообновление: обновление сервера…' : 'Auto-update: updating server…',
      pct: 0,
    });
    const upd = await updateRustServer(server, (event) =>
      broadcast('server:update-progress', { serverId: server.id, ...event })
    );
    if (!upd.ok) return { ok: false, error: `Auto-update failed: ${upd.error}` };
    const mods = await getModsStatus(server);
    if (mods.oxide.installed) {
      broadcast('server:update-progress', {
        serverId: server.id,
        message: ru ? 'Автообновление: обновление Oxide…' : 'Auto-update: updating Oxide…',
        pct: 90,
      });
      const oxide = await installOxide(server);
      if (!oxide.installed) {
        return { ok: false, error: `Oxide auto-update failed: ${oxide.error}` };
      }
    }
    broadcast('server:update-progress', {
      serverId: server.id,
      message: ru ? 'Автообновление завершено' : 'Auto-update finished',
      pct: 100,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Запуск сервера: при флаге autoUpdateOnRestart сначала обновляем игру и Oxide. */
async function startServerWithAutoUpdate(server: ServerPayload): Promise<ServerStartResult> {
  const pre = await maybeAutoUpdate(server);
  if (!pre.ok) return { success: false, mode: 'real', error: pre.error ?? 'Auto-update failed' };
  return startServer(server);
}

/** Перезапуск сервера с автообновлением (аналог restartServer + maybeAutoUpdate). */
async function restartServerWithAutoUpdate(server: ServerPayload): Promise<ServerStartResult> {
  stopServer(server.id);
  await new Promise((r) => setTimeout(r, 1500));
  return startServerWithAutoUpdate(server);
}

function registerIpc(): void {
  // --- Управление процессами Rust-серверов ---
  ipcMain.handle('server:start', async (_event, server: ServerPayload) => {
    const result = await startServerWithAutoUpdate(server);
    if (result.success && result.mode === 'real') {
      metricsCollector.start(server, result.pid);
    }
    // Вебхук о старте — только для реального запуска процесса, не для симуляции.
    if (result.success && result.mode === 'real') {
      sendWebhookEvent(server.id, {
        serverId: server.id,
        event: 'server-start',
        serverName: server.name,
        map: server.map,
        worldSize: server.worldSize,
        maxPlayers: server.maxPlayers,
      });
      void sendTelegramEvent(server.id, {
        serverId: server.id,
        event: 'server-start',
        serverName: server.name,
        map: server.map,
        worldSize: server.worldSize,
        maxPlayers: server.maxPlayers,
      });
    }
    return result;
  });
  ipcMain.handle('server:stop', (_event, server: ServerPayload) => {
    metricsCollector.stop(server.id);
    const result = stopServer(server.id);
    // Вебхук об остановке — только для реально остановленного процесса.
    if (result.success && result.mode === 'real') {
      sendWebhookEvent(server.id, {
        serverId: server.id,
        event: 'server-stop',
        serverName: server.name,
      });
      void sendTelegramEvent(server.id, {
        serverId: server.id,
        event: 'server-stop',
        serverName: server.name,
      });
    }
    return result;
  });
  ipcMain.handle('server:restart', async (_event, server: ServerPayload) => {
    metricsCollector.stop(server.id);
    const result = await restartServerWithAutoUpdate(server);
    if (result.success && result.mode === 'real') {
      metricsCollector.start(server, result.pid);
    }
    return result;
  });
  ipcMain.handle('server:status', (_event, id: string) => statusOf(id));

  // Проверка наличия исполняемого файла сервера в папке установки
  ipcMain.handle('server:find-exe', (_event, installPath: string) => findExecutableInfo(installPath));

  // Обнаружение запущенных в ОС серверов (для честных статусов после рестарта менеджера).
  // Найденные процессы «прикрепляются» обратно: запускается сбор метрик по их PID.
  ipcMain.handle('server:detect-external', async (_event, servers: ServerPayload[]) => {
    const pids = await detectExternalServers(servers);
    for (const s of servers) {
      const pid = pids[s.id];
      if (pid && s.installPath) metricsCollector.start(s, pid);
    }
    return pids;
  });

  // Чтение лога сервера из файла (консоль приложения, pull-режим)
  ipcMain.handle(
    'server:log-tail',
    (_event, server: ServerPayload, fromOffset: number, opts?: { sessionStart?: boolean }) =>
      readServerLogTail(server, fromOffset, opts)
  );

  // --- Телеметрия ---
  ipcMain.handle('metrics:last', (_event, id: string) => metricsCollector.last(id));

  // --- Системная память: занято всеми процессами + общий объём (os) ---
  ipcMain.handle('system:memory', () => {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      totalMb: Math.round(total / (1024 * 1024)),
      usedMb: Math.round((total - free) / (1024 * 1024)),
      freeMb: Math.round(free / (1024 * 1024)),
    };
  });

  // --- WebRcon ---
  ipcMain.handle('rcon:connect', (_event, payload: RconConnectPayload) => rconManager.connect(payload));
  ipcMain.handle('rcon:disconnect', (_event, serverId: string) => rconManager.disconnect(serverId));
  ipcMain.handle('rcon:send', (_event, payload: { serverId: string; command: string }) =>
    rconManager.send(payload.serverId, payload.command)
  );
  ipcMain.handle('rcon:status', () => rconManager.status());

  // --- Карта мира: превью (PNG, создаваемая сервером) ---
  ipcMain.handle('map:get-preview', (_event, server: ServerPayload) => {
    if (!server.installPath) return { ok: false, error: 'no-install-path' };
    // Ищем самый свежий PNG/JPG в server/<identity>/ и подпапках (map/, debug/):
    // сюда Rust кладёт и превью write.png (старые версии), и debug/ore-nodes.png
    // (spawn.ore_map — современные версии, где write.png удалён).
    const identityDir = path.join(server.installPath, 'server', server.identity);
    try {
      if (!fs.existsSync(identityDir)) return { ok: false, error: 'not-found' };
      const files: Array<{ name: string; file: string; mtime: number }> = [];
      const walk = (dir: string, depth: number): void => {
        if (depth > 3) return;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === 'cfg' || e.name === 'command_history' || e.name === 'oxide') continue;
            walk(full, depth + 1);
          } else if (/\.(png|jpe?g)$/i.test(e.name)) {
            try {
              files.push({ name: e.name, file: full, mtime: fs.statSync(full).mtimeMs });
            } catch {
              /* файл мог исчезнуть между чтением и stat */
            }
          }
        }
      };
      walk(identityDir, 0);
      if (files.length === 0) return { ok: false, error: 'not-found' };
      files.sort((a, b) => b.mtime - a.mtime);
      const buf = fs.readFileSync(files[0].file);
      const isJpg = /\.jpe?g$/i.test(files[0].name);
      return {
        ok: true,
        dataUrl: `data:image/${isJpg ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`,
        fileName: files[0].name,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Карта мира: запросить актуальное изображение у работающего сервера.
  // В современных версиях Rust команда write.png удалена — используем spawn.ore_map
  // (создаёт server/<identity>/debug/ore-nodes.png — карта руды). write.png
  // дополнительно отправляем для старых версий, где он создаёт полноценное превью.
  ipcMain.handle('map:capture', async (_event, server: ServerPayload) => {
    if (!isProcessRunning(server.id)) return { ok: false, error: 'server-offline' };
    const [ore, write] = await Promise.all([
      ensureRconSend(server, 'spawn.ore_map'),
      ensureRconSend(server, 'write.png'),
    ]);
    return ore || write ? { ok: true } : { ok: false, error: 'rcon-failed' };
  });

  // --- RustEdit: кастомная карта (custommap.*.map) ---
  ipcMain.handle('map:rustedit-info', (_event, server: ServerPayload) => rusteditMapInfo(server));

  // Открыть кастомную карту в RustEdit (найденный exe или ассоциация .map в системе).
  ipcMain.handle('map:open-in-rustedit', async (_event, server: ServerPayload) => {
    const info = rusteditMapInfo(server);
    if (!info.ok || !info.filePath) {
      return { ok: false, error: info.error ?? 'no-custom-map' };
    }
    const exe = findRustEditExe();
    if (exe) {
      try {
        spawn(exe, [info.filePath], { windowsHide: false, detached: true }).unref();
        return { ok: true, mode: 'rustedit' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    try {
      const err = await shell.openPath(info.filePath);
      return err ? { ok: false, error: err } : { ok: true, mode: 'association' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // --- RustEdit: расширение Oxide.Ext.RustEdit.dll (для кастомных карт) ---
  ipcMain.handle('rustedit:extension-status', (_event, server: ServerPayload) =>
    rusteditExtensionStatus(server)
  );

  // Копирует Oxide.Ext.RustEdit.dll из установки RustEdit в папку oxide сервера.
  ipcMain.handle('rustedit:extension-install', (_event, server: ServerPayload) => {
    if (!server.installPath) return { ok: false, error: 'no-install-path' };
    const src = findRustEditDll();
    if (!src) return { ok: false, error: 'rustedit-dll-not-found' };
    const target = path.join(oxideDir(server), 'Oxide.Ext.RustEdit.dll');
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(src, target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Удаляет расширение из папки oxide сервера.
  ipcMain.handle('rustedit:extension-remove', (_event, server: ServerPayload) => {
    const p = path.join(oxideDir(server), 'Oxide.Ext.RustEdit.dll');
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Список игроков (JSON из команды playerlist)
  ipcMain.handle('rcon:playerlist', async (_event, serverId: string) => {
    if (!rconManager.isConnected(serverId)) return { ok: false, error: 'Not connected' };
    const text = await rconManager.request(serverId, 'playerlist', 5000);
    if (!text) return { ok: false, error: 'No response from server' };
    try {
      const parsed = JSON.parse(text);
      return { ok: true, players: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { ok: false, error: 'Cannot parse playerlist', raw: text.slice(0, 500) };
    }
  });

  // Список забаненных (JSON из команды banned)
  ipcMain.handle('rcon:bannedlist', async (_event, serverId: string) => {
    if (!rconManager.isConnected(serverId)) return { ok: false, error: 'Not connected' };
    const text = await rconManager.request(serverId, 'banned', 5000);
    if (!text) return { ok: false, error: 'No response from server' };
    try {
      const parsed = JSON.parse(text);
      return { ok: true, players: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { ok: false, error: 'Cannot parse banned list', raw: text.slice(0, 500) };
    }
  });

  // Действия над игроком: kick / ban / unban (по имени или SteamID)
  ipcMain.handle(
    'rcon:player-action',
    (
      _event,
      payload: {
        serverId: string;
        action: 'kick' | 'ban' | 'unban';
        target: string;
        reason?: string;
        durationMinutes?: number;
        server?: ServerPayload;
      }
    ) => {
      if (!rconManager.isConnected(payload.serverId)) return { ok: false, error: 'Not connected' };
      const { serverId, action, target, reason, durationMinutes, server } = payload;
      const isSteamId = /^\d{17}$/.test(target.trim());
      let cmd: string;
      if (action === 'kick') {
        cmd = `kick "${target}" "${reason || 'No reason'}"`;
      } else if (action === 'ban') {
        cmd = isSteamId ? `banid "${target}" "${reason || 'No reason'}"` : `ban "${target}" "${reason || 'No reason'}"`;
      } else {
        cmd = isSteamId ? `unbanid "${target}"` : `unban "${target}"`;
      }
      const sent = rconManager.send(serverId, cmd);

      // Временный бан: планируем авторазбан.
      let unbanTaskId: string | undefined;
      let unbanAt: string | undefined;
      if (sent && action === 'ban' && isSteamId && durationMinutes && durationMinutes > 0 && server) {
        unbanAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
        const task: ScheduledTask = {
          id: `unban_${serverId}_${Date.now()}`,
          serverId,
          type: 'unban',
          nextRun: unbanAt,
          createdAt: Date.now(),
          server,
          playerName: target,
          steamId: target,
          reason: reason || 'No reason',
        };
        taskScheduler.add(task);
        unbanTaskId = task.id;
        broadcast('tasks:changed', {});
        pushNotification({
          id: `ban_${serverId}_${Date.now()}`,
          at: Date.now(),
          serverId,
          serverName: server?.name ?? serverId,
          kind: 'ban',
          title: getLocale() === 'ru' ? 'Временный бан' : 'Temporary ban',
          body:
            getLocale() === 'ru'
              ? `${target} — авторазбан в ${new Date(unbanAt).toLocaleString('ru-RU')}`
              : `${target} — auto unban at ${new Date(unbanAt).toLocaleString('en-GB')}`,
          read: false,
        });
      }

      return { ok: sent, message: cmd, unbanTaskId, unbanAt };
    }
  );

  // --- Плагины Oxide ---
  ipcMain.handle('plugins:list', (_event, server: ServerPayload) => listPlugins(server));
  ipcMain.handle('plugins:delete', (_event, payload: { filePath: string }) =>
    deletePlugin(payload.filePath)
  );
  ipcMain.handle('plugins:update', (_event, payload: { plugin: PluginInfo }) =>
    updatePlugin(payload.plugin)
  );
  ipcMain.handle('plugins:check-updates', (_event, server: ServerPayload) =>
    checkPluginUpdates(server)
  );
  ipcMain.handle('plugins:update-all', (_event, server: ServerPayload) =>
    updateAllPlugins(server)
  );

  // --- Marketplace плагинов ---
  ipcMain.handle('marketplace:get-list', (_event, lang: string) => getMarketplaceList(lang));
  ipcMain.handle('marketplace:search', (_event, query: string) => searchMarketplace(query));
  ipcMain.handle('marketplace:install', (_event, payload: { server: ServerPayload; slug: string }) =>
    installMarketplacePlugin(payload.server, payload.slug)
  );

  // --- Установка плагина с диска: выбор папки с .cs файлами ---
  ipcMain.handle('plugins:pick-dir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    if (!win) return { ok: false, error: 'no-window' };
    const res = await dialog.showOpenDialog(win, {
      title: 'Select plugin folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.cs'))
        .sort();
    } catch {
      files = [];
    }
    return { ok: true, dir, files };
  });

  // Копирование выбранного .cs файла в oxide/plugins сервера
  ipcMain.handle(
    'plugins:install-from-disk',
    (_event, payload: { server: ServerPayload; dir: string; fileName: string }) => {
      const { server, dir, fileName } = payload;
      if (!server.installPath) return { ok: false, error: 'no-install-path' };
      const target = path.join(server.installPath, 'oxide', 'plugins', path.basename(fileName));
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(dir, fileName), target);
        return { ok: true, fileName: path.basename(fileName) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // --- Конфигурация server.cfg ---
  ipcMain.handle('config:read', (_event, server: ServerPayload) => readServerConfig(server));
  ipcMain.handle('config:save', (_event, payload: { server: ServerPayload; config: Record<string, string> }) =>
    saveServerConfig(payload.server, payload.config)
  );

  // --- Вайпы ---
  ipcMain.handle('wipe:execute', async (_event, payload: { server: ServerPayload; options: WipeOptions }) => {
    const result = await runWipe(payload.server, payload.options);
    if (result.ok) {
      sendWebhookEvent(payload.server.id, {
        serverId: payload.server.id,
        event: 'server-wipe',
        serverName: payload.server.name,
        map: payload.server.map,
        seed: result.newSeed ?? payload.server.seed,
        worldSize: payload.server.worldSize,
      });
      pushNotification({
        id: `wipe_${payload.server.id}_${Date.now()}`,
        at: Date.now(),
        serverId: payload.server.id,
        serverName: payload.server.name,
        kind: 'wipe',
        title: getLocale() === 'ru' ? 'Вайп выполнен' : 'Wipe completed',
        body:
          getLocale() === 'ru'
            ? `На сервере «${payload.server.name}» удалено файлов: ${result.deletedFiles.length}`
            : `Deleted ${result.deletedFiles.length} file(s) on "${payload.server.name}"`,
        read: false,
      });
      void sendTelegramEvent(payload.server.id, {
        serverId: payload.server.id,
        event: 'server-wipe',
        serverName: payload.server.name,
        map: payload.server.map,
        seed: result.newSeed ?? payload.server.seed,
        worldSize: payload.server.worldSize,
      });
    }
    return result;
  });

  // --- Планировщик вайпов ---
  ipcMain.handle('wipes:scheduled-list', () => scheduledWipes);
  ipcMain.handle('wipes:scheduled-add', (_event, entry: ScheduledWipeEntry) => {
    scheduledWipes = scheduledWipes.filter((w) => w.id !== entry.id);
    scheduledWipes.push(entry);
    saveScheduledWipes();
    broadcast('wipes:schedule-changed', {});
    return scheduledWipes;
  });
  ipcMain.handle('wipes:scheduled-remove', (_event, id: string) => {
    scheduledWipes = scheduledWipes.filter((w) => w.id !== id);
    saveScheduledWipes();
    broadcast('wipes:schedule-changed', {});
    return scheduledWipes;
  });

  // --- Бэкапы мира ---
  ipcMain.handle('backup:create', (_event, server: ServerPayload, label?: string) =>
    createWorldBackup(server, label)
  );
  ipcMain.handle('backup:list', (_event, server: ServerPayload) => listWorldBackups(server));
  ipcMain.handle('backup:restore', (_event, server: ServerPayload, backupId: string) =>
    restoreWorldBackup(server, backupId)
  );
  ipcMain.handle('backup:delete', (_event, server: ServerPayload, backupId: string) =>
    deleteWorldBackup(server, backupId)
  );

  // --- Discord Webhooks ---
  ipcMain.handle('webhook:get-config', (_event, serverId: string) => loadWebhookConfig(serverId));
  ipcMain.handle('webhook:save-config', (_event, payload: { serverId: string; config: WebhookConfig }) =>
    saveWebhookConfig(payload.serverId, payload.config)
  );
  ipcMain.handle('webhook:test', (_event, payload: { config: WebhookConfig }) =>
    sendWebhookTest(payload.config)
  );

  // --- Локализация ---
  ipcMain.handle('locale:get', () => getLocale());
  ipcMain.handle('locale:set', (_event, lng: string) => setLocale(lng));

  // --- Обновление серверной части Rust (SteamCMD) ---
  ipcMain.handle('server:update', (_event, server: ServerPayload) => {
    const emit = (event: SteamProgressEvent) => {
      broadcast('server:update-progress', { serverId: server.id, ...event });
    };
    return updateRustServer(server, emit);
  });

  // Отмена текущего обновления (убивает процесс SteamCMD).
  ipcMain.handle('server:update-cancel', () => {
    cancelUpdate();
    return { ok: true };
  });

  // --- Системные ---
  ipcMain.handle('dialog:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Rust server install folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // --- Синхронизация списка серверов с main (трей / автозапуск) ---
  ipcMain.handle('server:sync-servers', (_event, servers: ServerPayload[]) => {
    cachedServers = Array.isArray(servers) ? servers : [];
  });

  // --- Планировщик задач: перезапуски / автобэкапы / авторазбаны ---
  ipcMain.handle('tasks:list', () => taskScheduler.list());
  ipcMain.handle('tasks:add-restart', (_event, input: RestartScheduleInput) => {
    taskScheduler.addRestart(input);
    broadcast('tasks:changed', {});
    return taskScheduler.list();
  });
  ipcMain.handle('tasks:add-backup', (_event, input: BackupScheduleInput) => {
    taskScheduler.addBackup(input);
    broadcast('tasks:changed', {});
    return taskScheduler.list();
  });
  ipcMain.handle('tasks:remove', (_event, id: string) => {
    taskScheduler.remove(id);
    broadcast('tasks:changed', {});
    return taskScheduler.list();
  });

  // --- Автозапуск менеджера с Windows ---
  ipcMain.handle('app:get-auto-launch', () => {
    if (process.platform === 'linux') {
      return { openAtLogin: fs.existsSync(linuxAutostartFile()) };
    }
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('app:set-auto-launch', (_event, enabled: boolean) => {
    if (process.platform === 'linux') {
      const file = linuxAutostartFile();
      if (enabled) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          '[Desktop Entry]\n' +
            'Type=Application\n' +
            'Name=Rust Server Manager\n' +
            'Comment=Manage Rust game servers\n' +
            `Exec=${process.execPath}\n` +
            'X-GNOME-Autostart-enabled=true\n',
          'utf8'
        );
      } else {
        fs.rmSync(file, { force: true });
      }
      return { ok: true, openAtLogin: enabled };
    }
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    return { ok: true, openAtLogin: enabled };
  });

  // --- Экспорт / импорт конфигурации сервера ---
  ipcMain.handle('server:export-config', async (_event, server: ServerPayload) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    if (!win) return { ok: false, error: 'No window' };
    const cfg = readServerConfig(server);
    const payload = {
      app: 'rust-server-manager',
      type: 'server-config',
      version: 1,
      exportedAt: new Date().toISOString(),
      server: { id: server.id, ...pickServerFields(server) },
      serverConfig: cfg.ok ? cfg.config : {},
    };
    const safeName =
      server.name.replace(/[^\wа-яА-ЯёЁ -]/gi, '').trim().replace(/\s+/g, '-') || 'server';
    const result = await dialog.showSaveDialog(win, {
      title: getLocale() === 'ru' ? 'Экспорт настроек сервера' : 'Export server config',
      defaultPath: `${safeName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('server:import-config', async (_event, server: ServerPayload) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    if (!win) return { ok: false, error: 'No window' };
    const result = await dialog.showOpenDialog(win, {
      title: getLocale() === 'ru' ? 'Импорт настроек сервера' : 'Import server config',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as Record<string, unknown>;
      const source = (parsed?.server && typeof parsed.server === 'object' ? parsed.server : parsed) as ServerPayload;
      const merged: ServerPayload = { ...server, ...pickServerFields(source) };
      const cfg = parsed?.serverConfig;
      if (cfg && typeof cfg === 'object') {
        saveServerConfig(merged, cfg as Record<string, string>);
      }
      return {
        ok: true,
        server: merged,
        message: getLocale() === 'ru' ? 'Настройки сервера импортированы' : 'Server settings imported',
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- История метрик (посещаемость) ---
  ipcMain.handle('metrics:history', (_event, serverId: string, sinceMs?: number) =>
    readMetricsHistory(serverId, sinceMs)
  );

  // --- Центр уведомлений ---
  ipcMain.handle('notifications:list', () => listNotifications());
  ipcMain.handle('notifications:mark-all-read', () => {
    markAllNotificationsRead();
    broadcast('notifications:changed', {});
  });
  ipcMain.handle('notifications:clear', () => {
    clearNotifications();
    broadcast('notifications:changed', {});
  });

  // --- Telegram-уведомления ---
  ipcMain.handle('telegram:get-config', (_event, serverId: string) => loadTelegramConfig(serverId));
  ipcMain.handle('telegram:save-config', (_event, payload: { serverId: string; config: TelegramConfig }) =>
    saveTelegramConfig(payload.serverId, payload.config)
  );
  ipcMain.handle('telegram:test', (_event, payload: { config: TelegramConfig }) =>
    sendTelegramTest(payload.config)
  );

  // --- Плагины: вкл/выкл + конфиги ---
  ipcMain.handle('plugins:set-enabled', (_event, payload: { plugin: PluginInfo; enabled: boolean }) =>
    setPluginEnabled(payload.plugin, payload.enabled)
  );
  ipcMain.handle('plugins:read-config', (_event, payload: { server: ServerPayload; pluginName: string }) =>
    readPluginConfig(payload.server, payload.pluginName)
  );
  ipcMain.handle(
    'plugins:save-config',
    (_event, payload: { server: ServerPayload; pluginName: string; config: Record<string, unknown> }) =>
      savePluginConfig(payload.server, payload.pluginName, payload.config)
  );

  // --- Браузер логов ---
  ipcMain.handle('server:log-browser', (_event, server: ServerPayload, maxLines?: number) =>
    readServerLogFile(server, maxLines)
  );

  // --- Порты сервера ---
  ipcMain.handle('ports:check', async (_event, server: ServerPayload) => {
    const st = statusOf(server.id);
    return checkLocalPorts(server, st.pid);
  });
  ipcMain.handle(
    'ports:firewall-status',
    (_event, server: ServerPayload, port: number, protocol: 'TCP' | 'UDP') =>
      getFirewallRule(server, port, protocol)
  );
  ipcMain.handle(
    'ports:firewall-open',
    (_event, server: ServerPayload, port: number, protocol: 'TCP' | 'UDP') =>
      openFirewallPort(server, port, protocol)
  );
  ipcMain.handle(
    'ports:firewall-close',
    (_event, server: ServerPayload, port: number, protocol: 'TCP' | 'UDP') =>
      closeFirewallPort(server, port, protocol)
  );
  ipcMain.handle('ports:probe-external', (_event, host: string, port: number) =>
    probeExternal(host, port)
  );

  // --- Открытие внешних ссылок в браузере по умолчанию ---
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // --- Менеджер модов (Oxide) ---
  ipcMain.handle('mods:status', (_event, server: ServerPayload) => getModsStatus(server));
  ipcMain.handle('mods:install', (_event, server: ServerPayload) => installOxide(server));
  ipcMain.handle('mods:remove', (_event, server: ServerPayload) => removeMod(server));
}

