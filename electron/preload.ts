import { contextBridge, ipcRenderer } from 'electron';

// Безопасный API-мост между рендерером и main-процессом.
// nodeIntegration выключен, поэтому рендерер видит только то, что здесь.
const api = {
  platform: process.platform,

  // --- Управление процессами Rust-серверов ---
  serverStart: (server: unknown) => ipcRenderer.invoke('server:start', server),
  serverStop: (server: unknown) => ipcRenderer.invoke('server:stop', server),
  serverRestart: (server: unknown) => ipcRenderer.invoke('server:restart', server),
  serverStatus: (id: string) => ipcRenderer.invoke('server:status', id),
  serverFindExe: (installPath: string) => ipcRenderer.invoke('server:find-exe', installPath),
  serverDetectExternal: (servers: unknown[]) =>
    ipcRenderer.invoke('server:detect-external', servers),
  serverLogTail: (server: unknown, fromOffset: number, opts?: { sessionStart?: boolean }) =>
    ipcRenderer.invoke('server:log-tail', server, fromOffset, opts),
  onServerProcessExit: (callback: (event: { serverId: string; code: number | null }) => void) => {
    const listener = (_evt: unknown, data: { serverId: string; code: number | null }) => callback(data);
    ipcRenderer.on('server:process-exit', listener);
    return () => {
      ipcRenderer.removeListener('server:process-exit', listener);
    };
  },
  onServerAutoRestart: (callback: (event: { serverId: string; attempt: number; delayMs: number }) => void) => {
    const listener = (
      _evt: unknown,
      data: { serverId: string; attempt: number; delayMs: number }
    ) => callback(data);
    ipcRenderer.on('server:auto-restart', listener);
    return () => {
      ipcRenderer.removeListener('server:auto-restart', listener);
    };
  },
  onServerProcessRunning: (callback: (event: { serverId: string; pid?: number }) => void) => {
    const listener = (_evt: unknown, data: { serverId: string; pid?: number }) => callback(data);
    ipcRenderer.on('server:process-running', listener);
    return () => {
      ipcRenderer.removeListener('server:process-running', listener);
    };
  },
  onServerLog: (
    callback: (event: { serverId: string; stream: 'stdout' | 'stderr'; line: string }) => void
  ) => {
    const listener = (
      _evt: unknown,
      data: { serverId: string; stream: 'stdout' | 'stderr'; line: string }
    ) => callback(data);
    ipcRenderer.on('server:log', listener);
    return () => {
      ipcRenderer.removeListener('server:log', listener);
    };
  },

  // --- Телеметрия ---
  metricsLast: (serverId: string) => ipcRenderer.invoke('metrics:last', serverId),
  onMetrics: (callback: (sample: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('metrics:data', listener);
    return () => {
      ipcRenderer.removeListener('metrics:data', listener);
    };
  },

  // --- Системная память (занято всеми процессами / общий объём) ---
  systemMemory: () => ipcRenderer.invoke('system:memory'),

  // --- WebRcon ---
  rconConnect: (payload: unknown) => ipcRenderer.invoke('rcon:connect', payload),
  rconDisconnect: (serverId: string) => ipcRenderer.invoke('rcon:disconnect', serverId),
  rconSend: (serverId: string, command: string) =>
    ipcRenderer.invoke('rcon:send', { serverId, command }),
  rconStatus: () => ipcRenderer.invoke('rcon:status'),
  rconPlayerlist: (serverId: string) => ipcRenderer.invoke('rcon:playerlist', serverId),
  rconBannedlist: (serverId: string) => ipcRenderer.invoke('rcon:bannedlist', serverId),
  rconPlayerAction: (payload: unknown) => ipcRenderer.invoke('rcon:player-action', payload),
  onRconLine: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('rcon:line', listener);
    return () => {
      ipcRenderer.removeListener('rcon:line', listener);
    };
  },

  // --- Карта мира ---
  mapGetPreview: (server: unknown) => ipcRenderer.invoke('map:get-preview', server),
  mapCapture: (server: unknown) => ipcRenderer.invoke('map:capture', server),
  mapRusteditInfo: (server: unknown) => ipcRenderer.invoke('map:rustedit-info', server),
  mapOpenInRustedit: (server: unknown) => ipcRenderer.invoke('map:open-in-rustedit', server),

  // --- Плагины Oxide ---
  pluginsList: (server: unknown) => ipcRenderer.invoke('plugins:list', server),
  pluginsDelete: (filePath: string) => ipcRenderer.invoke('plugins:delete', { filePath }),
  pluginsUpdate: (plugin: unknown) => ipcRenderer.invoke('plugins:update', { plugin }),
  pluginsCheckUpdates: (server: unknown) => ipcRenderer.invoke('plugins:check-updates', server),
  pluginsUpdateAll: (server: unknown) => ipcRenderer.invoke('plugins:update-all', server),

  // --- Marketplace плагинов ---
  marketplaceGetList: (lang: string) => ipcRenderer.invoke('marketplace:get-list', lang),
  marketplaceSearch: (query: string) => ipcRenderer.invoke('marketplace:search', query),
  marketplaceInstall: (server: unknown, slug: string) =>
    ipcRenderer.invoke('marketplace:install', { server, slug }),

  // --- Установка плагина с диска ---
  pluginsPickDir: () => ipcRenderer.invoke('plugins:pick-dir'),
  pluginsInstallFromDisk: (server: unknown, dir: string, fileName: string) =>
    ipcRenderer.invoke('plugins:install-from-disk', { server, dir, fileName }),

  // --- Конфигурация server.cfg ---
  configRead: (server: unknown) => ipcRenderer.invoke('config:read', server),
  configSave: (server: unknown, config: unknown) =>
    ipcRenderer.invoke('config:save', { server, config }),

  // --- Обновление серверной части (SteamCMD) ---
  serverUpdate: (server: unknown) => ipcRenderer.invoke('server:update', server),
  serverUpdateCancel: () => ipcRenderer.invoke('server:update-cancel'),
  onServerUpdateProgress: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('server:update-progress', listener);
    return () => {
      ipcRenderer.removeListener('server:update-progress', listener);
    };
  },

  // --- Вайпы ---
  wipeExecute: (server: unknown, options: unknown) =>
    ipcRenderer.invoke('wipe:execute', { server, options }),

  // --- Планирование вайпов ---
  wipesList: () => ipcRenderer.invoke('wipes:scheduled-list'),
  wipesAdd: (entry: unknown) => ipcRenderer.invoke('wipes:scheduled-add', entry),
  wipesRemove: (id: string) => ipcRenderer.invoke('wipes:scheduled-remove', id),
  onWipeExecuted: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('wipes:executed', listener);
    return () => ipcRenderer.removeListener('wipes:executed', listener);
  },
  onWipeScheduleChanged: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('wipes:schedule-changed', listener);
    return () => ipcRenderer.removeListener('wipes:schedule-changed', listener);
  },
  onServerSeedChanged: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('server:seed-changed', listener);
    return () => ipcRenderer.removeListener('server:seed-changed', listener);
  },

  // --- Бэкапы мира ---
  backupCreate: (server: unknown, label?: string) =>
    ipcRenderer.invoke('backup:create', server, label),
  backupList: (server: unknown) => ipcRenderer.invoke('backup:list', server),
  backupRestore: (server: unknown, backupId: string) =>
    ipcRenderer.invoke('backup:restore', server, backupId),
  backupDelete: (server: unknown, backupId: string) =>
    ipcRenderer.invoke('backup:delete', server, backupId),

  // --- Discord Webhooks ---
  webhookGetConfig: (serverId: string) => ipcRenderer.invoke('webhook:get-config', serverId),
  webhookSaveConfig: (serverId: string, config: unknown) =>
    ipcRenderer.invoke('webhook:save-config', { serverId, config }),
  webhookTest: (config: unknown) => ipcRenderer.invoke('webhook:test', { config }),

  // --- Локализация ---
  getLocale: () => ipcRenderer.invoke('locale:get'),
  setLocale: (lng: string) => ipcRenderer.invoke('locale:set', lng),

  // --- Синхронизация списка серверов с main (трей / автозапуск) ---
  syncServers: (servers: unknown[]) => ipcRenderer.invoke('server:sync-servers', servers),

  // --- Планировщик задач: перезапуски / автобэкапы / авторазбаны ---
  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksAddRestart: (input: unknown) => ipcRenderer.invoke('tasks:add-restart', input),
  tasksAddBackup: (input: unknown) => ipcRenderer.invoke('tasks:add-backup', input),
  tasksRemove: (id: string) => ipcRenderer.invoke('tasks:remove', id),
  onTasksChanged: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('tasks:changed', listener);
    return () => {
      ipcRenderer.removeListener('tasks:changed', listener);
    };
  },

  // --- Автозапуск менеджера с Windows ---
  appGetAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  appSetAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('app:set-auto-launch', enabled),

  // --- Экспорт / импорт конфигурации сервера ---
  serverExportConfig: (server: unknown) => ipcRenderer.invoke('server:export-config', server),
  serverImportConfig: (server: unknown) => ipcRenderer.invoke('server:import-config', server),

  // --- История метрик (посещаемость) ---
  metricsHistory: (serverId: string, sinceMs?: number) =>
    ipcRenderer.invoke('metrics:history', serverId, sinceMs),

  // --- Центр уведомлений ---
  notificationsList: () => ipcRenderer.invoke('notifications:list'),
  notificationsMarkAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  notificationsClear: () => ipcRenderer.invoke('notifications:clear'),
  onNotificationsChanged: (callback: (event: unknown) => void) => {
    const listener = (_evt: unknown, data: unknown) => callback(data);
    ipcRenderer.on('notifications:changed', listener);
    return () => {
      ipcRenderer.removeListener('notifications:changed', listener);
    };
  },

  // --- Telegram-уведомления ---
  telegramGetConfig: (serverId: string) => ipcRenderer.invoke('telegram:get-config', serverId),
  telegramSaveConfig: (serverId: string, config: unknown) =>
    ipcRenderer.invoke('telegram:save-config', { serverId, config }),
  telegramTest: (config: unknown) => ipcRenderer.invoke('telegram:test', { config }),

  // --- Плагины: вкл/выкл + конфиги ---
  pluginsSetEnabled: (plugin: unknown, enabled: boolean) =>
    ipcRenderer.invoke('plugins:set-enabled', { plugin, enabled }),
  pluginsReadConfig: (server: unknown, pluginName: string) =>
    ipcRenderer.invoke('plugins:read-config', { server, pluginName }),
  pluginsSaveConfig: (server: unknown, pluginName: string, config: unknown) =>
    ipcRenderer.invoke('plugins:save-config', { server, pluginName, config }),

  // --- Браузер логов ---
  serverLogBrowser: (server: unknown, maxLines?: number) =>
    ipcRenderer.invoke('server:log-browser', server, maxLines),

  // --- Порты сервера ---
  portsCheck: (server: unknown) => ipcRenderer.invoke('ports:check', server),
  portsFirewallStatus: (server: unknown, port: number, protocol: 'TCP' | 'UDP') =>
    ipcRenderer.invoke('ports:firewall-status', server, port, protocol),
  portsFirewallOpen: (server: unknown, port: number, protocol: 'TCP' | 'UDP') =>
    ipcRenderer.invoke('ports:firewall-open', server, port, protocol),
  portsFirewallClose: (server: unknown, port: number, protocol: 'TCP' | 'UDP') =>
    ipcRenderer.invoke('ports:firewall-close', server, port, protocol),
  portsProbeExternal: (host: string, port: number) =>
    ipcRenderer.invoke('ports:probe-external', host, port),

  // --- Открытие внешних ссылок в браузере по умолчанию ---
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

  // --- Менеджер модов (Oxide) ---
  modsStatus: (server: unknown) => ipcRenderer.invoke('mods:status', server),
  modsInstall: (server: unknown) => ipcRenderer.invoke('mods:install', server),
  modsRemove: (server: unknown) => ipcRenderer.invoke('mods:remove', server),

  // --- Системные ---
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
};

contextBridge.exposeInMainWorld('rustManager', api);

export type RustManagerApi = typeof api;

