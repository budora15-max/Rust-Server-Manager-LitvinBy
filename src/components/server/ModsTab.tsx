import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Download, MapPinned, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { ModStatus, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';

interface ModsTabProps {
  server: RustServer;
}

const MOD_NAME = 'Oxide (uMod)';

export function ModsTab({ server }: ModsTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [status, setStatus] = useState<ModStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  const [extBusy, setExtBusy] = useState<'install' | 'remove' | null>(null);
  const [extMsg, setExtMsg] = useState('');

  useEffect(() => {
    if (!bridge?.rusteditExtensionStatus || !server.installPath) return;
    let cancelled = false;
    bridge
      .rusteditExtensionStatus(server)
      .then((res) => {
        if (!cancelled) setExtInstalled(res.installed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bridge, server]);

  const installRustEditExt = async () => {
    if (!bridge?.rusteditExtensionInstall) return;
    setExtBusy('install');
    setExtMsg('');
    try {
      const res = await bridge.rusteditExtensionInstall(server);
      if (res.ok) {
        setExtInstalled(true);
        setExtMsg(t('serverPage.map.rusteditExtInstallOk'));
      } else {
        setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: res.error }));
      }
    } catch {
      setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: '?' }));
    } finally {
      setExtBusy(null);
    }
  };

  const removeRustEditExt = async () => {
    if (!bridge?.rusteditExtensionRemove) return;
    setExtBusy('remove');
    setExtMsg('');
    try {
      const res = await bridge.rusteditExtensionRemove(server);
      if (res.ok) setExtInstalled(false);
      else setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: res.error }));
    } catch {
      setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: '?' }));
    } finally {
      setExtBusy(null);
    }
  };

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
      const res = await bridge.modsStatus(server);
      setStatus(res.oxide);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge, server]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    if (!bridge) return;
    setBusy(true);
    setError('');
    try {
      const res = await bridge.modsInstall(server);
      if (res.installed) {
        flash(t('mods.installed', { mod: MOD_NAME, version: res.remoteVersion ?? '' }));
      } else {
        flash(res.error ?? t('mods.installFailed', { error: res.error ?? '' }), true);
      }
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    if (!confirmRemove || !bridge) return;
    setBusy(true);
    setError('');
    try {
      const res = await bridge.modsRemove(server);
      if (res.ok) flash(t('mods.removed', { mod: MOD_NAME }));
      else flash(res.error ?? t('mods.removeFailed'), true);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const installed = !!status?.installed;

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

      <div className="mt-4 max-w-xl">
        {loading && !status ? (
          <p className="py-10 text-center text-sm text-textMuted">{t('mods.checking')}</p>
        ) : (
          <div className="rounded-xl border border-[#232833] bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a1e26] text-accent">
                  <Boxes className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-textMain">{MOD_NAME}</p>
                  <p className="text-xs text-textMuted">
                    {installed ? t('mods.installedTag') : t('mods.notInstalled')}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  installed
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                }`}
              >
                {installed ? t('mods.installedTag') : t('mods.notInstalled')}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-[#1a1e26] p-3">
                <p className="text-xs text-textMuted">{t('mods.installedVersion')}</p>
                <p className="mt-0.5 font-semibold text-textMain">{status?.localVersion ?? '—'}</p>
              </div>
              <div className="rounded-lg bg-[#1a1e26] p-3">
                <p className="text-xs text-textMuted">{t('mods.latestVersion')}</p>
                <p className="mt-0.5 font-semibold text-textMain">{status?.remoteVersion ?? '—'}</p>
              </div>
              <div className="rounded-lg bg-[#1a1e26] p-3">
                <p className="text-xs text-textMuted">{t('mods.plugins')}</p>
                <p className="mt-0.5 font-semibold text-textMain">{status?.pluginCount ?? 0}</p>
              </div>
            </div>

            {status?.branches && status.branches.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-textMuted">{t('mods.branches')}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {status.branches.map((b) => (
                    <span
                      key={b.name}
                      className="inline-flex items-center gap-1 rounded-full border border-[#2a2f3a] bg-[#1a1e26] px-2 py-0.5 text-[11px] text-textMuted"
                    >
                      {b.name}
                      <span className="font-mono text-textMain/80">#{b.buildid}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <Button
                loading={busy}
                disabled={!bridge || !server.installPath}
                onClick={() => void install()}
              >
                <Download className="h-4 w-4" />
                {installed ? t('mods.update') : t('mods.install')}
              </Button>
              <Button
                variant="danger"
                disabled={!installed || busy || !bridge}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="h-4 w-4" /> {t('mods.remove')}
              </Button>
            </div>

            {status?.error && <p className="mt-2 text-xs text-red-400">{status.error}</p>}
          </div>
        )}
      </div>

      {/* Расширение Oxide.Ext.RustEdit.dll — нужно для запуска кастомных карт RustEdit. */}
      {server.installPath && extInstalled !== null && (
        <div className="mt-4 max-w-xl rounded-xl border border-[#232833] bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-textMain">
                <MapPinned className="h-4 w-4 text-accent" />
                {t('serverPage.map.rusteditExtTitle')}
              </h3>
              <p
                className={
                  extInstalled
                    ? 'mt-0.5 text-xs text-emerald-400'
                    : 'mt-0.5 text-xs text-amber-400'
                }
              >
                {extInstalled
                  ? t('serverPage.map.rusteditExtInstalled')
                  : t('serverPage.map.rusteditExtMissing')}
              </p>
            </div>
            {extInstalled ? (
              <Button
                size="sm"
                variant="danger"
                loading={extBusy === 'remove'}
                onClick={() => void removeRustEditExt()}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t('serverPage.map.rusteditExtRemove')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={extBusy === 'install'}
                onClick={() => void installRustEditExt()}
              >
                <Download className="h-3.5 w-3.5" /> {t('serverPage.map.rusteditExtInstall')}
              </Button>
            )}
          </div>
          {extMsg && <p className="mt-2 text-xs text-textMuted">{extMsg}</p>}
        </div>
      )}

      <ConfirmModal
        open={confirmRemove}
        title={t('mods.removeTitle', { mod: MOD_NAME })}
        message={t('mods.removeMessage')}
        confirmLabel={t('mods.removeConfirm')}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void doRemove()}
      />
    </div>
  );
}