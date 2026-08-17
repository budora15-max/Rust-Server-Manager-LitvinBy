import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { app } from 'electron';
import { trWebhook } from './locale';

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

/** Цвет Rust-акцента для Embed-карточек: #e05638. */
const RUST_COLOR = 0xe05638;

function webhookConfigPath(serverId: string): string {
  return path.join(app.getPath('userData'), 'webhooks', `${serverId}.json`);
}

export function loadWebhookConfig(serverId: string): WebhookConfig {
  try {
    const raw = fs.readFileSync(webhookConfigPath(serverId), 'utf8');
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
    fs.mkdirSync(path.dirname(webhookConfigPath(serverId)), { recursive: true });
    fs.writeFileSync(webhookConfigPath(serverId), JSON.stringify(config, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function postJson(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, error: 'Invalid webhook URL' });
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
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            resolve({ ok: true, status: res.statusCode });
          } else {
            resolve({ ok: false, status: res.statusCode });
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end(body);
  });
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

/** Отправка уведомления с учётом сохранённого конфига сервера. */
export async function sendWebhookEvent(
  serverId: string,
  payload: WebhookPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const config = loadWebhookConfig(serverId);
  const enabledByEvent: Record<WebhookEventType, boolean> = {
    'server-start': config.notifyStart,
    'server-stop': config.notifyStop,
    'server-crash': config.notifyCrash,
    'server-wipe': config.notifyWipe,
  };

  if (!config.url || !enabledByEvent[payload.event]) {
    return { ok: true }; // вебхук не настроен или тип отключён — пропускаем
  }

  return postJson(config.url, { embeds: [buildEmbed(payload)] });
}

/** Тестовая карточка для проверки интеграции. */
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
