import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { httpGet } from './http';
import type { ServerPayload } from './types';

/**
 * Менеджер модов: установка/обновление/удаление фреймворков Oxide (uMod)
 * и Carbon прямо в папку установки Rust-сервера. Архивы скачиваются
 * с официальных источников (umod.org, github.com/CarbonCommunity) и
 * распаковываются в installPath (overwrite Managed + создание oxide//carbon/).
 */

export type ModKind = 'oxide' | 'carbon';

export interface ModStatus {
  installed: boolean;
  remoteVersion?: string;
  localVersion?: string;
  pluginCount?: number;
  error?: string;
}

export interface ModsStatusResult {
  oxide: ModStatus;
  carbon: ModStatus;
}

const OXIDE_ZIP_URL = 'https://umod.org/games/rust/download';
const OXIDE_META_URL = 'https://umod.org/games/rust.json';
const CARBON_INFO_URL =
  'https://github.com/CarbonCommunity/Carbon/releases/download/production_build/Carbon.Windows.Release.info';
const CARBON_ZIP_URL =
  'https://github.com/CarbonCommunity/Carbon/releases/download/production_build/Carbon.Windows.Release.zip';

function managedDir(server: ServerPayload): string {
  return server.installPath ? path.join(server.installPath, 'RustDedicated_Data', 'Managed') : '';
}

/**
 * Папка Oxide находится в identity-папке сервера: <installPath>/server/<identity>/oxide/
 * (именно оттуда вкладка «Плагины» читает oxide/plugins и oxide/config).
 */
function oxideDir(server: ServerPayload): string {
  return server.installPath
    ? path.join(server.installPath, 'server', server.identity, 'oxide')
    : '';
}

/** Carbon живёт в корне установки: <installPath>/carbon/. */
function carbonDir(server: ServerPayload): string {
  return server.installPath ? path.join(server.installPath, 'carbon') : '';
}

function countPlugins(dir: string): number {
  if (!dir || !fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => /\.(cs|dll)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

async function remoteOxideVersion(): Promise<string | undefined> {
  try {
    const res = await httpGet(OXIDE_META_URL);
    if (res.status !== 200) return undefined;
    const j = JSON.parse(res.body.toString('utf8')) as { latest_release_version_formatted?: string };
    return j.latest_release_version_formatted || undefined;
  } catch {
    return undefined;
  }
}

async function remoteCarbonVersion(): Promise<string | undefined> {
  try {
    const res = await httpGet(CARBON_INFO_URL);
    if (res.status !== 200) return undefined;
    const j = JSON.parse(res.body.toString('utf8')) as { Version?: string };
    return j.Version ? `v${j.Version}` : undefined;
  } catch {
    return undefined;
  }
}

function localOxideVersion(server: ServerPayload): string | undefined {
  try {
    const p = path.join(oxideDir(server), 'version');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || undefined;
  } catch {
    // нет файла версии — не критично
  }
  return undefined;
}

/** Распаковка архива с защитой от zip-slip (выхода за пределы installPath). */
function safeExtract(zip: AdmZip, target: string): void {
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (!name) continue;
    const resolved = path.resolve(target, name);
    if (resolved !== target && !resolved.startsWith(target + path.sep)) {
      throw new Error(`Unsafe archive entry: ${name}`);
    }
  }
  zip.extractAllTo(target, true);
}

export async function installOxide(server: ServerPayload): Promise<ModStatus> {
  if (!server.installPath) {
    return { installed: false, error: 'Server install path is not configured.' };
  }
  try {
    const res = await httpGet(OXIDE_ZIP_URL);
    if (res.status !== 200) {
      return { installed: false, error: `uMod responded with HTTP ${res.status}.` };
    }
    const zip = new AdmZip(res.body);
    safeExtract(zip, server.installPath);
    return (await getModsStatus(server)).oxide;
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function installCarbon(server: ServerPayload): Promise<ModStatus> {
  if (!server.installPath) {
    return { installed: false, error: 'Server install path is not configured.' };
  }
  try {
    const res = await httpGet(CARBON_ZIP_URL);
    if (res.status !== 200) {
      return { installed: false, error: `Carbon responded with HTTP ${res.status}.` };
    }
    const zip = new AdmZip(res.body);
    safeExtract(zip, server.installPath);
    return (await getModsStatus(server)).carbon;
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Удаление фреймворка: папка oxide//carbon/ + соответствующие файлы в Managed. */
export async function removeMod(
  server: ServerPayload,
  kind: ModKind
): Promise<{ ok: boolean; error?: string }> {
  if (!server.installPath) return { ok: false, error: 'Server install path is not configured.' };
  try {
    const managed = managedDir(server);
    if (kind === 'oxide') {
      fs.rmSync(oxideDir(server), { recursive: true, force: true });
      // legacy: старые сборки Oxide могли класть папку в корень установки
      const legacyOxide = server.installPath ? path.join(server.installPath, 'oxide') : '';
      if (legacyOxide && legacyOxide !== oxideDir(server)) {
        fs.rmSync(legacyOxide, { recursive: true, force: true });
      }
      if (managed && fs.existsSync(managed)) {
        for (const f of fs.readdirSync(managed)) {
          if (/^Oxide/i.test(f)) {
            try {
              fs.unlinkSync(path.join(managed, f));
            } catch {
              // файл занят запущенным сервером
            }
          }
        }
      }
    } else {
      fs.rmSync(carbonDir(server), { recursive: true, force: true });
      if (managed && fs.existsSync(managed)) {
        for (const f of fs.readdirSync(managed)) {
          if (/^(Carbon|carbon)/i.test(f)) {
            try {
              fs.unlinkSync(path.join(managed, f));
            } catch {
              // файл занят запущенным сервером
            }
          }
        }
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Статус модов: установлен ли фреймворк, актуальная версия, число плагинов. */
export async function getModsStatus(server: ServerPayload): Promise<ModsStatusResult> {
  const [oxideRemote, carbonRemote] = await Promise.all([remoteOxideVersion(), remoteCarbonVersion()]);
  const oxideInstalled =
    !!server.installPath && fs.existsSync(path.join(managedDir(server), 'Oxide.Core.dll'));
  const carbonInstalled = !!server.installPath && fs.existsSync(carbonDir(server));
  return {
    oxide: {
      installed: oxideInstalled,
      remoteVersion: oxideRemote,
      localVersion: oxideInstalled ? localOxideVersion(server) : undefined,
      pluginCount: countPlugins(path.join(oxideDir(server), 'plugins')),
    },
    carbon: {
      installed: carbonInstalled,
      remoteVersion: carbonRemote,
      pluginCount: countPlugins(path.join(carbonDir(server), 'plugins')),
    },
  };
}
