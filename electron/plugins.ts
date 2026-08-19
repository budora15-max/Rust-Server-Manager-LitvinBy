import * as fs from 'fs';
import * as path from 'path';
import { httpGet } from './http';
import type { PluginInfo, PluginUpdateStatus, PluginsListResult, ServerPayload } from './types';

function identityDir(server: ServerPayload): string | null {
  if (!server.installPath) return null;
  return path.join(server.installPath, 'server', server.identity);
}

// хедер плагина в начале .cs — оттуда тянем имя/автора/версию/ResourceId
const INFO_RE =
  /\[Info\("(?<name>[^"]+)",\s*"(?<author>[^"]+)",\s*"(?<version>[^"]+)"(?<rest>[^\]]*)\]/;
const RESOURCE_ID_RE = /ResourceId\s*=\s*(\d+)/i;

interface PluginHeader {
  name: string;
  author: string;
  version: string;
  resourceId?: number;
}

function parseOxideHeader(filePath: string): PluginHeader | null {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 20_000);
    const m = INFO_RE.exec(head);
    if (m?.groups) {
      const rid = RESOURCE_ID_RE.exec(m.groups.rest ?? '');
      return {
        name: m.groups.name,
        author: m.groups.author,
        version: m.groups.version,
        resourceId: rid ? Number(rid[1]) : undefined,
      };
    }
  } catch {
  }
  return null;
}

export function listPlugins(server: ServerPayload): PluginsListResult {
  const idDir = identityDir(server);
  if (!idDir) {
    return {
      ok: false,
      mode: 'sim',
      plugins: [],
      error: 'no-path',
      message: 'Server install path is not configured. Set it in the General tab.',
    };
  }

  const dirs: Array<{ source: 'oxide'; dir: string }> = [
    { source: 'oxide', dir: path.join(idDir, 'oxide', 'plugins') },
  ];

  const plugins: PluginInfo[] = [];

  for (const { source, dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      const isDisabled = lower.endsWith('.cs.disabled') || lower.endsWith('.dll.disabled');
      const isCs = lower.endsWith('.cs') || lower.endsWith('.cs.disabled');
      const isDll = lower.endsWith('.dll') || lower.endsWith('.dll.disabled');
      if (!isCs && !isDll) continue;

      const filePath = path.join(dir, entry.name);
      const base = entry.name.replace(/\.(cs|dll)(\.disabled)?$/i, '');
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      const meta = isCs ? parseOxideHeader(filePath) : null;

      plugins.push({
        id: base,
        fileName: entry.name,
        name: meta?.name ?? base,
        version: meta?.version ?? (isDll ? 'dll' : '?'),
        author: meta?.author ?? 'Unknown',
        resourceId: meta?.resourceId,
        path: filePath,
        source,
        sizeBytes: stat.size,
        enabled: !isDisabled,
      });
    }
  }

  if (!fs.existsSync(idDir)) {
    return {
      ok: false,
      mode: 'real',
      plugins: [],
      error: 'no-dir',
      message: `Identity folder not found: ${idDir}`,
    };
  }

  return {
    ok: true,
    mode: 'real',
    source: plugins[0]?.source,
    dir: plugins[0]?.path ? path.dirname(plugins[0].path) : undefined,
    plugins,
  };
}

interface UmodMeta {
  latestVersion: string;
  downloadUrl: string;
  latestReleaseAt?: string;
}

const UMOD_CACHE_TTL_MS = 30 * 60_000;
const umodCache = new Map<string, { info: UmodMeta; at: number }>();

function slugCandidates(name: string): string[] {
  const base = name.trim().toLowerCase();
  const hyphenated = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slugs = [base, hyphenated].filter((s, i, arr) => s && arr.indexOf(s) === i);
  return slugs.length > 0 ? slugs : [name.trim().toLowerCase()];
}

export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export async function getLatestPluginInfo(name: string): Promise<UmodMeta | null> {
  const cached = umodCache.get(name);
  if (cached && Date.now() - cached.at < UMOD_CACHE_TTL_MS) return cached.info;

  for (const slug of slugCandidates(name)) {
    try {
      const res = await httpGet(`https://umod.org/plugins/${slug}.json`);
      if (res.status === 200) {
        const meta = JSON.parse(res.body.toString('utf8')) as {
          latest_release_version?: string;
          latest_release_at_atom?: string;
          download_url?: string;
          url?: string;
        };
        const latestVersion = meta.latest_release_version;
        const downloadUrl = meta.download_url ?? (meta.url ? `${meta.url}.cs` : null);
        if (latestVersion && downloadUrl) {
          const info: UmodMeta = {
            latestVersion,
            downloadUrl,
            latestReleaseAt: meta.latest_release_at_atom || undefined,
          };
          umodCache.set(name, { info, at: Date.now() });
          return info;
        }
      }
    } catch {
    }
  }
  return null;
}

