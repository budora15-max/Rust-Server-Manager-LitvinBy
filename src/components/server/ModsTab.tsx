import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Download, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { ModKind, ModStatus, ModsStatusResult, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { cn } from '@/lib/utils';

interface ModsTabProps {
  server: RustServer;
}

const MOD_META: Record<ModKind, { name: string; color: string }> = {
  oxide: { name: 'Oxide (uMod)', color: 'text-accent' },
  carbon: { name: 'Carbon', color: 'text-sky-400' },
};

export function ModsTab({ server }: ModsTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [status, setStatus] = useState<ModsStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ModKind | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ModKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const flash = (text: string, isError = false) => {
    if (isError) setError(text);
    else setNotice(text);
    setTimeout(() => {
      setError('');
      setNotice('');
    }, 7000);
  };

  const load = useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    setError('');
    try {
      setStatus(await bridge.modsStatus(server));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge, server]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (kind: ModKind) => {
    if (!bridge) return;
    setBusy(kind);
    setError('');
    try {
      const res = await bridge.modsInstall(server, kind);
      if (res.installed) {
        flash(t('mods.installed', { mod: MOD_META[kind].name, version: res.remoteVersion ?? '' }));
      } else {
        flash(res.error ?? t('mods.installFailed'), true);
      }
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
    }
  };

  const doRemove = async () => {
    if (!confirmRemove || !bridge) return;
    const kind = confirmRemove;
    setBusy(kind);
    setError('');
    try {
      const res = await bridge.modsRemove(server, kind);
      if (res.ok) flash(t('mods.removed', { mod: MOD_META[kind].name }));
      else flash(res.error ?? t('mods.removeFailed'), true);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  };

  const renderCard = (kind: ModKind) => {
    const meta = MOD_META[kind];
    const st: ModStatus | undefined = status?.[kind];
    const installed = !!st?.installed;
    const isBusy = busy === kind;

    return (
      <div key={kind} className="rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a1e26]',
                meta.color
              )}
            >
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-textMain">{meta.name}</p>
              <p className="text-xs text-textMuted">
                {installed
                  ? st.localVersion
                    ? `${t('mods.installedVersion')}: ${st.localVersion}`
                    : t('mods.installedTag')
                  : t('mods.notInstalled')}
              </p>
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
              installed
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
            )}
          >
            {installed ? t('mods.installedTag') : t('mods.notInstalled')}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-[#1a1e26] p-3">
            <p className="text-xs text-textMuted">{t('mods.latestVersion')}</p>
            <p className="mt-0.5 font-semibold text-textMain">{st?.remoteVersion ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-[#1a1e26] p-3">
            <p className="text-xs text-textMuted">{t('mods.plugins')}</p>
            <p className="mt-0.5 font-semibold text-textMain">{st?.pluginCount ?? 0}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            loading={isBusy}
            disabled={!bridge || !server.installPath}
            onClick={() => void install(kind)}
          >
            <Download className="h-4 w-4" />
            {installed ? t('mods.update') : t('mods.install')}
          </Button>
          <Button
            variant="danger"
            disabled={!installed || isBusy || !bridge}
            onClick={() => setConfirmRemove(kind)}
          >
            <Trash2 className="h-4 w-4" /> {t('mods.remove')}
          </Button>
        </div>

        {st?.error && <p className="mt-2 text-xs text-red-400">{st.error}</p>}
      </div>
    );
  };

  if (!bridge) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
        {t('mods.browserDemo')}
      </p>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <Zap className="h-4 w-4 text-accent" /> {t('mods.title')}
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('mods.refresh')}
        </Button>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-textMuted">
        <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        {t('mods.hint')}
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {!server.installPath && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          {t('mods.installPathNeeded')}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {loading && !status ? (
          <p className="col-span-full py-10 text-center text-sm text-textMuted">{t('mods.checking')}</p>
        ) : (
          <>
            {renderCard('oxide')}
            {renderCard('carbon')}
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmRemove !== null}
        title={t('mods.removeTitle', {
          mod: confirmRemove ? MOD_META[confirmRemove].name : '',
        })}
        message={t('mods.removeMessage')}
        confirmLabel={t('mods.removeConfirm')}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => void doRemove()}
      />
    </div>
  );
}
