import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { httpGet } from './http';
import type { ServerPayload } from './types';

export interface ModStatus {
  installed: boolean;
  remoteVersion?: string;
  localVersion?: string;
  pluginCount?: number;
  branches?: Array<{ name: string; buildid: number; pwdrequired: number }>;
  error?: string;
}

export interface ModsStatusResult {
  oxide: ModStatus;
}

const OXIDE_ZIP_URL = 'https://umod.org/games/rust/download';
const OXIDE_META_URL = 'https://umod.org/games/rust.json';

function managedDir(server: ServerPayload): string {
  return server.installPath ? path.join(server.installPath, 'RustDedicated_Data', 'Managed') : '';
}

function oxideDir(server: ServerPayload): string {
  return server.installPath
    ? path.join(server.installPath, 'server', server.identity, 'oxide')
    : '';
}

function countPlugins(dir: string): number {
  if (!dir || !fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => /\.(cs|dll)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

const oxideInfoCache = new Map<string, { at: number; data: OxideRemoteInfo | null }>();
const OXIDE_INFO_TTL_MS = 30 * 60_000;

interface OxideRemoteInfo {
  version?: string;
  branches?: Array<{ name: string; buildid: number; pwdrequired: number }>;
}

async function remoteOxideInfo(): Promise<OxideRemoteInfo | null> {
  const cached = oxideInfoCache.get('rust');
  if (cached && Date.now() - cached.at < OXIDE_INFO_TTL_MS) return cached.data;

  try {
    const res = await httpGet(OXIDE_META_URL);
    if (res.status !== 200) return null;
    const j = JSON.parse(res.body.toString('utf8')) as {
      latest_release_version_formatted?: string;
      steam_branches?: Array<{ name: string; buildid: number; pwdrequired: number }>;
    };
    const data: OxideRemoteInfo = {
      version: j.latest_release_version_formatted || undefined,
      branches: Array.isArray(j.steam_branches) ? j.steam_branches : undefined,
    };
    oxideInfoCache.set('rust', { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

function localOxideVersion(server: ServerPayload): string | undefined {
  try {
    const p = path.join(oxideDir(server), 'version');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || undefined;
  } catch {
  }
  return undefined;
}

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

export async function removeMod(
  server: ServerPayload
): Promise<{ ok: boolean; error?: string }> {
  if (!server.installPath) return { ok: false, error: 'Server install path is not configured.' };
  try {
    fs.rmSync(oxideDir(server), { recursive: true, force: true });
    const legacyOxide = path.join(server.installPath, 'oxide');
    if (legacyOxide !== oxideDir(server)) {
      fs.rmSync(legacyOxide, { recursive: true, force: true });
    }
    const managed = managedDir(server);
    if (managed && fs.existsSync(managed)) {
      for (const f of fs.readdirSync(managed)) {
        if (/^Oxide/i.test(f)) {
          try {
            fs.unlinkSync(path.join(managed, f));
          } catch {
          }
        }
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getModsStatus(server: ServerPayload): Promise<ModsStatusResult> {
  const remote = await remoteOxideInfo();
  const oxideInstalled =
    !!server.installPath && fs.existsSync(path.join(managedDir(server), 'Oxide.Core.dll'));
  return {
    oxide: {
      installed: oxideInstalled,
      remoteVersion: remote?.version,
      localVersion: oxideInstalled ? localOxideVersion(server) : undefined,
      pluginCount: countPlugins(path.join(oxideDir(server), 'plugins')),
      branches: remote?.branches,
    },
  };
}
