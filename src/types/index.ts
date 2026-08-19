export type ServerStatus = 'online' | 'offline' | 'crashed' | 'starting' | 'stopping' | 'sim';

export type LicenseType = 'Free' | 'Pro' | 'Enterprise';

export interface RustServer {
  id: string;
  identity: string;
  gamemode?: string;
  levelurl?: string;
  tags?: string[];
  wipeFrequencyTag?: string;
  regionTag?: string;
  description?: string;
  url?: string;
  headerImage?: string;
  logoImage?: string;
  saveInterval?: number;
  additionalArgs?: string;
  autoUpdateOnRestart?: boolean;
  tickrate?: number;
  queryport?: number;
  password?: string;
  eac?: boolean;
  steamBetaBranch?: string;
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
  installPath: string;
  rconHost: string;
  rconPort: number;
  lastError?: string;
  externalPid?: number;
  autoRestartOnCrash?: boolean;
  autoRestartOnHang?: boolean;
  hangTimeoutMinutes?: number;
  startWithManager?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  license: LicenseType;
  registeredAt: string;
}

export type PluginSource = 'oxide';

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
  resourceId?: number;
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

export interface ScheduledWipeEntry extends ScheduledWipe {
  serverId: string;
  server: RustServer;
  createdAt: number;
  lastResult?: string;
}

export interface RconPlayer {
  SteamID: string;
  Name: string;
  Ping: number;
  ConnectedSeconds: number;
  Health?: number;
}

export interface RconBannedPlayer {
  SteamID: string;
  Name: string;
  Reason: string;
  BannedBy: string;
  Time?: number;
}

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
  stage?: 'checking' | 'downloading' | 'validating' | 'done' | 'error';
  downloadedMb?: number;
  totalMb?: number;
  speedMb?: number;
  etaSeconds?: number;
  log?: string[];
}

export interface MarketplacePlugin {
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  downloads: number;
  version?: string;
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

export interface ModStatus {
  installed: boolean;
  remoteVersion?: string;
  localVersion?: string;
  pluginCount?: number;
  error?: string;
}

export interface ModsStatusResult {
  oxide: ModStatus;
}

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
