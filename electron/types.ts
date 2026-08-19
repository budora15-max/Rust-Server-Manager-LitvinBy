export interface ServerPayload {
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
  installPath: string;
  port: number;
  seed: number;
  worldSize: number;
  maxPlayers: number;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  map: string;
  autoRestartOnCrash?: boolean;
  autoRestartOnHang?: boolean;
  hangTimeoutMinutes?: number;
  startWithManager?: boolean;
  [key: string]: unknown;
}

export interface WipeOptions {
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
}

export interface ScheduledWipeEntry {
  id: string;
  serverId: string;
  server: ServerPayload;
  frequency: 'Daily' | 'Weekly' | 'Monthly';
  nextRun: string;
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
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
  resourceId?: number;
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

export type ScheduledTaskType = 'restart' | 'restartwarn' | 'backup' | 'unban';

export interface ScheduledTask {
  id: string;
  serverId: string;
  type: ScheduledTaskType;
  nextRun: string;
  createdAt: number;
  server: ServerPayload;
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
  server: ServerPayload;
  time: string;
  warnMinutes?: number[];
  warnMessages?: string[];
}

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
