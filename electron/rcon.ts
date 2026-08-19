import { webContents } from 'electron';
import WebSocket from 'ws';
import type { RconConnectPayload, RconLineEvent } from './types';

const HEARTBEAT_MS = 20_000;

interface AuthResult {
  ok: boolean;
  error?: string;
}

function normalizeConnectError(message: string): string {
  if (/Parse Error|Expected HTTP/i.test(message)) {
    return 'Non-WebSocket response — check that the port is the RCON port (usually game port + 2) and rcon.web 1 is enabled';
  }
  return message;
}

class RconClient {
  private ws: WebSocket | null = null;
  private hbTimer: NodeJS.Timeout | null = null;
  private hbId = 1000;
  private nextId = 2;
  private authResolver: ((r: AuthResult) => void) | null = null;
  private pending = new Map<number, (message: string) => void>();

  constructor(
    private readonly serverId: string,
    private readonly emit: (event: RconLineEvent) => void
  ) {}

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(host: string, port: number, password: string): Promise<AuthResult> {
    if (this.connected) return Promise.resolve({ ok: true });

    return new Promise((resolve) => {
      const state = { settled: false };

      const overallTimer = setTimeout(() => {
        if (!state.settled) {
          state.settled = true;
          resolve({ ok: false, error: 'Connection timeout' });
        }
      }, 15_000);

      const finish = (result: AuthResult) => {
        if (state.settled) return;
        state.settled = true;
        clearTimeout(overallTimer);
        resolve(result);
      };

      this.openSocket(host, port, password, true, finish, state);
    });
  }