export async function checkPluginUpdates(
  server: ServerPayload
): Promise<PluginUpdateStatus[]> {
  const scan = listPlugins(server);
  if (!scan.ok) return [];

  const candidates = scan.plugins.filter(
    (p) => p.source === 'oxide' && p.version && p.version !== '?' && p.version !== 'dll'
  );

  const settled = await Promise.allSettled(
    candidates.map(async (plugin): Promise<PluginUpdateStatus> => {
      try {
        const info = await getLatestPluginInfo(plugin.name);
        if (!info) {
          return { plugin, latestVersion: null, updateAvailable: false, error: 'Not found on uMod' };
        }
        return {
          plugin,
          latestVersion: info.latestVersion,
          updateAvailable: compareVersions(info.latestVersion, plugin.version) > 0,
          latestReleaseAt: info.latestReleaseAt,
        };
      } catch (err) {
        return {
          plugin,
          latestVersion: null,
          updateAvailable: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<PluginUpdateStatus> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export async function updatePlugin(
  plugin: PluginInfo
): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (plugin.fileName.toLowerCase().endsWith('.dll')) {
    return { ok: false, error: 'Compiled (.dll) plugins cannot be auto-updated from uMod.' };
  }

  const info = await getLatestPluginInfo(plugin.name);
  const downloadUrl =
    info?.downloadUrl ?? `https://umod.org/plugins/${slugCandidates(plugin.name)[0]}.cs`;

  try {
    const res = await httpGet(downloadUrl);
    if (res.status !== 200) {
      return { ok: false, error: `uMod responded with HTTP ${res.status}.` };
    }
    if (res.body.length < 100) {
      return { ok: false, error: 'Downloaded file looks invalid — update aborted.' };
    }

    const target = plugin.fileName.replace(/\.disabled$/i, '');
    const targetPath = path.join(path.dirname(plugin.path), target);
    fs.writeFileSync(targetPath, res.body);
    if (target !== plugin.fileName && fs.existsSync(plugin.path)) {
      fs.unlinkSync(plugin.path);
    }
    const version = info?.latestVersion ? ` to v${info.latestVersion}` : '';
    return { ok: true, message: `Updated "${plugin.name}"${version} from uMod.` };
  } catch (err) {
    return {
      ok: false,
      error: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function updateAllPlugins(
  server: ServerPayload
): Promise<Array<{ name: string; ok: boolean; message?: string; error?: string }>> {
  const statuses = await checkPluginUpdates(server);
  const results: Array<{ name: string; ok: boolean; message?: string; error?: string }> = [];
  for (const status of statuses) {
    if (!status.updateAvailable) continue;
    const r = await updatePlugin(status.plugin);
    results.push({ name: status.plugin.name, ok: r.ok, message: r.message, error: r.error });
  }
  return results;
}

export function deletePlugin(filePath: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
    fs.unlinkSync(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function setPluginEnabled(
  plugin: PluginInfo,
  enabled: boolean
): { ok: boolean; message?: string; error?: string } {
  try {
    const current = plugin.path;
    if (!current || !fs.existsSync(current)) return { ok: false, error: 'File not found.' };
    const isDisabled = /\.(cs|dll)\.disabled$/i.test(current);
    let target: string;
    if (enabled && isDisabled) {
      target = current.replace(/\.disabled$/i, '');
    } else if (!enabled && !isDisabled) {
      target = `${current}.disabled`;
    } else {
      return { ok: true, message: 'Already in that state.' };
    }
    fs.renameSync(current, target);
    return {
      ok: true,
      message: enabled
        ? 'Plugin enabled. Run oxide.reload on the server to activate.'
        : 'Plugin disabled. Run oxide.reload on the server to apply.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function readPluginConfig(
  server: ServerPayload,
  pluginName: string
): { ok: boolean; path?: string; config?: Record<string, unknown>; error?: string } {
  const idDir = identityDir(server);
  if (!idDir) return { ok: false, error: 'Install path not set.' };
  const candidates = [path.join(idDir, 'oxide', 'config', `${pluginName}.json`)];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return { ok: true, path: p, config: JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown> };
      } catch (err) {
        return { ok: false, path: p, error: `Cannot parse JSON: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }
  return { ok: true, path: path.join(idDir, 'oxide', 'config', `${pluginName}.json`), config: {} };
}

export function savePluginConfig(
  server: ServerPayload,
  pluginName: string,
  config: Record<string, unknown>
): { ok: boolean; path?: string; error?: string } {
  const res = readPluginConfig(server, pluginName);
  if (!res.ok) return { ok: false, error: res.error };
  try {
    const target = res.path!;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(config, null, 2), 'utf8');
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
