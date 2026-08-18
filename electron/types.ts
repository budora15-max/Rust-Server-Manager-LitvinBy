// Общие типы для main-процесса Electron.
// Структурно совпадают с типами рендерера (src/types), но не импортируются
// оттуда намеренно: компиляция electron идёт отдельным tsconfig (rootDir).

export interface ServerPayload {
  id: string;
  identity: string;
  /** Игровой режим сервера (конвар gamemode): '' = Vanilla, softcore, hardcore, ... */
  gamemode?: string;
  /** URL кастомной карты (server.levelurl). */
  levelurl?: string;
  /** Теги сервера (server.tags), максимум 3: pve, roleplay, creative, ... */
  tags?: string[];
  /** Тег периодичности вайпов (часть server.tags): weekly / biweekly / monthly. */
  wipeFrequencyTag?: string;
  /** Тег региона сервера (часть server.tags): eu, na, ru, ... */
  regionTag?: string;
  /** Описание сервера (server.description); \n — перевод строки. */
  description?: string;
  /** URL-ссылка сервера (server.url). */
  url?: string;
  /** Картинка сервера (server.headerimage), PNG/JPG 512×256 или 1024×512. */
  headerImage?: string;
  /** Логотип сервера (server.logoimage), PNG/JPG 256×256. */
  logoImage?: string;
  /** Интервал автосохранения в секундах (server.saveinterval; 300 = 5 минут). */
  saveInterval?: number;
  /** Дополнительные аргументы строки запуска. */
  additionalArgs?: string;
  /** Автообновление сервера и Oxide при (пере)запуске через менеджер. */
  autoUpdateOnRestart?: boolean;
  /** Тикрейт сервера (server.tickrate; 30/60/100). */
  tickrate?: number;
  /** Порт query-запросов (server.queryport; по умолчанию порт игры + 1). */
  queryport?: number;
  /** Пароль для входа на сервер (server.password; пусто = без пароля). */
  password?: string;
  /** Античит EAC/VAC (server.secure). */
  eac?: boolean;
  /** Steam-ветка для SteamCMD (например publicbeta; пусто = стабильная). */
  steamBetaBranch?: string;
  name: string;
  installPath: string;
  port: number;
  seed: number;
  worldSize: number;
  maxPlayers: number;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  map: string;
  /** Автоперезапуск при неожиданном падении процесса (по умолчанию true). */
  autoRestartOnCrash?: boolean;
  /** Автоперезапуск при «зависании» (нет вывода заданное время; по умолчанию false). */
  autoRestartOnHang?: boolean;
  /** Минуты без вывода процесса, после которых сервер считается зависшим. */
  hangTimeoutMinutes?: number;
  /** Запускать сервер автоматически при старте менеджера. */
  startWithManager?: boolean;
  [key: string]: unknown;
}

export interface WipeOptions {
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
}

/** Запланированный вайп: хранится в main-процессе и выполняется автоматически. */
export interface ScheduledWipeEntry {
  id: string;
  serverId: string;
  /** Снимок параметров сервера на момент планирования. */
  server: ServerPayload;
  frequency: 'Daily' | 'Weekly' | 'Monthly';
  nextRun: string;
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
  createdAt: number;
  lastResult?: string;
}

/** Игрок из RCON-команды playerlist. */
export interface RconPlayer {
  SteamID: string;
  Name: string;
  Ping: number;
  ConnectedSeconds: number;
  Health?: number;
}

/** Забаненный игрок из RCON-команды banned. */
export interface RconBannedPlayer {
  SteamID: string;
  Name: string;
  Reason: string;
  BannedBy: string;
  Time?: number;
}

export interface PluginInfo {
  id: string;
  fileName: string;
  name: string;
  version: string;
  author: string;
  path: string;
  source: 'oxide';
  sizeBytes: number;
  enabled: boolean;
  /** Oxide ResourceId из заголовка [Info(..., ResourceId = N)]. */
  resourceId?: number;
  /** Актуальная версия на uMod (после проверки обновлений). */
  latestVersion?: string;
  updateAvailable?: boolean;
}

