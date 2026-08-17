import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type AppLocale = 'ru' | 'en';

let cachedLocale: AppLocale = 'ru';

function localePath(): string {
  return path.join(app.getPath('userData'), 'locale.json');
}

/** Текущий язык приложения (синхронизируется из рендерера). */
export function getLocale(): AppLocale {
  return cachedLocale;
}

export function setLocale(lng: string): AppLocale {
  cachedLocale = lng === 'en' ? 'en' : 'ru';
  try {
    fs.writeFileSync(localePath(), JSON.stringify({ locale: cachedLocale }), 'utf8');
  } catch {
    // запись не критична
  }
  return cachedLocale;
}

/** Загрузка сохранённого языка при старте main-процесса. */
export function initLocale(): void {
  try {
    const raw = fs.readFileSync(localePath(), 'utf8');
    const parsed = JSON.parse(raw) as { locale?: string };
    cachedLocale = parsed.locale === 'en' ? 'en' : 'ru';
  } catch {
    cachedLocale = 'ru';
  }
}

export type WebhookEventKey =
  | 'startTitle'
  | 'startDesc'
  | 'stopTitle'
  | 'stopDesc'
  | 'crashTitle'
  | 'crashDesc'
  | 'wipeTitle'
  | 'wipeDesc'
  | 'testTitle'
  | 'testDesc'
  | 'map'
  | 'worldSize'
  | 'seed'
  | 'players';

const DICT: Record<AppLocale, Record<WebhookEventKey, string>> = {
  ru: {
    startTitle: '🟢 Сервер запущен',
    startDesc: 'Сервер **«{{name}}»** успешно запущен и доступен для игроков!',
    stopTitle: '🔴 Сервер остановлен',
    stopDesc: 'Сервер **«{{name}}»** остановлен администратором.',
    crashTitle: '💥 Краш сервера',
    crashDesc:
      'Внимание! Зафиксировано аварийное завершение процесса сервера **«{{name}}»**. Запуск системы Crash Recovery...',
    wipeTitle: '🧹 Вайп завершен',
    wipeDesc: 'На сервере **«{{name}}»** успешно проведен вайп!',
    testTitle: '🧪 Тестовое уведомление',
    testDesc: 'Интеграция с Rust Server Manager успешно настроена!',
    map: 'Карта',
    worldSize: 'Размер',
    seed: 'Сид',
    players: 'Игроки',
  },
  en: {
    startTitle: '🟢 Server started',
    startDesc: 'Server **"{{name}}"** started successfully and is now available to players!',
    stopTitle: '🔴 Server stopped',
    stopDesc: 'Server **"{{name}}"** has been stopped by an administrator.',
    crashTitle: '💥 Server crashed',
    crashDesc:
      'Attention! The process of server **"{{name}}"** has crashed. Starting Crash Recovery...',
    wipeTitle: '🧹 Wipe completed',
    wipeDesc: 'The wipe on server **"{{name}}"** has been completed!',
    testTitle: '🧪 Test notification',
    testDesc: 'Rust Server Manager integration has been configured successfully!',
    map: 'Map',
    worldSize: 'World Size',
    seed: 'Seed',
    players: 'Players',
  },
};

/** Локализованная строка для вебхуков с подстановкой {{key}} из vars. */
export function trWebhook(
  key: WebhookEventKey,
  vars?: Record<string, string | number>
): string {
  let text = DICT[cachedLocale][key] ?? DICT.ru[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{{${k}}}`).join(String(v));
    }
  }
  return text;
}
