import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, ExternalLink, FolderOpen, Loader2, Package, Search } from 'lucide-react';
import type { MarketplacePlugin, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

interface Notice {
  type: 'ok' | 'err';
  text: string;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MarketplaceTab({ server }: { server: RustServer }) {
  const bridge = window.rustManager;
  const { t, i18n } = useTranslation();

  const [top, setTop] = useState<MarketplacePlugin[]>([]);
  const [results, setResults] = useState<MarketplacePlugin[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [disk, setDisk] = useState<{ dir: string; files: string[] } | null>(null);
  const [installingDisk, setInstallingDisk] = useState<string | null>(null);

  const searchTimer = useRef<number | undefined>(undefined);

  const pushNotice = (type: Notice['type'], text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 6000);
  };

  useEffect(() => {
    if (!bridge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([bridge.marketplaceGetList(i18n.language), bridge.pluginsList(server)])
      .then(([list, scan]) => {
        setTop(list);
        setInstalledIds(
          new Set(scan.ok ? scan.plugins.map((p) => p.id.toLowerCase()) : [])
        );
      })
      .catch(() => setTop([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, server.id]);

  const doSearch = useCallback(
    async (value: string) => {
      const q = value.trim();
      if (!q) {
        setResults(null);
        setSearching(false);
        return;
      }
      if (!bridge) return;
      setSearching(true);
      try {
        const found = await bridge.marketplaceSearch(q);
        setResults(found);
        if (found.length === 0) pushNotice('err', t('marketplace.noResults'));
      } catch {
        setResults([]);
        pushNotice('err', t('marketplace.networkError'));
      } finally {
        setSearching(false);
      }
    },
    [bridge, t]
  );

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      doSearch(query);
    }, 450);
    return () => window.clearTimeout(searchTimer.current);
  }, [query, doSearch]);

  const handleInstall = async (plugin: MarketplacePlugin) => {
    if (!bridge) return;
    setInstallingSlug(plugin.slug);
    try {
      const res = await bridge.marketplaceInstall(server, plugin.slug);
      if (res.ok) {
        setInstalledIds((prev) => new Set(prev).add(plugin.slug.toLowerCase()));
        pushNotice('ok', t('marketplace.installSuccess'));
      } else {
        pushNotice('err', `${t('marketplace.installError')}: ${res.error}`);
      }
    } catch (e) {
      pushNotice('err', `${t('marketplace.installError')}: ${String(e)}`);
    } finally {
      setInstallingSlug(null);
    }
  };

  const handlePickDir = async () => {
    if (!bridge) return;
    try {
      const res = await bridge.pluginsPickDir();
      if (!res.ok) return;
      setDisk({ dir: res.dir ?? '', files: res.files ?? [] });
    } catch {
      pushNotice('err', t('marketplace.installError'));
    }
  };

  const handleInstallFile = async (fileName: string) => {
    if (!bridge || !disk) return;
    setInstallingDisk(fileName);
    try {
      const res = await bridge.pluginsInstallFromDisk(server, disk.dir, fileName);
      if (res.ok) {
        pushNotice('ok', t('marketplace.installedFromDisk', { name: res.fileName ?? fileName }));
      } else {
        pushNotice('err', `${t('marketplace.installError')}: ${res.error}`);
      }
    } catch (e) {
      pushNotice('err', `${t('marketplace.installError')}: ${String(e)}`);
    } finally {
      setInstallingDisk(null);
    }
  };

  const displayed = results ?? top;
  const title = results !== null ? t('marketplace.results') : t('marketplace.popular');
  const noPath = !server.installPath;

  return (
    <div>
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

      {!bridge && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          {t('marketplace.networkError')}
        </p>
      )}

      {/* Установка плагина с диска */}
      <div className="mb-4 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-textMain">
              <FolderOpen className="h-4 w-4 text-accent" />
              {t('marketplace.installFromDisk')}
            </h3>
            <p className="mt-0.5 text-xs text-textMuted">{t('marketplace.pickFolderHint')}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!bridge || !server.installPath}
            onClick={() => void handlePickDir()}
          >
            <FolderOpen className="h-3.5 w-3.5" /> {t('marketplace.pickFolder')}
          </Button>
        </div>
        {!server.installPath && (
          <p className="mt-3 text-xs text-amber-400">{t('marketplace.installPathNeeded')}</p>
        )}
        {disk && (
          <div className="mt-3 border-t border-[#232833] pt-3">
            {disk.files.length === 0 ? (
              <p className="text-xs text-textMuted">{t('marketplace.noCsFiles')}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {disk.files.map((f) => (
                  <li key={f}>
                    <button
                      type="button"
                      disabled={installingDisk !== null}
                      onClick={() => void handleInstallFile(f)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 py-2 text-left text-xs text-textMain transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">{f}</span>
                      {installingDisk === f ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                      ) : (
                        <Download className="h-3.5 w-3.5 shrink-0 text-textMuted" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 truncate text-[10px] text-textMuted/70">{disk.dir}</p>
          </div>
        )}
      </div>

      {/* Поиск */}
      <div className="mb-4 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('marketplace.search')}
            className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] pl-10 pr-10 text-sm text-textMain placeholder:text-textMuted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-accent" />
          )}
        </div>
        {noPath && (
          <p className="mt-3 text-xs text-textMuted">{t('marketplace.installPathNeeded')}</p>
        )}
      </div>

      {/* Заголовок */}
      <div className="mb-4 flex items-center gap-2">
        <Package className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold text-textMain">{title}</h2>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
          uMod
        </span>
        <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
          {displayed.length}
        </span>
      </div>

      {/* Сетка карточек */}
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#232833] bg-surface py-16 text-sm text-textMuted">
          {t('marketplace.loading')}
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2a2f3a] bg-surface/50 p-10 text-center text-sm text-textMuted">
          {t('marketplace.noResults')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displayed.map((plugin) => {
            const installed = installedIds.has(plugin.slug.toLowerCase());
            const installing = installingSlug === plugin.slug;
            return (
              <div
                key={plugin.slug}
                className="flex flex-col rounded-xl border border-[#232833] bg-surface p-5 transition-colors hover:border-[#2e3442]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-textMain">{plugin.name}</h3>
                      {plugin.version && (
                        <span className="shrink-0 rounded-full border border-[#2a2f3a] bg-[#1a1e26] px-2 py-0.5 text-[10px] font-semibold text-textMuted">
                          {plugin.version}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-textMuted">
                      {t('marketplace.author')}: {plugin.author}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                    {plugin.category}
                  </span>
                </div>

                <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-textMuted">
                  {plugin.description}
                </p>

                <div className="mt-3 flex items-center gap-1.5 text-xs text-textMuted">
                  <Download className="h-3.5 w-3.5" />
                  {t('marketplace.downloads')}: {formatDownloads(plugin.downloads)}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {plugin.url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => void bridge?.openExternal(plugin.url!)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {t('marketplace.openOnUmod')}
                    </Button>
                  )}
                  <Button
                    className="flex-1"
                    variant={installed ? 'success' : 'primary'}
                    disabled={installed || installing || !bridge}
                    loading={installing}
                    onClick={() => handleInstall(plugin)}
                  >
                    {installed ? (
                      <>
                        <Check className="h-4 w-4" /> {t('marketplace.installed')}
                      </>
                    ) : installing ? (
                      <>{t('marketplace.loading')}</>
                    ) : (
                      <>
                        <Download className="h-4 w-4" /> {t('marketplace.install')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
