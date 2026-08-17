export type ServerStatus = 'online' | 'offline' | 'crashed' | 'starting' | 'stopping' | 'sim';

export type LicenseType = 'Free' | 'Pro' | 'Enterprise';

export interface RustServer {
  id: string;
  identity: string;
  name: string;
  status: ServerStatus;
  onlinePlayers: number;
  maxPlayers: number;
  cpu: number;
  ram: number;
  seed: number;
  worldSize: number;
  port: number;
  rconPassword: string;
  map: string;
  uptimeSeconds: number;
  installedPlugins: number;
  /** Папка установки Rust-сервера (где лежит RustDedicatedServer.exe или RustDedicated.exe). Пусто = симуляция. */
  installPath: string;
  rconHost: string;
  /** Порт WebRcon; по умолчанию порт игры + 2. */
  rconPort: number;
  /** Текст последней ошибки запуска/остановки сервера (если есть). */
  lastError?: string;
  /** PID процесса, обнаруженного в ОС (запущен вне менеджера или после рестарта менеджера). */
  externalPid?: number;
  /** Автоперезапуск при неожиданном падении процесса (по умолчанию true). */
  autoRestartOnCrash?: boolean;
  /** Автоперезапуск при «зависании» — нет вывода процесса заданное время (по умолчанию false). */
  autoRestartOnHang?: boolean;
  /** Минуты без вывода процесса, после которых сервер считается зависшим. */
  hangTimeoutMinutes?: number;
  /** Запускать сервер автоматически при старте менеджера. */
  startWithManager?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  license: LicenseType;
  registeredAt: string;
}

export type PluginSource = 'oxide' | 'carbon';

export interface PluginInfo {
  id: string;
  fileName: string;
  name: string;
  version: string;
  author: string;
  path: string;
  source: PluginSource;
  sizeBytes: number;
  enabled: boolean;
  /** Oxide ResourceId из заголовка [Info(..., ResourceId = N)]. */
  resourceId?: number;
  /** Актуальная версия на uMod (после проверки обновлений). */
  latestVersion?: string;
  updateAvailable?: boolean;
}

export interface ScheduledWipe {
  id: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly';
  nextRun: string;
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
}

/** Запланированный вайп с привязкой к серверу (хранится в main-процессе). */
export interface ScheduledWipeEntry extends ScheduledWipe {
  serverId: string;
  server: RustServer;
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

/** Резервная копия мира. */
export interface BackupEntry {
  id: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
  fileCount: number;
  label: string;
}

export interface WipeOptions {
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
}

export interface RconLineEvent {
  serverId: string;
  kind: 'console' | 'chat' | 'response' | 'system';
  line: string;
  ts: string;
}

// --- Результаты IPC-вызовов ---

export interface ServerStartResult {
  success: boolean;
  mode: 'real' | 'sim';
  pid?: number;
  error?: string;
}

export interface ServerStopResult {
  success: boolean;
  mode: 'real' | 'sim';
  error?: string;
}

export interface PluginsListResult {
  ok: boolean;
  mode: 'real' | 'sim';
  source?: PluginSource;
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

// --- Телеметрия / конфиги / обновления ---

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

export interface PluginUpdateStatus {
  plugin: PluginInfo;
  latestVersion: string | null;
  updateAvailable: boolean;
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

// --- Центр уведомлений ---

export interface NotificationEntry {
  id: string;
  at: number;
  serverId?: string;
  serverName?: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
}

// --- Порты сервера ---

export type PortState = 'free' | 'used' | 'managed' | 'unknown';

export interface PortStatus {
  key: string;
  label: string;
  port: number;
  protocol: 'TCP' | 'UDP';
  state: PortState;
  pid?: number;
  process?: string;
}

export interface FirewallRuleStatus {
  exists: boolean;
  enabled: boolean;
  error?: string;
}

export interface ExternalProbeResult {
  ok: boolean;
  reachable?: boolean;
  error?: string;
}

// --- Менеджер модов (Oxide / Carbon) ---

export type ModKind = 'oxide' | 'carbon';

export interface ModStatus {
  installed: boolean;
  remoteVersion?: string;
  localVersion?: string;
  pluginCount?: number;
  error?: string;
}

export interface ModsStatusResult {
  oxide: ModStatus;
  carbon: ModStatus;
}

// --- Telegram-уведомления ---

export interface TelegramConfig {
  token: string;
  chatId: string;
  notifyStart: boolean;
  notifyStop: boolean;
  notifyCrash: boolean;
  notifyWipe: boolean;
  notifyRestart: boolean;
  notifyBackup: boolean;
}

// --- Планировщик задач: перезапуски / автобэкапы / авторазбаны ---

export type ScheduledTaskType = 'restart' | 'restartwarn' | 'backup' | 'unban';

export interface ScheduledTask {
  id: string;
  serverId: string;
  type: ScheduledTaskType;
  nextRun: string;
  createdAt: number;
  server: RustServer;
  time?: string;
  warnMinutes?: number[];
  warnMessage?: string;
  frequency?: 'hourly' | 'daily' | 'weekly';
  everyHours?: number;
  weekday?: number;
  timeOfDay?: string;
  retention?: number;
  label?: string;
  playerName?: string;
  steamId?: string;
  reason?: string;
  lastResult?: string;
}

export interface RestartScheduleInput {
  serverId: string;
  server: RustServer;
  time: string;
  warnMinutes?: number[];
  warnMessages?: string[];
}

export interface BackupScheduleInput {
  serverId: string;
  server: RustServer;
  frequency: 'hourly' | 'daily' | 'weekly';
  everyHours?: number;
  weekday?: number;
  timeOfDay?: string;
  retention?: number;
  label?: string;
}

