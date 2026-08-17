import * as fs from 'fs';
import * as path from 'path';
import type { ServerPayload } from './types';

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

const DEFAULT_CONFIG: Record<string, string> = {
  'server.name': 'Rust Server',
  'server.description': 'Powered by Rust Server Manager',
  'server.identity': 'main',
  'server.level': 'Procedural Map',
  'server.seed': '682198445',
  'server.worldsize': '4000',
  'server.maxplayers': '100',
  'server.port': '28015',
  'server.tickrate': '30',
  'rcon.port': '28017',
  'rcon.password': 'changeme',
  'rcon.web': '1',
};

/** <installPath>/server/<identity>/cfg/server.cfg */
function configPath(server: ServerPayload): string | null {
  if (!server.installPath) return null;
  return path.join(server.installPath, 'server', server.identity, 'cfg', 'server.cfg');
}

/** Значения Rust-конфига с пробелами должны быть в двойных кавычках. */
function formatCfgValue(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (v.startsWith('"') && v.endsWith('"')) return v;
  if (/\s/.test(v)) return `"${v.replace(/"/g, '')}"`;
  return v;
}

/** Строка конфига с корректным кавычками значения. */
function formatCfgLine(key: string, value: string): string {
  return `${key} ${formatCfgValue(value)}`;
}

/**
 * Чинит существующий server.cfg: значения с пробелами (server.level "Procedural Map",
 * server.name, server.description) без кавычек ломают загрузку сцены Procedural
 * на некоторых сборках Rust. Возвращает true, если файл был изменён.
 */
export function sanitizeServerConfig(server: ServerPayload): boolean {
  const cfgPath = configPath(server);
  if (!cfgPath || !fs.existsSync(cfgPath)) return false;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let changed = false;
    const out = lines.map((line) => {
      if (isComment(line)) return line;
      const parsed = parseLine(line);
      if (!parsed) return line;
      const [key, value] = parsed;
      const formatted = formatCfgValue(value);
      if (formatted !== value) {
        changed = true;
        return `${key} ${formatted}`;
      }
      return line;
    });
    if (changed) {
      const content = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
      fs.writeFileSync(cfgPath, content, 'utf8');
    }
    return changed;
  } catch {
    return false;
  }
}

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) return null;
  const idx = trimmed.search(/\s/);
  if (idx === -1) return [trimmed, ''];
  return [trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim()];
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith('#') || trimmed.startsWith('//');
}

export function readServerConfig(server: ServerPayload): ServerConfigResult {
  const cfgPath = configPath(server);
  if (!cfgPath) {
    return {
      ok: false,
      exists: false,
      path: '',
      config: {},
      rawLines: [],
      message: 'Server install path is not configured.',
    };
  }

  // Файла нет — создаём дефолтный
  if (!fs.existsSync(cfgPath)) {
    try {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      const lines = Object.entries(DEFAULT_CONFIG).map(([k, v]) => formatCfgLine(k, v));
      fs.writeFileSync(cfgPath, lines.join('\n') + '\n', 'utf8');
      return {
        ok: true,
        exists: false,
        path: cfgPath,
        config: { ...DEFAULT_CONFIG },
        rawLines: lines,
        message: 'server.cfg not found — default file created.',
      };
    } catch (err) {
      return {
        ok: false,
        exists: false,
        path: cfgPath,
        config: {},
        rawLines: [],
        message: `Failed to create server.cfg: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Парсим существующий файл
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const rawLines = raw.split(/\r?\n/);
    const config: Record<string, string> = {};
    for (const line of rawLines) {
      const parsed = parseLine(line);
      if (parsed) config[parsed[0]] = parsed[1];
    }
    return { ok: true, exists: true, path: cfgPath, config, rawLines };
  } catch (err) {
    return {
      ok: false,
      exists: true,
      path: cfgPath,
      config: {},
      rawLines: [],
      message: `Failed to read server.cfg: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Сохранение настроек: обновляет значения существующих ключей на месте
 * (сохраняя комментарии и структуру), новые ключи дописывает в конец.
 */
export function saveServerConfig(
  server: ServerPayload,
  config: Record<string, string>
): SaveConfigResult {
  const cfgPath = configPath(server);
  if (!cfgPath) {
    return { ok: false, path: '', error: 'Server install path is not configured.' };
  }

  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

    const existing: string[] = fs.existsSync(cfgPath)
      ? fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/)
      : [];

    const out: string[] = [];
    const seen = new Set<string>();

    for (const line of existing) {
      if (isComment(line)) {
        out.push(line);
        continue;
      }
      const parsed = parseLine(line);
      if (!parsed) {
        out.push(line);
        continue;
      }
      const [key] = parsed;
      if (config[key] !== undefined) {
        out.push(formatCfgLine(key, config[key]));
        seen.add(key);
      } else {
        out.push(line);
      }
    }

    for (const [key, value] of Object.entries(config)) {
      if (!seen.has(key)) out.push(formatCfgLine(key, value));
    }

    // Склеиваем без тройных переносов и гарантируем финальный перевод строки
    const content = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    fs.writeFileSync(cfgPath, content, 'utf8');
    return { ok: true, path: cfgPath };
  } catch (err) {
    return {
      ok: false,
      path: cfgPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
