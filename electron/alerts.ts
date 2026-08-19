import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { app } from 'electron';
import { trWebhook, type WebhookEventKey } from './locale';

// Алерты в Telegram и Discord. Конфиги лежат в userData, текст событий тянем из locale (trWebhook).

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

export interface TelegramEventPayload {
  serverId: string;
  event: 'server-start' | 'server-stop' | 'server-crash' | 'server-wipe' | 'server-restart' | 'backup';
  serverName: string;
  map?: string;
  seed?: number;
  worldSize?: number;
  maxPlayers?: number;
  message?: string;
}

const DEFAULT_TG: TelegramConfig = {
  token: '',
  chatId: '',
  notifyStart: true,
  notifyStop: true,
  notifyCrash: true,
  notifyWipe: true,
  notifyRestart: false,
  notifyBackup: false,
};

function tgPath(serverId: string): string {
  return path.join(app.getPath('userData'), `telegram-${serverId}.json`);
}

export function loadTelegramConfig(serverId: string): TelegramConfig {
  try {
    const raw = fs.readFileSync(tgPath(serverId), 'utf8');
    return { ...DEFAULT_TG, ...(JSON.parse(raw) as Partial<TelegramConfig>) };
  } catch {
    return { ...DEFAULT_TG };
  }
}

export function saveTelegramConfig(
  serverId: string,
  config: TelegramConfig
): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(path.dirname(tgPath(serverId)), { recursive: true });
    fs.writeFileSync(tgPath(serverId), JSON.stringify(config, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type WebhookEventType = 'server-start' | 'server-stop' | 'server-crash' | 'server-wipe';

export interface WebhookConfig {
  url: string;
  notifyStart: boolean;
  notifyStop: boolean;
  notifyCrash: boolean;
  notifyWipe: boolean;
}

export interface WebhookPayload {
  serverId: string;
  event: WebhookEventType;
  serverName: string;
  map?: string;
  seed?: number;
  worldSize?: number;
  onlinePlayers?: number;
  maxPlayers?: number;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  url: '',
  notifyStart: true,
  notifyStop: true,
  notifyCrash: true,
  notifyWipe: true,
};

// Один POST на оба сервиса: и https (telegram), и http/https (вебхуки дискорда).
function postJson(
  url: string,
  payload: unknown,
  timeoutMs = 10_000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, error: 'Invalid URL' });
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);

    const req = lib.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'RustServerManager/1.0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const ok = res.statusCode === 200 || res.statusCode === 204;
          resolve({ ok, status: res.statusCode, error: ok ? undefined : raw.slice(0, 300) });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end(body);
  });
}

function tgSend(config: TelegramConfig, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  return postJson(`https://api.telegram.org/bot${config.token.trim()}/sendMessage`, {
    chat_id: config.chatId.trim(),
    text,
    disable_web_page_preview: true,
  });
}

export async function sendTelegramTest(
  config: TelegramConfig
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!config.token.trim() || !config.chatId.trim()) {
    return { ok: false, error: 'Bot token and chat id are required.' };
  }
  return tgSend(config, `${trWebhook('testTitle')}\n${trWebhook('testDesc')}`);
}

const TG_TOGGLES: Record<TelegramEventPayload['event'], keyof TelegramConfig> = {
  'server-start': 'notifyStart',
  'server-stop': 'notifyStop',
  'server-crash': 'notifyCrash',
  'server-wipe': 'notifyWipe',
  'server-restart': 'notifyRestart',
  backup: 'notifyBackup',
};

const TG_TITLES: Partial<Record<TelegramEventPayload['event'], WebhookEventKey>> = {
  'server-start': 'startTitle',
  'server-stop': 'stopTitle',
  'server-crash': 'crashTitle',
  'server-wipe': 'wipeTitle',
};

const TG_DESCS: Partial<Record<TelegramEventPayload['event'], WebhookEventKey>> = {
  'server-start': 'startDesc',
  'server-stop': 'stopDesc',
  'server-crash': 'crashDesc',
  'server-wipe': 'wipeDesc',
};

