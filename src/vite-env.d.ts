/// <reference types="vite/client" />
import type {
  BackupEntry,
  BackupScheduleInput,
  ExternalProbeResult,
  FirewallRuleStatus,
  MetricSample,
  MarketplacePlugin,
  ModsStatusResult,
  NotificationEntry,
  PluginInfo,
  PluginUpdateStatus,
  PluginsListResult,
  PortStatus,
  RconBannedPlayer,
  RconLineEvent,
  RconPlayer,
  RestartScheduleInput,
  RustServer,
  SaveConfigResult,
  ScheduledTask,
  ScheduledWipeEntry,
  ServerConfigResult,
  ServerStartResult,
  ServerStopResult,
  SteamUpdateProgress,
  TelegramConfig,
  WebhookConfig,
  WipeOptions,
  WipeResult,
} from './types';

declare global {
  interface Window {
    /** Мост, предоставляемый preload-скриптом Electron. */
    rustManager?: {
      platform: string;

      serverStart: (server: RustServer) => Promise<ServerStartResult>;
      serverStop: (server: RustServer) => Promise<ServerStopResult>;
      serverRestart: (server: RustServer) => Promise<ServerStartResult>;
      serverStatus: (id: string) => Promise<{ running: boolean; pid?: number }>;
      serverFindExe: (
        installPath: string
      ) => Promise<{ found: boolean; exePath?: string; searched: string[] }>;
      serverDetectExternal: (servers: RustServer[]) => Promise<Record<string, number>>;
      serverLogTail: (
        server: RustServer,
        fromOffset: number,
        opts?: { sessionStart?: boolean }
      ) => Promise<{ offset: number; lines: string[] }>;
      onServerProcessExit: (
        callback: (event: { serverId: string; code: number | null }) => void
      ) => () => void;
      onServerAutoRestart: (
        callback: (event: { serverId: string; attempt: number; delayMs: number }) => void
      ) => () => void;
      onServerProcessRunning: (
        callback: (event: { serverId: string; pid?: number }) => void
      ) => () => void;
      onServerLog: (
        callback: (event: { serverId: string; stream: 'stdout' | 'stderr'; line: string }) => void
      ) => () => void;

      metricsLast: (serverId: string) => Promise<MetricSample | undefined>;
      onMetrics: (callback: (sample: MetricSample) => void) => () => void;
      systemMemory: () => Promise<{ totalMb: number; usedMb: number; freeMb: number }>;

      rconConnect: (payload: {
        serverId: string;
        host: string;
        port: number;
        password: string;
      }) => Promise<{ ok: boolean; connected: boolean; error?: string }>;
      rconDisconnect: (serverId: string) => Promise<{ ok: boolean }>;
      rconSend: (serverId: string, command: string) => Promise<{ ok: boolean; error?: string }>;
      rconStatus: () => Promise<Record<string, boolean>>;
      rconPlayerlist: (
        serverId: string
      ) => Promise<{ ok: boolean; players?: RconPlayer[]; error?: string; raw?: string }>;
      rconBannedlist: (
        serverId: string
      ) => Promise<{ ok: boolean; players?: RconBannedPlayer[]; error?: string; raw?: string }>;
      rconPlayerAction: (payload: {
        serverId: string;
        action: 'kick' | 'ban' | 'unban';
        target: string;
        reason?: string;
        durationMinutes?: number;
        server?: RustServer;
      }) => Promise<{
        ok: boolean;
        message?: string;
        error?: string;
        unbanTaskId?: string;
        unbanAt?: string;
      }>;
      onRconLine: (callback: (event: RconLineEvent) => void) => () => void;

      mapGetPreview: (server: RustServer) => Promise<{
        ok: boolean;
        dataUrl?: string;
        fileName?: string;
        error?: string;
      }>;
      mapCapture: (server: RustServer) => Promise<{ ok: boolean; error?: string }>;

      pluginsList: (server: RustServer) => Promise<PluginsListResult>;
      pluginsDelete: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      pluginsUpdate: (
        plugin: PluginInfo
      ) => Promise<{ ok: boolean; error?: string; message?: string }>;
      pluginsCheckUpdates: (server: RustServer) => Promise<PluginUpdateStatus[]>;
      pluginsUpdateAll: (
        server: RustServer
      ) => Promise<Array<{ name: string; ok: boolean; message?: string; error?: string }>>;

      marketplaceGetList: (lang: string) => Promise<MarketplacePlugin[]>;
      marketplaceSearch: (query: string) => Promise<MarketplacePlugin[]>;
      marketplaceInstall: (
        server: RustServer,
        slug: string
      ) => Promise<{ ok: boolean; message?: string; error?: string }>;

      configRead: (server: RustServer) => Promise<ServerConfigResult>;
      configSave: (
        server: RustServer,
        config: Record<string, string>
      ) => Promise<SaveConfigResult>;

      serverUpdate: (server: RustServer) => Promise<{ ok: boolean; error?: string }>;
      onServerUpdateProgress: (callback: (event: SteamUpdateProgress) => void) => () => void;

      wipeExecute: (server: RustServer, options: WipeOptions) => Promise<WipeResult>;

      wipesList: () => Promise<ScheduledWipeEntry[]>;
      wipesAdd: (entry: ScheduledWipeEntry) => Promise<ScheduledWipeEntry[]>;
      wipesRemove: (id: string) => Promise<ScheduledWipeEntry[]>;
      onWipeExecuted: (callback: (event: {
        serverId: string;
        ok: boolean;
        newSeed?: number;
        deleted: number;
        message?: string;
        restarted: boolean;
      }) => void) => () => void;
      onWipeScheduleChanged: (callback: () => void) => () => void;
      onServerSeedChanged: (callback: (event: { serverId: string; seed: number }) => void) => () => void;

      backupCreate: (
        server: RustServer,
        label?: string
      ) => Promise<{ ok: boolean; error?: string; entry?: BackupEntry }>;
      backupList: (server: RustServer) => Promise<BackupEntry[]>;
      backupRestore: (
        server: RustServer,
        backupId: string
      ) => Promise<{ ok: boolean; error?: string; entry?: BackupEntry }>;
      backupDelete: (
        server: RustServer,
        backupId: string
      ) => Promise<{ ok: boolean; error?: string }>;

      webhookGetConfig: (serverId: string) => Promise<WebhookConfig>;
      webhookSaveConfig: (
        serverId: string,
        config: WebhookConfig
      ) => Promise<{ ok: boolean; error?: string }>;
      webhookTest: (
        config: WebhookConfig
      ) => Promise<{ ok: boolean; status?: number; error?: string }>;

      getLocale: () => Promise<string>;
      setLocale: (lng: string) => Promise<string>;

      syncServers: (servers: RustServer[]) => Promise<void>;

      metricsHistory: (serverId: string, sinceMs?: number) => Promise<MetricSample[]>;

      notificationsList: () => Promise<NotificationEntry[]>;
      notificationsMarkAllRead: () => Promise<void>;
      notificationsClear: () => Promise<void>;
      onNotificationsChanged: (callback: () => void) => () => void;

      telegramGetConfig: (serverId: string) => Promise<TelegramConfig>;
      telegramSaveConfig: (
        serverId: string,
        config: TelegramConfig
      ) => Promise<{ ok: boolean; error?: string }>;
      telegramTest: (
        config: TelegramConfig
      ) => Promise<{ ok: boolean; status?: number; error?: string }>;

      pluginsSetEnabled: (
        plugin: PluginInfo,
        enabled: boolean
      ) => Promise<{ ok: boolean; message?: string; error?: string }>;
      pluginsReadConfig: (
        server: RustServer,
        pluginName: string
      ) => Promise<{ ok: boolean; path?: string; config?: Record<string, unknown>; error?: string }>;
      pluginsSaveConfig: (
        server: RustServer,
        pluginName: string,
        config: Record<string, unknown>
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;

      serverLogBrowser: (
        server: RustServer,
        maxLines?: number
      ) => Promise<{ ok: boolean; path?: string; lines: string[]; total?: number; error?: string }>;

      portsCheck: (server: RustServer) => Promise<PortStatus[]>;
      portsFirewallStatus: (
        server: RustServer,
        port: number,
        protocol: 'TCP' | 'UDP'
      ) => Promise<FirewallRuleStatus>;
      portsFirewallOpen: (
        server: RustServer,
        port: number,
        protocol: 'TCP' | 'UDP'
      ) => Promise<FirewallRuleStatus>;
      portsFirewallClose: (
        server: RustServer,
        port: number,
        protocol: 'TCP' | 'UDP'
      ) => Promise<FirewallRuleStatus>;
      portsProbeExternal: (host: string, port: number) => Promise<ExternalProbeResult>;

      openExternal: (url: string) => Promise<void>;

      modsStatus: (server: RustServer) => Promise<ModsStatusResult>;
      modsInstall: (server: RustServer) => Promise<ModStatus>;
      modsRemove: (server: RustServer) => Promise<{ ok: boolean; error?: string }>;

      tasksList: () => Promise<ScheduledTask[]>;
      tasksAddRestart: (input: RestartScheduleInput) => Promise<ScheduledTask[]>;
      tasksAddBackup: (input: BackupScheduleInput) => Promise<ScheduledTask[]>;
      tasksRemove: (id: string) => Promise<ScheduledTask[]>;
      onTasksChanged: (callback: () => void) => () => void;

      appGetAutoLaunch: () => Promise<{ openAtLogin: boolean }>;
      appSetAutoLaunch: (
        enabled: boolean
      ) => Promise<{ ok: boolean; openAtLogin: boolean }>;

      serverExportConfig: (
        server: RustServer
      ) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      serverImportConfig: (
        server: RustServer
      ) => Promise<{
        ok: boolean;
        canceled?: boolean;
        server?: RustServer;
        message?: string;
        error?: string;
      }>;

      pickFolder: () => Promise<string | null>;
    };
  }
}

export {};

