import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock3, HardDriveDownload, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { BackupScheduleInput, RestartScheduleInput, RustServer, ScheduledTask } from '@/types';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

interface ScheduleTabProps {
  server: RustServer;
}

interface RestartForm {
  time: string;
  warnMinutes: number[];
}

interface BackupForm {
  frequency: BackupScheduleInput['frequency'];
  everyHours: string;
  timeOfDay: string;
  weekday: number;
  retention: string;
  label: string;
}

const WARN_OPTIONS = [10, 5, 1, 0];

const INIT_RESTART: RestartForm = { time: '06:00', warnMinutes: [5, 1] };
const INIT_BACKUP: BackupForm = {
  frequency: 'daily',
  everyHours: '6',
  timeOfDay: '04:00',
  weekday: 1,
  retention: '5',
  label: '',
};

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

function freqLabel(t: (k: string, opts?: Record<string, unknown>) => string, task: ScheduledTask): string {
  if (task.frequency === 'hourly') return t('schedule.freqHourlyN', { hours: task.everyHours || 6 });
  if (task.frequency === 'weekly') return t('schedule.freqWeekly');
  return t('schedule.freqDaily');
}

export function ScheduleTab({ server }: ScheduleTabProps) {
  const bridge = window.rustManager;
  const demoMode = !bridge;
  const { t } = useTranslation();

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [restartForm, setRestartForm] = useState<RestartForm>(INIT_RESTART);
  const [backupForm, setBackupForm] = useState<BackupForm>(INIT_BACKUP);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const flash = (text: string, isError = false) => {
    if (isError) setError(text);
    else setNotice(text);
    setTimeout(() => {
      setError('');
      setNotice('');
    }, 6000);
  };

  const load = useCallback(async () => {
    if (!bridge) return;
    try {
      const list = await bridge.tasksList();
      setTasks((list ?? []).filter((task) => task.serverId === server.id));
    } catch {
      // IPC недоступен
    }
  }, [bridge, server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!bridge?.onTasksChanged) return;
    return bridge.onTasksChanged(() => void load());
  }, [bridge, load]);

  const toggleWarn = (min: number) => {
    setRestartForm((prev) => ({
      ...prev,
      warnMinutes: prev.warnMinutes.includes(min)
        ? prev.warnMinutes.filter((m) => m !== min)
        : [...prev.warnMinutes, min],
    }));
  };

  const addRestart = async (e: FormEvent) => {
    e.preventDefault();
    if (!bridge) return;
    if (!/^\d{1,2}:\d{2}$/.test(restartForm.time.trim())) {
      flash(t('schedule.badTime'), true);
      return;
    }
    const warnMinutes = [...restartForm.warnMinutes].sort((a, b) => b - a);
    const warnMessages = warnMinutes.map((m) =>
      m === 0
        ? t('schedule.warnNowMsg', { name: server.name })
        : t('schedule.warnMsg', { minutes: m, name: server.name })
    );
    const input: RestartScheduleInput = {
      serverId: server.id,
      server,
      time: restartForm.time,
      warnMinutes,
      warnMessages,
    };
    try {
      await bridge.tasksAddRestart(input);
      flash(t('schedule.restartAdded'));
      setRestartForm(INIT_RESTART);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    }
  };


  const addBackup = async (e: FormEvent) => {
    e.preventDefault();
    if (!bridge) return;
    const input: BackupScheduleInput = {
      serverId: server.id,
      server,
      frequency: backupForm.frequency,
      everyHours: backupForm.frequency === 'hourly' ? Number(backupForm.everyHours) || 6 : undefined,
      timeOfDay:
        backupForm.frequency === 'daily' || backupForm.frequency === 'weekly'
          ? backupForm.timeOfDay || '04:00'
          : undefined,
      weekday: backupForm.frequency === 'weekly' ? backupForm.weekday : undefined,
      retention: Number(backupForm.retention) || 5,
      label: backupForm.label.trim() || undefined,
    };
    try {
      await bridge.tasksAddBackup(input);
      flash(t('schedule.backupAdded'));
      setBackupForm(INIT_BACKUP);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    }
  };

  const remove = async (id: string) => {
    if (!bridge) return;
    await bridge.tasksRemove(id).catch(() => undefined);
  };

  const restarts = tasks.filter((task) => task.type === 'restart');
  const backups = tasks.filter((task) => task.type === 'backup');

  if (demoMode) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
        {t('schedule.browserDemo')}
      </p>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
        <CalendarClock className="h-4 w-4 text-accent" />
        {t('schedule.title')}
        <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
          {restarts.length + backups.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-textMuted">{t('schedule.subtitle')}</p>

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

      {/* Ежедневные перезапуски */}
      <div className="mt-5 overflow-hidden rounded-xl border border-[#232833] bg-surface">
        <div className="flex items-center gap-2 border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5 text-sm font-semibold text-textMain">
          <Clock3 className="h-4 w-4 text-accent" /> {t('schedule.restartsTitle')}
          <span className="rounded-full bg-[#0f1115] px-2 py-0.5 text-xs text-textMuted">{restarts.length}</span>
        </div>

        <form onSubmit={addRestart} className="flex flex-wrap items-end gap-3 border-b border-[#232833] px-4 py-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-textMain">{t('schedule.restartTime')}</span>
            <input
              type="time"
              value={restartForm.time}
              onChange={(e) => setRestartForm((prev) => ({ ...prev, time: e.target.value }))}
              className="h-10 w-32 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-textMain">{t('schedule.warnBefore')}</span>
            <div className="flex flex-wrap gap-2">
              {WARN_OPTIONS.map((min) => (
                <label
                  key={min}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors',
                    restartForm.warnMinutes.includes(min)
                      ? 'border-accent/50 bg-accent/15 text-accent'
                      : 'border-[#2a2f3a] bg-[#0f1115] text-textMuted hover:text-textMain'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={restartForm.warnMinutes.includes(min)}
                    onChange={() => toggleWarn(min)}
                    className="hidden"
                  />
                  {min === 0 ? t('schedule.warnNow') : t('schedule.warnMin', { min })}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" size="md">
            <Plus className="h-4 w-4" /> {t('schedule.addRestart')}
          </Button>
        </form>

        {restarts.length === 0 ? (
          <p className="p-6 text-center text-sm text-textMuted">{t('schedule.noRestarts')}</p>
        ) : (
          restarts.map((task, idx) => (
            <div
              key={task.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 px-5 py-4',
                idx !== restarts.length - 1 && 'border-b border-[#232833]'
              )}
            >
              <div>
                <p className="font-semibold text-textMain">
                  {t('schedule.dailyAt', { time: task.time || '—' })} · {fmtDate(task.nextRun)}
                </p>
                <p className="mt-0.5 text-xs text-textMuted">
                  {task.warnMinutes && task.warnMinutes.length > 0
                    ? t('schedule.warnList', { mins: [...task.warnMinutes].sort((a, b) => b - a).join(', ') })
                    : t('schedule.noWarn')}
                  {task.lastResult && ` · ${task.lastResult}`}
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => void remove(task.id)}>
                <Trash2 className="h-3.5 w-3.5" /> {t('schedule.remove')}
              </Button>
            </div>
          ))
        )}
      </div>


      {/* Автобэкапы */}
      <div className="mt-6 overflow-hidden rounded-xl border border-[#232833] bg-surface">
        <div className="flex items-center gap-2 border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5 text-sm font-semibold text-textMain">
          <HardDriveDownload className="h-4 w-4 text-accent" /> {t('schedule.backupsTitle')}
          <span className="rounded-full bg-[#0f1115] px-2 py-0.5 text-xs text-textMuted">{backups.length}</span>
        </div>

        <form onSubmit={addBackup} className="flex flex-wrap items-end gap-3 border-b border-[#232833] px-4 py-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-textMain">{t('schedule.backupFrequency')}</span>
            <select
              value={backupForm.frequency}
              onChange={(e) =>
                setBackupForm((prev) => ({
                  ...prev,
                  frequency: e.target.value as BackupForm['frequency'],
                }))
              }
              className="h-10 w-40 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
            >
              <option value="hourly">{t('schedule.freqHourly')}</option>
              <option value="daily">{t('schedule.freqDaily')}</option>
              <option value="weekly">{t('schedule.freqWeekly')}</option>
            </select>
          </label>

          {backupForm.frequency === 'hourly' && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-textMain">{t('schedule.everyHours')}</span>
              <input
                type="number"
                min={1}
                max={72}
                value={backupForm.everyHours}
                onChange={(e) => setBackupForm((prev) => ({ ...prev, everyHours: e.target.value }))}
                className="h-10 w-24 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
              />
            </label>
          )}

          {(backupForm.frequency === 'daily' || backupForm.frequency === 'weekly') && (
            <>
              {backupForm.frequency === 'weekly' && (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-textMain">{t('schedule.weekday')}</span>
                  <select
                    value={backupForm.weekday}
                    onChange={(e) => setBackupForm((prev) => ({ ...prev, weekday: Number(e.target.value) }))}
                    className="h-10 w-36 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>
                        {t(`schedule.weekdayNames.${d}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-textMain">{t('schedule.backupTime')}</span>
                <input
                  type="time"
                  value={backupForm.timeOfDay}
                  onChange={(e) => setBackupForm((prev) => ({ ...prev, timeOfDay: e.target.value }))}
                  className="h-10 w-32 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-textMain">{t('schedule.retention')}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={backupForm.retention}
              onChange={(e) => setBackupForm((prev) => ({ ...prev, retention: e.target.value }))}
              className="h-10 w-24 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-textMain">{t('schedule.backupLabel')}</span>
            <input
              value={backupForm.label}
              onChange={(e) => setBackupForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="auto"
              className="h-10 w-36 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain placeholder:text-textMuted/60 focus:border-accent focus:outline-none"
            />
          </label>

          <Button type="submit" size="md">
            <Plus className="h-4 w-4" /> {t('schedule.addBackup')}
          </Button>
        </form>


        {backups.length === 0 ? (
          <p className="p-6 text-center text-sm text-textMuted">{t('schedule.noBackups')}</p>
        ) : (
          backups.map((task, idx) => (
            <div
              key={task.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 px-5 py-4',
                idx !== backups.length - 1 && 'border-b border-[#232833]'
              )}
            >
              <div>
                <p className="font-semibold text-textMain">
                  {freqLabel(t, task)}
                  {task.timeOfDay && ` · ${task.timeOfDay}`}
                  {task.label ? ` · ${task.label}` : ''}
                  {' — '}
                  {fmtDate(task.nextRun)}
                </p>
                <p className="mt-0.5 text-xs text-textMuted">
                  {t('schedule.keepLast', { n: task.retention ?? 5 })}
                  {task.lastResult && ` · ${task.lastResult}`}
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => void remove(task.id)}>
                <Trash2 className="h-3.5 w-3.5" /> {t('schedule.remove')}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('schedule.refresh')}
        </Button>
      </div>
    </div>
  );
}

