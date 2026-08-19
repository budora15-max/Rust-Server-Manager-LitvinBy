import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CalendarClock, Eraser, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { BackupEntry, RustServer, ScheduledWipe, ScheduledWipeEntry, WipeOptions } from '@/types';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { cn } from '@/lib/utils';

interface WipeForm {
  frequency: ScheduledWipe['frequency'];
  nextRun: string;
  wipeMap: boolean;
  wipeDb: boolean;
  regenerateSeed: boolean;
}

const INITIAL_FORM: WipeForm = {
  frequency: 'Weekly',
  nextRun: '',
  wipeMap: true,
  wipeDb: true,
  regenerateSeed: true,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type Notice = { type: 'ok' | 'err' | 'warn'; text: string };

interface WipesTabProps {
  server: RustServer;
  onSeedChange: (seed: number) => void;
}

export function WipesTab({ server, onSeedChange }: WipesTabProps) {
  const bridge = window.rustManager;
  const demoMode = !bridge;
  const { t } = useTranslation();

  const [wipes, setWipes] = useState<ScheduledWipeEntry[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [form, setForm] = useState<WipeForm>(INITIAL_FORM);
  const [toDelete, setToDelete] = useState<ScheduledWipeEntry | null>(null);
  const [confirmRunNow, setConfirmRunNow] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [running, setRunning] = useState(false);
  const [backupLabel, setBackupLabel] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [confirmDeleteBackup, setConfirmDeleteBackup] = useState<BackupEntry | null>(null);

  const wipesRef = useRef(wipes);
  useEffect(() => {
    wipesRef.current = wipes;
  }, [wipes]);

  const pushNotice = (type: Notice['type'], text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 7000);
  };

  const set = <K extends keyof WipeForm>(key: K, value: WipeForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError('');
  };

  const loadAll = async () => {
    if (!bridge) return;
    try {
      const [w, b] = await Promise.all([bridge.wipesList(), bridge.backupList(server)]);
      setWipes(w ?? []);
      setBackups(b ?? []);
    } catch {
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  useEffect(() => {
    if (!bridge?.onWipeScheduleChanged) return;
    return bridge.onWipeScheduleChanged(() => {
      void bridge.wipesList().then((w) => setWipes(w ?? []));
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.onWipeExecuted) return;
    return bridge.onWipeExecuted((event) => {
      if (event.serverId !== server.id) return;
      if (event.ok) {
        if (event.newSeed) onSeedChange(event.newSeed);
        pushNotice(
          'ok',
          t('wipes.executed', {
            count: event.deleted,
            seedPart: event.newSeed ? t('wipes.seedPart', { seed: event.newSeed }) : '',
            restart: event.restarted ? t('wipes.restartPart') : '',
          })
        );
      } else {
        pushNotice('err', t('wipes.executedError', { error: event.message ?? '?' }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, server.id]);

  useEffect(() => {
    if (!bridge?.onServerSeedChanged) return;
    return bridge.onServerSeedChanged((event) => {
      if (event.serverId === server.id) onSeedChange(event.seed);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, server.id]);

  const executeWipe = async (options: WipeOptions, source: string) => {
    setRunning(true);
    const seedPart = (seed: number) => t('wipes.seedPart', { seed });
    try {
      if (bridge) {
        const res = await bridge.wipeExecute(server, options);
        if (res.ok) {
          if (options.regenerateSeed && res.newSeed) onSeedChange(res.newSeed);
          if (res.mode === 'real') {
            pushNotice(
              'ok',
              t('wipes.completed', {
                source,
                count: res.deletedFiles.length,
                seedPart: options.regenerateSeed && res.newSeed ? seedPart(res.newSeed) : '',
              })
            );
          } else {
            pushNotice(
              'warn',
              t('wipes.simulatedWipe', {
                source,
                message: res.message ?? '',
                seedPart: options.regenerateSeed && res.newSeed ? seedPart(res.newSeed) : '',
              })
            );
          }
        } else {
          pushNotice('err', t('wipes.failed', { error: res.message ?? '?' }));
        }
      } else {
        pushNotice('warn', t('wipes.browserDemo'));
      }
    } catch (e) {
      pushNotice('err', t('wipes.failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setRunning(false);
    }
  };

  const addWipe = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.nextRun) {
      setError(t('wipes.dateRequired'));
      return;
    }
    if (!bridge) {
      pushNotice('warn', t('wipes.browserDemo'));
      return;
    }
    const entry: ScheduledWipeEntry = {
      id: `w_${Date.now()}`,
      serverId: server.id,
      server,
      frequency: form.frequency,
      nextRun: new Date(form.nextRun).toISOString(),
      wipeMap: form.wipeMap,
      wipeDb: form.wipeDb,
      regenerateSeed: form.regenerateSeed,
      createdAt: Date.now(),
    };
    const list = await bridge.wipesAdd(entry);
    setWipes(list ?? []);
    setForm(INITIAL_FORM);
    pushNotice('ok', t('wipes.added', { date: fmtDate(entry.nextRun) }));
  };

  const confirmDeleteWipe = async () => {
    if (!toDelete || !bridge) return;
    const list = await bridge.wipesRemove(toDelete.id);
    setWipes(list ?? []);
    setToDelete(null);
    pushNotice('ok', t('wipes.removed'));
  };

  const createBackup = async () => {
    if (!bridge) return;
    setBackupBusy(true);
    try {
      const res = await bridge.backupCreate(server, backupLabel.trim() || undefined);
      if (res.ok && res.entry) {
        setBackups((prev) => [res.entry!, ...prev]);
        pushNotice(
          'ok',
          t('backups.created', {
            files: res.entry.fileCount,
            mb: formatBytes(res.entry.sizeBytes),
          })
        );
        setBackupLabel('');
      } else {
        pushNotice('err', t('backups.createFailed', { error: res.error ?? '?' }));
      }
    } catch (e) {
      pushNotice('err', t('backups.createFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBackupBusy(false);
    }
  };

  const doRestoreBackup = async () => {
    if (!confirmRestore || !bridge) return;
    const res = await bridge.backupRestore(server, confirmRestore.id);
    setConfirmRestore(null);
    if (res.ok) {
      pushNotice('ok', t('backups.restored', { count: res.entry?.fileCount ?? 0 }));
    } else {
      pushNotice('err', t('backups.restoreFailed', { error: res.error ?? '?' }));
    }
  };

  const doDeleteBackup = async () => {
    if (!confirmDeleteBackup || !bridge) return;
    const res = await bridge.backupDelete(server, confirmDeleteBackup.id);
    setConfirmDeleteBackup(null);
    if (res.ok) {
      setBackups((prev) => prev.filter((b) => b.id !== confirmDeleteBackup.id));
      pushNotice('ok', t('backups.deleted'));
    } else {
      pushNotice('err', t('backups.deleteFailed', { error: res.error ?? '?' }));
    }
  };

  const checkbox = (key: 'wipeMap' | 'wipeDb' | 'regenerateSeed', label: string) => (
    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-textMuted">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(e) => set(key, e.target.checked)}
        className="h-4 w-4 rounded border-[#3a4150] bg-[#1a1e26] accent-accent"
      />
      {label}
    </label>
  );

  const runNow = () => {
    setConfirmRunNow(false);
    executeWipe({ wipeMap: true, wipeDb: true, regenerateSeed: true }, t('wipes.manual'));
  };

  return (
    <div className="max-w-5xl">
      {notice && (
        <p
          className={cn(
            'mb-4 rounded-lg border px-3 py-2 text-sm',
            notice.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : notice.type === 'warn'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
          )}
        >
          {notice.text}
        </p>
      )}

      {/* Бэкапы мира */}
      <div className="rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <Archive className="h-4 w-4 text-accent" /> {t('backups.title')}
            <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
              {backups.length}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <input
              value={backupLabel}
              onChange={(e) => setBackupLabel(e.target.value)}
              placeholder={t('backups.labelPlaceholder')}
              className="h-10 w-full max-w-xs rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
            />
            <Button onClick={() => void createBackup()} loading={backupBusy} disabled={backupBusy}>
              <Plus className="h-4 w-4" /> {t('backups.create')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void loadAll()} disabled={backupBusy}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {backups.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[#2a2f3a] bg-surface/50 p-6 text-center text-sm text-textMuted">
            {t('backups.empty')}
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-[#232833]">
            {backups.map((b, idx) => (
              <div
                key={b.id}
                className={
                  'flex flex-wrap items-center justify-between gap-2 bg-[#0f1115] px-4 py-3 ' +
                  (idx !== backups.length - 1 ? 'border-b border-[#232833]' : '')
                }
              >
                <div>
                  <p className="text-sm font-semibold text-textMain">
                    {fmtDate(new Date(b.createdAt).toISOString())}
                    {b.label !== b.id && (
                      <span className="ml-2 text-xs font-normal text-textMuted">{b.label}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-textMuted">
                    {t('backups.size', { size: formatBytes(b.sizeBytes) })} ·{' '}
                    {t('backups.files', { count: b.fileCount })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setConfirmRestore(b)}>
                    {t('backups.restore')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteBackup(b)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Статус + кнопка немедленного вайпа */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-textMain">{t('wipes.engine')}</p>
          <p className="mt-0.5 text-xs text-textMuted">
            {demoMode
              ? t('wipes.demoMode')
              : server.installPath
                ? t('wipes.realFs', { path: `${server.installPath}\\server\\${server.identity}` })
                : t('wipes.simulated')}
          </p>
        </div>
        <Button variant="danger" onClick={() => setConfirmRunNow(true)} disabled={running} loading={running}>
          <Zap className="h-4 w-4" /> {t('wipes.wipeNow')}
        </Button>
      </div>

      {/* Планировщик */}
      <form onSubmit={addWipe} className="mt-6 rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <CalendarClock className="h-4 w-4 text-accent" /> {t('wipes.schedule')}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-textMain">{t('wipes.frequency')}</span>
            <select
              value={form.frequency}
              onChange={(e) => set('frequency', e.target.value as ScheduledWipe['frequency'])}
              className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              <option value="Daily">{t('wipes.daily')}</option>
              <option value="Weekly">{t('wipes.weekly')}</option>
              <option value="Monthly">{t('wipes.monthly')}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-textMain">{t('wipes.nextWipe')}</span>
            <input
              type="datetime-local"
              value={form.nextRun}
              onChange={(e) => set('nextRun', e.target.value)}
              className="h-11 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> {t('wipes.scheduleButton')}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-5">
          {checkbox('wipeMap', t('wipes.wipeMap'))}
          {checkbox('wipeDb', t('wipes.wipeDb'))}
          {checkbox('regenerateSeed', t('wipes.regenerateSeed'))}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
      </form>

      {/* Список запланированных вайпов */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-textMain">
          <Eraser className="h-4 w-4 text-accent" /> {t('wipes.scheduled')}
          <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
            {wipes.length}
          </span>
        </div>

        {wipes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2a2f3a] bg-surface/50 p-8 text-center text-sm text-textMuted">
            {t('wipes.noScheduled', { name: server.name })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#232833] bg-surface">
            {wipes.map((wipe, idx) => (
              <div
                key={wipe.id}
                className={
                  'flex flex-wrap items-center justify-between gap-3 px-5 py-4 ' +
                  (idx !== wipes.length - 1 ? 'border-b border-[#232833]' : '')
                }
              >
                <div>
                  <p className="font-semibold text-textMain">
                    {t('wipes.frequencyName', { frequency: t(`wipes.${wipe.frequency.toLowerCase()}`) })} ·{' '}
                    {fmtDate(wipe.nextRun)}
                  </p>
                  <p className="mt-0.5 text-xs text-textMuted">
                    {[
                      wipe.wipeMap && t('wipes.partsMap'),
                      wipe.wipeDb && t('wipes.partsDb'),
                      wipe.regenerateSeed && t('wipes.newSeed'),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    {wipe.lastResult && ` · ${t('wipes.lastResult', { result: wipe.lastResult })}`}
                  </p>
                </div>
                <Button size="sm" variant="danger" onClick={() => setToDelete(wipe)}>
                  <Trash2 className="h-3.5 w-3.5" /> {t('wipes.remove')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmRunNow}
        title={t('wipes.wipeNowTitle')}
        message={t('wipes.wipeNowMessage', {
          name: server.name,
          suffix: server.installPath ? '' : ` (${t('wipes.simulated')})`,
        })}
        confirmLabel={t('wipes.wipeNowConfirm')}
        onCancel={() => setConfirmRunNow(false)}
        onConfirm={runNow}
      />

      <ConfirmModal
        open={toDelete !== null}
        title={t('wipes.removeTitle')}
        message={t('wipes.removeMessage', {
          frequency: toDelete?.frequency,
          name: server.name,
        })}
        confirmLabel={t('wipes.removeConfirm')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDeleteWipe()}
      />

      <ConfirmModal
        open={confirmRestore !== null}
        title={t('backups.restoreTitle')}
        message={t('backups.restoreMessage', { id: confirmRestore?.id ?? '' })}
        confirmLabel={t('backups.restoreConfirm')}
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => void doRestoreBackup()}
      />

      <ConfirmModal
        open={confirmDeleteBackup !== null}
        title={t('backups.deleteTitle')}
        message={t('backups.deleteMessage', { id: confirmDeleteBackup?.id ?? '' })}
        confirmLabel={t('backups.deleteConfirm')}
        onCancel={() => setConfirmDeleteBackup(null)}
        onConfirm={() => void doDeleteBackup()}
      />
    </div>
  );
}
