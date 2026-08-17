import * as fs from 'fs';
import * as path from 'path';
import type { ServerPayload, WipeOptions, WipeResult } from './types';

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

/**
 * Реальное выполнение вайпа: удаление .map/.db файлов из папки идентичности
 * и (опционально) генерация нового сида. Если папки нет — безопасная симуляция.
 */
export function executeWipe(server: ServerPayload, options: WipeOptions): WipeResult {
  const idDir = server.installPath
    ? path.join(server.installPath, 'server', server.identity)
    : '';

  if (!idDir || !fs.existsSync(idDir)) {
    return {
      ok: true,
      mode: 'sim',
      deletedFiles: [],
      newSeed: options.regenerateSeed ? randomSeed() : server.seed,
      message: 'Identity folder not found — wipe simulated.',
    };
  }

  let files: string[];
  try {
    files = fs.readdirSync(idDir);
  } catch {
    return {
      ok: true,
      mode: 'sim',
      deletedFiles: [],
      newSeed: options.regenerateSeed ? randomSeed() : server.seed,
      message: 'Cannot read identity folder — wipe simulated.',
    };
  }

  const deleted: string[] = [];
  const mapFiles = files.filter((f) => f.toLowerCase().endsWith('.map'));
  const dbFiles = files.filter((f) => /\.(db|db\.\d+)$/i.test(f));

  if (options.wipeMap) {
    for (const f of mapFiles) {
      try {
        fs.unlinkSync(path.join(idDir, f));
        deleted.push(f);
      } catch {
        // файл может быть занят запущенным сервером
      }
    }
  }

  if (options.wipeDb) {
    for (const f of dbFiles) {
      try {
        fs.unlinkSync(path.join(idDir, f));
        deleted.push(f);
      } catch {
        // файл может быть занят запущенным сервером
      }
    }
  }

  return {
    ok: true,
    mode: 'real',
    deletedFiles: deleted,
    newSeed: options.regenerateSeed ? randomSeed() : server.seed,
  };
}
