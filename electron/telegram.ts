import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { app } from 'electron';
import { trWebhook, type WebhookEventKey } from './locale';

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

const DEFAULTS: TelegramConfig = {
  token: '',
  chatId: '',
  notifyStart: true,
  notifyStop: true,
  notifyCrash: true,
  notifyWipe: true,
  notifyRestart: false,
  notifyBackup: false,
};

function configPath(serverId: string): string {
  return path.join(app.getPath('userData'), `telegram-${serverId}.json`);
}

export function loadTelegramConfig(serverId: string): TelegramConfig {
  try {
    const raw = fs.readFileSync(configPath(serverId), 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as TelegramConfig) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTelegramConfig(
  serverId: string,
  config: TelegramConfig
): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(path.dirname(configPath(serverId)), { recursive: true });
    fs.writeFileSync(configPath(serverId), JSON.stringify(config, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function postJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ ok: false, error: 'Invalid URL' });
      return;
    }
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const ok = res.statusCode === 200;
          resolve({ ok, status: res.statusCode, error: ok ? undefined : raw.slice(0, 300) });
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout' });
    });
    req.write(data);
    req.end();
  });
}

function sendText(config: TelegramConfig, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
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
  return sendText(config, `${trWebhook('testTitle')}\n${trWebhook('testDesc')}`);
}

const EVENT_TOGGLES: Record<TelegramEventPayload['event'], keyof TelegramConfig> = {
  'server-start': 'notifyStart',
  'server-stop': 'notifyStop',
  'server-crash': 'notifyCrash',
  'server-wipe': 'notifyWipe',
  'server-restart': 'notifyRestart',
  backup: 'notifyBackup',
};

const EVENT_TITLES: Partial<Record<TelegramEventPayload['event'], WebhookEventKey>> = {
  'server-start': 'startTitle',
  'server-stop': 'stopTitle',
  'server-crash': 'crashTitle',
  'server-wipe': 'wipeTitle',
};

const EVENT_DESCS: Partial<Record<TelegramEventPayload['event'], WebhookEventKey>> = {
  'server-start': 'startDesc',
  'server-stop': 'stopDesc',
  'server-crash': 'crashDesc',
  'server-wipe': 'wipeDesc',
};

/** Отправка события в Telegram с учётом сохранённого конфига сервера. */
export async function sendTelegramEvent(serverId: string, payload: TelegramEventPayload): Promise<void> {
  const config = loadTelegramConfig(serverId);
  const toggle = EVENT_TOGGLES[payload.event];
  if (!toggle || !config[toggle]) return;
  if (!config.token.trim() || !config.chatId.trim()) return;

  const vars: Record<string, string | number> = { name: payload.serverName };
  if (payload.map) vars.map = payload.map;
  if (payload.seed !== undefined) vars.seed = payload.seed;
  if (payload.worldSize) vars.worldSize = payload.worldSize;

  const titleKey = EVENT_TITLES[payload.event];
  const descKey = EVENT_DESCS[payload.event];
  let text = payload.message ?? '';
  if (titleKey && descKey) {
    text = `${trWebhook(titleKey, vars)}\n${trWebhook(descKey, vars)}`;
  }
  if (text) await sendText(config, text);
}
