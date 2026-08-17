import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileCode2, FileJson, Plug, Power, RefreshCw, ScanLine, Trash2, Upload } from 'lucide-react';
import type { PluginInfo, PluginUpdateStatus, PluginsListResult, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { cn } from '@/lib/utils';

const DEMO_PLUGINS: PluginInfo[] = [
  { id: 'Clans', fileName: 'Clans.cs', name: 'Clans', version: '1.4.2', author: 'MisterPikachu', path: '', source: 'oxide', sizeBytes: 45210, enabled: true },
  { id: 'ZLevelsRemastered', fileName: 'ZLevelsRemastered.cs', name: 'ZLevelsRemastered', version: '3.0.0', author: 'ignignokt84', path: '', source: 'oxide', sizeBytes: 128900, enabled: true },
  { id: 'Skins', fileName: 'Skins.cs', name: 'Skins', version: '2.0.0', author: 'MJSU', path: '', source: 'oxide', sizeBytes: 67123, enabled: false },
  { id: 'AntiCheat', fileName: 'AntiCheat.cs', name: 'AntiCheat', version: '1.9.1', author: 'Collector', path: '', source: 'oxide', sizeBytes: 33210, enabled: true },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface Notice {
  type: 'ok' | 'err';
  text: string;
}

interface CachedScan {
  at: number;
  plugins: PluginInfo[];
}

const CACHE_TTL_MS = 60 * 60_000;

/** Загрузка кэша сканирования (со статусами обновлений) из sessionStorage. */
function loadCachedPlugins(cacheKey: string): PluginInfo[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedScan;
    if (Date.now() - cached.at > CACHE_TTL_MS) return null;
    return cached.plugins;
  } catch {
    return null;
  }
}

export function PluginsTab({ server }: { server: RustServer }) {
  const bridge = window.rustManager;
  const demoMode = !bridge;
  const { t } = useTranslation();
  const cacheKey = `rsm.pluginUpdates.${server.id}`;

  const [plugins, setPlugins] = useState<PluginInfo[]>(() => loadCachedPlugins(cacheKey) ?? []);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PluginsListResult | null>(null);
  const [toDelete, setToDelete] = useState<PluginInfo | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [confirmUpdateAll, setConfirmUpdateAll] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [configPlugin, setConfigPlugin] = useState<PluginInfo | null>(null);
  const [configText, setConfigText] = useState('');
  const [configPath, setConfigPath] = useState('');
  const [configError, setConfigError] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pushNotice = (type: Notice['type'], text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 6000);
  };

  const scan = useCallback(async () => {
    if (!bridge) {
      setPlugins(DEMO_PLUGINS);
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const listRes = await bridge.pluginsList(server);
      setResult(listRes);

      // Проверка версий может временно падать (сеть/rate-limit) —
      // в этом случае сохраняем прежние бейджи обновлений.
      let updates: PluginUpdateStatus[] = [];
      let updatesOk = true;
      try {
        updates = await bridge.pluginsCheckUpdates(server);
      } catch {
        updatesOk = false;
      }

      if (listRes.ok) {
        const byName = new Map(updates.map((u) => [u.plugin.name, u]));
        setPlugins((prev) => {
          const merged = listRes.plugins.map((p) => {
            const u = byName.get(p.name);
            if (u) {
              return {
                ...p,
                latestVersion: u.latestVersion ?? undefined,
                updateAvailable: u.updateAvailable,
              };
            }
            // uMod недоступен сейчас — оставляем последний известный статус
            const prevPlugin = prev.find((pp) => pp.id === p.id);
            if (prevPlugin?.updateAvailable && prevPlugin.latestVersion) {
              return { ...p, latestVersion: prevPlugin.latestVersion, updateAvailable: true };
            }
            return p;
          });
          if (updatesOk) {
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), plugins: merged }));
            } catch {
              // кэш не критичен
            }
          }
          return merged;
        });
      } else {
        setPlugins([]);
      }
    } catch (e) {
      setResult({ ok: false, mode: 'real', plugins: [], message: String(e) });
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, [bridge, server, cacheKey]);

  useEffect(() => {
    scan();
  }, [scan]);

  const handleDelete = async () => {
    if (!toDelete) return;
    if (bridge) {
      const res = await bridge.pluginsDelete(toDelete.path);
      if (res.ok) pushNotice('ok', t('plugins.deleted', { name: toDelete.name }));
      else pushNotice('err', t('plugins.deleteFailed', { error: res.error }));
    } else {
      pushNotice('ok', t('plugins.deletedDemo', { name: toDelete.name }));
    }
    setToDelete(null);
    scan();
  };

  /** Включение/выключение плагина (переименование .disabled). */
  const handleToggle = async (plugin: PluginInfo) => {
    if (!bridge) {
      pushNotice('ok', 'Demo: toggle simulated.');
      return;
    }
    setTogglingId(plugin.id);
    try {
      const res = await bridge.pluginsSetEnabled(plugin, !plugin.enabled);
      if (res.ok) pushNotice('ok', res.message ?? (plugin.enabled ? 'Disabled' : 'Enabled'));
      else pushNotice('err', res.error ?? 'Failed');
      scan();
    } finally {
      setTogglingId(null);
    }
  };

  /** Открытие редактора JSON-конфига плагина. */
  const openConfig = async (plugin: PluginInfo) => {
    if (!bridge) return;
    setConfigError('');
    setConfigPath('');
    setConfigPlugin(plugin);
    try {
      const res = await bridge.pluginsReadConfig(server, plugin.name);
      if (res.ok) {
        setConfigPath(res.path ?? '');
        setConfigText(JSON.stringify(res.config ?? {}, null, 2));
      } else {
        setConfigError(res.error ?? 'Failed to read config');
        setConfigText('{}');
      }
    } catch (e) {
      setConfigError(String(e));
      setConfigText('{}');
    }
  };

  const saveConfig = async () => {
    if (!configPlugin || !bridge) return;
    setConfigSaving(true);
    setConfigError('');
    try {
      const parsed = JSON.parse(configText);
      const res = await bridge.pluginsSaveConfig(server, configPlugin.name, parsed);
      if (res.ok) {
        pushNotice('ok', t('plugins.configSaved', { path: res.path ?? '' }));
        setConfigPlugin(null);
      } else {
        setConfigError(res.error ?? 'Failed to save');
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigSaving(false);
    }
  };

  const handleUpdate = async (plugin: PluginInfo) => {
    if (!bridge) {
      pushNotice('ok', t('plugins.updateDemo', { name: plugin.name }));
      return;
    }
    setUpdatingId(plugin.id);
    try {
      const res = await bridge.pluginsUpdate(plugin);
      if (res.ok) pushNotice('ok', res.message ?? t('plugins.update', { name: plugin.name }));
      else pushNotice('err', t('plugins.updateFailed', { error: res.error }));
      scan();
    } finally {
      setUpdatingId(null);
    }
  };

  const updatableCount = plugins.filter((p) => p.updateAvailable).length;

  const handleUpdateAll = async () => {
    setConfirmUpdateAll(false);
    if (!bridge) {
      pushNotice('ok', 'Demo: update all simulated.');
      return;
    }
    setUpdatingAll(true);
    try {
      const results = await bridge.pluginsUpdateAll(server);
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (results.length === 0) {
        pushNotice('ok', t('plugins.noUpdates'));
      } else if (failed.length > 0) {
        pushNotice(
          'err',
          t('plugins.updateAllFailed', {
            error: failed.map((r) => r.name).join(', '),
          })
        );
      } else {
        pushNotice('ok', t('plugins.updatedCount', { ok: okCount, total: results.length }));
      }
      scan();
    } catch (e) {
      pushNotice('err', t('plugins.updateAllFailed', { error: String(e) }));
    } finally {
      setUpdatingAll(false);
    }
  };

  return (
    <div>
      {/* Заголовок и сканирование */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-textMain">{t('plugins.directory')}</p>
          <p className="mt-0.5 font-mono text-xs text-textMuted">
            {result?.dir ??
              (server.installPath
                ? `${server.installPath}\\server\\${server.identity}\\oxide\\plugins`
                : t('plugins.notConfigured'))}{' '}
            · {t('plugins.filesCount', { count: plugins.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
              result?.source === 'carbon'
                ? 'border-purple-500/30 bg-purple-500/10 text-purple-400'
                : 'border-[#2a2f3a] bg-[#1a1e26] text-textMuted'
            )}
          >
            <Plug className="h-3.5 w-3.5" />
            {result?.source === 'carbon' ? t('plugins.carbon') : t('plugins.oxide')}
          </span>
          <Button
            size="sm"
            variant="primary"
            loading={updatingAll}
            disabled={updatingAll || updatableCount === 0}
            onClick={() => setConfirmUpdateAll(true)}
            title={updatableCount > 0 ? `${updatableCount}` : t('plugins.noUpdates')}
          >
            <Upload className="h-3.5 w-3.5" /> {t('plugins.updateAll')}
            {updatableCount > 0 ? ` (${updatableCount})` : ''}
          </Button>
          <Button size="sm" variant="secondary" loading={loading} onClick={scan}>
            <ScanLine className="h-3.5 w-3.5" /> {t('plugins.rescan')}
          </Button>
        </div>
      </div>

      {notice && (
        <p
          className={cn(
            'mb-4 rounded-lg border px-3 py-2 text-sm',
            notice.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          )}
        >
          {notice.text}
        </p>
      )}

      {demoMode && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          {t('plugins.browserDemo')}
        </p>
      )}

      {result && !result.ok && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#232833] bg-surface/50 p-5 text-sm text-textMuted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-textMain">{t('plugins.notFound')}</p>
            <p className="mt-1">{result.message}</p>
            {result.error === 'no-path' && (
              <p className="mt-1">{t('plugins.notFoundHint')}</p>
            )}
          </div>
        </div>
      )}

      {/* Список плагинов */}
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#232833] bg-surface py-16 text-sm text-textMuted">
          {t('plugins.scanning')}
        </div>
      ) : plugins.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[#232833] bg-surface">
          {plugins.map((plugin, idx) => (
            <div
              key={plugin.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-[#1a1e26]',
                idx !== plugins.length - 1 && 'border-b border-[#232833]'
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1a1e26] text-textMuted">
                  <FileCode2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-textMain">{plugin.name}</p>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs font-semibold',
                        plugin.enabled
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                      )}
                    >
                      {plugin.enabled ? t('plugins.enabled') : t('plugins.disabled')}
                    </span>
                    <span className="rounded-full border border-[#2a2f3a] bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
                      {plugin.source === 'carbon' ? t('plugins.carbon') : t('plugins.oxide')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-textMuted">
                    {t('plugins.versionBy', { version: plugin.version, author: plugin.author })} ·{' '}
                    {formatBytes(plugin.sizeBytes)} · {plugin.fileName}
                  </p>
                  {plugin.updateAvailable && plugin.latestVersion && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                      {t('plugins.updateAvailable', {
                        current: plugin.version,
                        latest: plugin.latestVersion,
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={togglingId === plugin.id}
                  onClick={() => void handleToggle(plugin)}
                >
                  <Power className="h-3.5 w-3.5" />
                  {plugin.enabled ? t('plugins.disable') : t('plugins.enable')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void openConfig(plugin)}>
                  <FileJson className="h-3.5 w-3.5" /> {t('plugins.config')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updatingId === plugin.id}
                  onClick={() => handleUpdate(plugin)}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t('plugins.update')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setToDelete(plugin)}>
                  <Trash2 className="h-3.5 w-3.5" /> {t('plugins.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#2a2f3a] bg-surface/50 p-8 text-center text-sm text-textMuted">
          {t('plugins.noPlugins')}
        </div>
      )}

      <ConfirmModal
        open={toDelete !== null}
        title={t('plugins.deleteTitle')}
        message={t('plugins.deleteMessage', {
          name: toDelete?.name,
          file: toDelete?.fileName,
        })}
        confirmLabel={t('plugins.deleteConfirm')}
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />

      <ConfirmModal
        open={confirmUpdateAll}
        title={t('plugins.updateAllTitle')}
        message={t('plugins.updateAllMessage', { count: updatableCount })}
        confirmLabel={t('plugins.updateAllConfirm')}
        onCancel={() => setConfirmUpdateAll(false)}
        onConfirm={handleUpdateAll}
      />

      {/* Редактор JSON-конфига плагина */}
      {configPlugin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[#232833] bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
              <FileJson className="h-4 w-4 text-accent" />
              {t('plugins.configTitle', { name: configPlugin.name })}
            </div>
            {configPath && (
              <p className="mt-1 truncate font-mono text-xs text-textMuted/60">{configPath}</p>
            )}
            {configError && (
              <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {configError}
              </p>
            )}
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              spellCheck={false}
              className="mt-3 h-80 w-full resize-none rounded-lg border border-[#2a2f3a] bg-[#0b0d11] p-3 font-mono text-xs text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfigPlugin(null)} disabled={configSaving}>
                {t('plugins.cancel')}
              </Button>
              <Button onClick={() => void saveConfig()} loading={configSaving}>
                {t('plugins.saveConfig')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

