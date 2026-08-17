import * as fs from 'fs';
import * as path from 'path';
import { app, Notification } from 'electron';

/**
 * Центр уведомлений приложения: события (краш, авторестарт, вайп, бэкап,
 * перезапуск, бан/разбан) сохраняются в userData/notifications.json и
 * дублируются системным уведомлением Windows (если поддерживается).
 */

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

const MAX_ITEMS = 100;

function storeFile(): string {
  return path.join(app.getPath('userData'), 'notifications.json');
}

let items: NotificationEntry[] = [];
let broadcaster: ((entry: NotificationEntry) => void) | null = null;

function save(): void {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(items, null, 2), 'utf8');
  } catch {
    // не критично
  }
}

/** Регистрация колбэка «новое уведомление» (main шлёт broadcast рендереру). */
export function setNotificationBroadcast(fn: (entry: NotificationEntry) => void): void {
  broadcaster = fn;
}

export function loadNotifications(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as NotificationEntry[];
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
}

export function listNotifications(): NotificationEntry[] {
  return [...items];
}

/** Добавление уведомления + системный тост Windows. */
export function pushNotification(entry: NotificationEntry): void {
  items = [entry, ...items].slice(0, MAX_ITEMS);
  save();
  broadcaster?.(entry);
  try {
    if (Notification.isSupported()) {
      new Notification({ title: entry.title, body: entry.body, silent: true }).show();
    }
  } catch {
    // уведомление может быть недоступно в некоторых окружениях
  }
}

export function markAllNotificationsRead(): void {
  items = items.map((i) => (i.read ? i : { ...i, read: true }));
  save();
}

export function clearNotifications(): void {
  items = [];
  save();
}