  private openSocket(
    host: string,
    port: number,
    password: string,
    useUrlPassword: boolean,
    finish: (r: AuthResult) => void,
    state: { settled: boolean }
  ): void {
    const url = useUrlPassword
      ? `ws://${host}:${port}/${encodeURIComponent(password)}`
      : `ws://${host}:${port}/rcon`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.log('system', `WebRcon: connected to ${url}`);
      if (useUrlPassword) {
        this.startHeartbeat();
        this.log('system', 'WebRcon: authenticated (password in URL)');
        finish({ ok: true });
        return;
      }

      const authTimer = setTimeout(() => {
        const resolver = this.authResolver;
        this.authResolver = null;
        if (resolver) resolver({ ok: false, error: 'Auth timeout' });
        else finish({ ok: false, error: 'Auth timeout' });
      }, 10_000);

      this.authResolver = (result) => {
        clearTimeout(authTimer);
        if (result.ok) {
          this.startHeartbeat();
          this.log('system', 'WebRcon: authenticated successfully');
        } else {
          this.log('system', `WebRcon: auth failed — ${result.error ?? 'unknown error'}`);
        }
        finish(result);
      };

      try {
        this.ws?.send(JSON.stringify({ Identifier: 1, Message: 'rcon.login', Name: password }));
      } catch (err) {
        const resolver = this.authResolver;
        this.authResolver = null;
        if (resolver) resolver({ ok: false, error: err instanceof Error ? err.message : String(err) });
        else finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    ws.on('message', (data) => {
      try {
        this.handleMessage(String(data));
      } catch {
      }
    });

    ws.on('error', (err) => {
      const message = normalizeConnectError(err.message);
      if (useUrlPassword && !state.settled) {
        try {
          ws.terminate();
        } catch {
        }
        this.openSocket(host, port, password, false, finish, state);
        return;
      }
      const resolver = this.authResolver;
      this.authResolver = null;
      if (resolver) resolver({ ok: false, error: message });
      else finish({ ok: false, error: message });
    });

    ws.on('close', (code) => {
      this.stopHeartbeat();
      this.log('system', `WebRcon: disconnected (${code})`);
      const isCurrent = this.ws === ws;
      if (!isCurrent) return;
      this.ws = null;
      const resolver = this.authResolver;
      this.authResolver = null;
      if (resolver) resolver({ ok: false, error: `Connection closed during auth (${code})` });
      else finish({ ok: false, error: `Connection failed (${code})` });
    });
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw) as {
      Identifier?: number;
      Message?: string;
      Type?: string;
      Name?: string;
    };
    const { Identifier, Message, Type } = msg;

    if (Type === 'Auth') {
      const text = String(Message ?? '');
      const failed = /wrong|invalid|failed|denied|error/i.test(text);
      const resolver = this.authResolver;
      this.authResolver = null;
      if (resolver) resolver({ ok: !failed, error: failed ? text : undefined });
      return;
    }

    if (Identifier === -1) {
      this.log(Type === 'Chat' ? 'chat' : 'console', String(Message ?? ''));
      return;
    }

    if (Identifier === 0) {
      this.log(Type === 'Chat' ? 'chat' : 'console', String(Message ?? ''));
      return;
    }

    if (typeof Identifier === 'number' && Identifier > 1 && Identifier !== this.hbId) {
      const resolver = this.pending.get(Identifier);
      if (resolver) {
        this.pending.delete(Identifier);
        resolver(String(Message ?? ''));
        return;
      }
      const text = String(Message ?? '');
      if (text) this.log('response', text);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (!this.connected) return;
      this.hbId += 1;
      this.ws?.send(
        JSON.stringify({ Identifier: this.hbId, Message: '', Name: 'WebRcon' })
      );
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }

  send(command: string): boolean {
    if (!this.connected) return false;
    this.nextId += 1;
    this.ws?.send(
      JSON.stringify({ Identifier: this.nextId, Message: command, Name: 'WebRcon' })
    );
    this.log('system', `> ${command}`);
    return true;
  }

  request(command: string, timeoutMs = 5000): Promise<string | null> {
    if (!this.connected) return Promise.resolve(null);
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.ws?.send(JSON.stringify({ Identifier: id, Message: command, Name: 'WebRcon' }));
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.authResolver = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private log(kind: RconLineEvent['kind'], line: string): void {
    this.emit({
      serverId: this.serverId,
      kind,
      line,
      ts: new Date().toLocaleTimeString('en-GB'),
    });
  }
}

export class RconManager {
  private clients = new Map<string, RconClient>();

  private emit(event: RconLineEvent): void {
    for (const wc of webContents.getAllWebContents()) {
      wc.send('rcon:line', event);
    }
  }

  connect(payload: RconConnectPayload): Promise<{ ok: boolean; connected: boolean; error?: string }> {
    const existing = this.clients.get(payload.serverId);
    if (existing?.connected) return Promise.resolve({ ok: true, connected: true });
    existing?.disconnect();

    const client = new RconClient(payload.serverId, (e) => this.emit(e));
    this.clients.set(payload.serverId, client);
    return client.connect(payload.host, payload.port, payload.password).then((r) => ({
      ok: r.ok,
      connected: r.ok,
      error: r.error,
    }));
  }

  disconnect(serverId: string): { ok: boolean } {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
    }
    return { ok: true };
  }

  send(serverId: string, command: string): { ok: boolean; error?: string } {
    const client = this.clients.get(serverId);
    if (!client || !client.connected) return { ok: false, error: 'Not connected' };
    return client.send(command) ? { ok: true } : { ok: false, error: 'Not connected' };
  }

  isConnected(serverId: string): boolean {
    return this.clients.get(serverId)?.connected ?? false;
  }

  request(serverId: string, command: string, timeoutMs?: number): Promise<string | null> {
    const client = this.clients.get(serverId);
    if (!client?.connected) return Promise.resolve(null);
    return client.request(command, timeoutMs);
  }

  status(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [id, client] of this.clients) result[id] = client.connected;
    return result;
  }

  dispose(): void {
    for (const client of this.clients.values()) client.disconnect();
    this.clients.clear();
  }
}