export interface PluginUpdateStatus {
  plugin: PluginInfo;
  latestVersion: string | null;
  updateAvailable: boolean;
  error?: string;
}

export interface MetricSample {
  serverId: string;
  onlinePlayers: number;
  maxPlayers: number;
  fps: number;
  cpu: number;
  memoryMb: number;
  uptimeSeconds: number;
  at: number;
}

export interface ServerConfigResult {
  ok: boolean;
  exists: boolean;
  path: string;
  config: Record<string, string>;
  rawLines: string[];
  message?: string;
}

export interface SaveConfigResult {
  ok: boolean;
  path: string;
  error?: string;
}

export interface SteamUpdateProgress {
  serverId: string;
  message: string;
  pct?: number;
}

export interface MarketplacePlugin {
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  downloads: number;
  /** Актуальная версия на uMod (например v2.0.0). */
  version?: string;
  /** Ссылка на страницу плагина на uMod. */
  url?: string;
}

export type WebhookEventType = 'server-start' | 'server-stop' | 'server-crash' | 'server-wipe';

export interface WebhookConfig {
  url: string;
  notifyStart: boolean;
  notifyStop: boolean;
  notifyCrash: boolean;
  notifyWipe: boolean;
}

export interface RconLineEvent {
  serverId: string;
  kind: 'console' | 'chat' | 'response' | 'system';
  line: string;
  ts: string;
}

export interface RconConnectPayload {
  serverId: string;
  host: string;
  port: number;
  password: string;
}

export type ServerStartResult =
  | { success: true; mode: 'real' | 'sim'; pid?: number; error?: string }
  | { success: false; mode: 'real'; error: string };

export type ServerStopResult = {
  success: boolean;
  mode: 'real' | 'sim';
  error?: string;
};

export interface PluginsListResult {
  ok: boolean;
  mode: 'real' | 'sim';
  source?: 'oxide';
  dir?: string;
  plugins: PluginInfo[];
  error?: 'no-path' | 'no-dir';
  message?: string;
}

export interface WipeResult {
  ok: boolean;
  mode: 'real' | 'sim';
  newSeed?: number;
  deletedFiles: string[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Планировщик задач: перезапуски, автобэкапы, авторазбаны.
// ---------------------------------------------------------------------------

export type ScheduledTaskType = 'restart' | 'restartwarn' | 'backup' | 'unban';

/** Задача планировщика, хранится в userData/scheduled-tasks.json. */
export interface ScheduledTask {
  id: string;
  serverId: string;
  type: ScheduledTaskType;
  /** ISO-время следующего выполнения. */
  nextRun: string;
  createdAt: number;
  /** Снимок параметров сервера (для RCON-подключения и путей). */
  server: ServerPayload;
  /** Ежедневное время перезапуска 'HH:MM'. */
  time?: string;
  /** Минуты предупреждений перед перезапуском (напр. [5, 1]). */
  warnMinutes?: number[];
  /** Текст предупреждения игрокам (для задач типа restartwarn). */
  warnMessage?: string;
  /** Периодичность автобэкапа. */
  frequency?: 'hourly' | 'daily' | 'weekly';
  /** Каждые N часов (для hourly). */
  everyHours?: number;
  /** День недели 0=Вс..6=Сб (для weekly). */
  weekday?: number;
  /** Время 'HH:MM' для daily/weekly автобэкапа. */
  timeOfDay?: string;
  /** Оставлять только последние N бэкапов. */
  retention?: number;
  label?: string;
  playerName?: string;
  steamId?: string;
  reason?: string;
  lastResult?: string;
}

/** Входные данные для создания расписания ежедневного перезапуска. */
export interface RestartScheduleInput {
  serverId: string;
  server: ServerPayload;
  time: string;
  warnMinutes?: number[];
  warnMessages?: string[];
}

/** Входные данные для создания расписания автобэкапа. */
export interface BackupScheduleInput {
  serverId: string;
  server: ServerPayload;
  frequency: 'hourly' | 'daily' | 'weekly';
  everyHours?: number;
  weekday?: number;
  timeOfDay?: string;
  retention?: number;
  label?: string;
}
