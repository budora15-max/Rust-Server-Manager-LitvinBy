import pidusage from 'pidusage';
import type { RconManager } from './rcon';
import type { ServerPayload } from './types';

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

const TICK_MS = 5_000;
const RCON_POLL_TICKS = 2;
const RCON_RECONNECT_MS = 30_000;
const AUTH_BACKOFF_MS = 10 * 60_000;
const AUTH_FAIL_LIMIT = 3;

interface ParsedServerInfo {
  online: number;
  max: number;
  framerate?: number;
}

function parseServerInfo(text: string): ParsedServerInfo | null {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const players = Number(obj.Players);
      const max = Number(obj.MaxPlayers);
      if (!Number.isNaN(players) && !Number.isNaN(max)) {
        const framerate = Number(obj.Framerate);
        return {
          online: players,
          max,
          framerate: Number.isNaN(framerate) ? undefined : framerate,
        };
      }
    }
  } catch {
  }
  const m = /Players:\s*(\d+)\s*\/\s*(\d+)/i.exec(text);
  if (m) return { online: Number(m[1]), max: Number(m[2]) };
  return null;
}

function parseFps(text: string): number | null {
  const m1 = /([\d.]+)\s*fps/i.exec(text);
  if (m1) return Number(m1[1]);
  const m2 = /(?:server\s+)?fps:\s*([\d.]+)/i.exec(text);
  if (m2) return Number(m2[1]);
  return null;
}

export function parseServerInfoLine(text: string): { online: number; max: number } | null {
  return parseServerInfo(text);
}

export function parseFpsLine(text: string): number | null {
  return parseFps(text);
}

export class MetricsCollector {
  private timers = new Map<string, NodeJS.Timeout>();
  private ticks = new Map<string, number>();
  private lastConnectAt = new Map<string, number>();
  private lastSample = new Map<string, MetricSample>();
  private authFailures = new Map<string, number>();
  private lastAuthFailAt = new Map<string, number>();

  constructor(
    private readonly rcon: RconManager,
    private readonly emit: (sample: MetricSample) => void
  ) {}

  last(serverId: string): MetricSample | undefined {
    return this.lastSample.get(serverId);
  }

  start(server: ServerPayload, pid?: number): void {
    if (this.timers.has(server.id)) return;
    this.ticks.set(server.id, 0);
    const timer = setInterval(() => this.tick(server, pid), TICK_MS);
    this.timers.set(server.id, timer);
  }

  stop(serverId: string): void {
    const timer = this.timers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(serverId);
    }
    this.ticks.delete(serverId);
    this.lastConnectAt.delete(serverId);
    this.lastSample.delete(serverId);
    this.authFailures.delete(serverId);
    this.lastAuthFailAt.delete(serverId);
  }

  stopAll(): void {
    for (const id of Array.from(this.timers.keys())) this.stop(id);
  }

  private async tick(server: ServerPayload, pid?: number): Promise<void> {
    const tick = (this.ticks.get(server.id) ?? 0) + 1;
    this.ticks.set(server.id, tick);

    if (pid && !this.rcon.isConnected(server.id)) {
      const last = this.lastConnectAt.get(server.id) ?? 0;
      if (Date.now() - last > RCON_RECONNECT_MS) {
        const fails = this.authFailures.get(server.id) ?? 0;
        const lastFail = this.lastAuthFailAt.get(server.id) ?? 0;
        if (fails >= AUTH_FAIL_LIMIT && Date.now() - lastFail < AUTH_BACKOFF_MS) {
          this.lastConnectAt.set(server.id, Date.now());
        } else {
          this.lastConnectAt.set(server.id, Date.now());
          this.rcon
            .connect({
              serverId: server.id,
              host: server.rconHost,
              port: server.rconPort,
              password: server.rconPassword,
            })
            .then((res) => {
              if (res.ok) {
                this.authFailures.set(server.id, 0);
              } else {
                this.authFailures.set(server.id, fails + 1);
                this.lastAuthFailAt.set(server.id, Date.now());
              }
            })
            .catch(() => {
              this.authFailures.set(server.id, fails + 1);
              this.lastAuthFailAt.set(server.id, Date.now());
            });
        }
      }
    }

    let cpu = 0;
    let memoryMb = 0;
    let uptimeSeconds = 0;
    if (pid) {
      try {
        const stat = await pidusage(pid);
        cpu = Math.min(100, Math.round(stat.cpu));
        memoryMb = Math.round(stat.memory / (1024 * 1024));
        uptimeSeconds = Math.round(stat.elapsed);
      } catch {
      }
    }

    const prev = this.lastSample.get(server.id);
    let online = prev?.onlinePlayers ?? 0;
    let max = prev?.maxPlayers ?? 0;
    let fps = prev?.fps ?? 0;

    if (tick % RCON_POLL_TICKS === 0 && this.rcon.isConnected(server.id)) {
      const [infoText, fpsText] = await Promise.all([
        this.rcon.request(server.id, 'serverinfo'),
        this.rcon.request(server.id, 'fps'),
      ]);
      const parsed = infoText ? parseServerInfo(infoText) : null;
      if (parsed) {
        online = parsed.online;
        max = parsed.max;
        if (parsed.framerate !== undefined) fps = Math.round(parsed.framerate);
      }
      if (fps === 0 && fpsText) {
        const parsedFps = parseFps(fpsText);
        if (parsedFps !== null) fps = Math.round(parsedFps);
      }
    }

    const sample: MetricSample = {
      serverId: server.id,
      onlinePlayers: online,
      maxPlayers: max,
      fps,
      cpu,
      memoryMb,
      uptimeSeconds,
      at: Date.now(),
    };
    this.lastSample.set(server.id, sample);
    this.emit(sample);
  }
}