export async function sendTelegramEvent(serverId: string, payload: TelegramEventPayload): Promise<void> {
  const cfg = loadTelegramConfig(serverId);
  const toggle = TG_TOGGLES[payload.event];
  if (!toggle || !cfg[toggle]) return;
  if (!cfg.token.trim() || !cfg.chatId.trim()) return;

  const vars: Record<string, string | number> = { name: payload.serverName };
  if (payload.map) vars.map = payload.map;
  if (payload.seed !== undefined) vars.seed = payload.seed;
  if (payload.worldSize) vars.worldSize = payload.worldSize;

  const titleKey = TG_TITLES[payload.event];
  const descKey = TG_DESCS[payload.event];
  let text = payload.message ?? '';
  if (titleKey && descKey) {
    text = `${trWebhook(titleKey, vars)}\n${trWebhook(descKey, vars)}`;
  }
  if (text) await tgSend(cfg, text);
}


const RUST_COLOR = 0xe05638;

function whPath(serverId: string): string {
  return path.join(app.getPath('userData'), 'webhooks', `${serverId}.json`);
}

export function loadWebhookConfig(serverId: string): WebhookConfig {
  try {
    const raw = fs.readFileSync(whPath(serverId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    return { ...DEFAULT_WEBHOOK_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_WEBHOOK_CONFIG };
  }
}

export function saveWebhookConfig(
  serverId: string,
  config: WebhookConfig
): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(path.dirname(whPath(serverId)), { recursive: true });
    fs.writeFileSync(whPath(serverId), JSON.stringify(config, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildEmbed(payload: WebhookPayload): Record<string, unknown> {
  const { event, serverName, map, seed, worldSize, onlinePlayers, maxPlayers } = payload;
  const vars = { name: serverName };

  const titleKey: Record<WebhookEventType, 'startTitle' | 'stopTitle' | 'crashTitle' | 'wipeTitle'> = {
    'server-start': 'startTitle',
    'server-stop': 'stopTitle',
    'server-crash': 'crashTitle',
    'server-wipe': 'wipeTitle',
  };
  const descKey: Record<WebhookEventType, 'startDesc' | 'stopDesc' | 'crashDesc' | 'wipeDesc'> = {
    'server-start': 'startDesc',
    'server-stop': 'stopDesc',
    'server-crash': 'crashDesc',
    'server-wipe': 'wipeDesc',
  };

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (map) fields.push({ name: trWebhook('map'), value: map, inline: true });
  if (worldSize) fields.push({ name: trWebhook('worldSize'), value: String(worldSize), inline: true });
  if (seed !== undefined) fields.push({ name: trWebhook('seed'), value: String(seed), inline: true });
  if (onlinePlayers !== undefined && maxPlayers !== undefined) {
    fields.push({ name: trWebhook('players'), value: `${onlinePlayers}/${maxPlayers}`, inline: true });
  }

  return {
    title: trWebhook(titleKey[event], vars),
    description: trWebhook(descKey[event], vars),
    color: RUST_COLOR,
    timestamp: new Date().toISOString(),
    fields,
    footer: {
      text: 'Rust Server Manager',
      icon_url: 'https://rust.facepunch.com/assets/img/logo.png',
    },
  };
}

export async function sendWebhookEvent(
  serverId: string,
  payload: WebhookPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const cfg = loadWebhookConfig(serverId);
  const enabledByEvent: Record<WebhookEventType, boolean> = {
    'server-start': cfg.notifyStart,
    'server-stop': cfg.notifyStop,
    'server-crash': cfg.notifyCrash,
    'server-wipe': cfg.notifyWipe,
  };

  if (!cfg.url || !enabledByEvent[payload.event]) {
    return { ok: true }; // вебхук не настроен или отключён — молча пропускаем
  }

  return postJson(cfg.url, { embeds: [buildEmbed(payload)] });
}

export async function sendWebhookTest(
  config: WebhookConfig
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!config.url) return { ok: false, error: 'Webhook URL is empty.' };
  return postJson(config.url, {
    embeds: [
      {
        title: trWebhook('testTitle'),
        description: trWebhook('testDesc'),
        color: RUST_COLOR,
        timestamp: new Date().toISOString(),
        footer: { text: 'Rust Server Manager' },
      },
    ],
  });
}

