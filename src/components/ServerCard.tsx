import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cpu, MemoryStick, Play, RotateCw, Square, Users } from 'lucide-react';
import type { RustServer } from '@/types';
import { useServer } from '@/context/ServerContext';
import { useMetricHistory, useMetrics } from '@/context/MetricsContext';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
import { ConfirmModal } from './ConfirmModal';
import { MetricsChart } from './MetricsChart';
import { cn, formatUptime } from '@/lib/utils';

export function ServerCard({ server }: { server: RustServer }) {
  const { startServer, stopServer, restartServer } = useServer();
  const metrics = useMetrics();
  const history = useMetricHistory(server.id);
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);

  const sample = metrics[server.id];
  const cpuHistory = history.map((h) => h.cpu);

  const transitioning = server.status === 'starting' || server.status === 'stopping';
  const isOnline = server.status === 'online' || server.status === 'sim';
  const online = isOnline || server.status === 'starting';

  const onlinePlayers = sample?.onlinePlayers ?? server.onlinePlayers;
  const maxPlayers = sample?.maxPlayers ?? server.maxPlayers;
  const playersPct = maxPlayers > 0 ? Math.round((onlinePlayers / maxPlayers) * 100) : 0;

  // Метрики процесса показываем только для живого сервера: когда сервер
  // остановлен/упал, последний сэмпл прошлой сессии выдавать нельзя —
  // он выглядит как текущая нагрузка, хотя процесса уже нет.
  const liveMetrics = online && sample !== undefined;
  const cpu = liveMetrics ? sample.cpu : 0;
  const ramPct = liveMetrics ? Math.min(100, Math.round((sample.memoryMb / 8192) * 100)) : 0;
  const ramText = liveMetrics ? `${sample.memoryMb} MB` : '0 MB';
  const uptime = liveMetrics ? sample.uptimeSeconds : 0;

  const runAction = () => {
    if (!confirm) return;
    if (confirm === 'stop') stopServer(server.id);
    else restartServer(server.id);
    setConfirm(null);
  };

  return (
    <div className="flex flex-col rounded-xl border border-[#232833] bg-surface p-5 transition-colors hover:border-[#2e3442]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/servers/${server.id}`}
            className="block truncate font-semibold text-textMain transition-colors hover:text-accent"
          >
            {server.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-textMuted">
            {server.map} · {server.identity}
            {server.gamemode ? (
              <span> · {t(`general.gamemodes.${server.gamemode}`, { defaultValue: server.gamemode })}</span>
            ) : null}
          </p>
        </div>
        <StatusBadge status={server.status} />
      </div>

      {/* Игроки */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-textMuted">
            <Users className="h-4 w-4" /> {t('dashboard.players')}
          </span>
          <span className="font-semibold text-textMain">
            {t('dashboard.playersValue', { current: onlinePlayers, max: maxPlayers })}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1a1e26]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              online ? 'bg-emerald-500' : 'bg-slate-600'
            )}
            style={{ width: `${playersPct}%` }}
          />
        </div>
      </div>

      {/* CPU / RAM (live) */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[#1a1e26] p-3">
          <div className="flex items-center gap-1.5 text-xs text-textMuted">
            <Cpu className="h-3.5 w-3.5" /> {t('dashboard.cpu')}
          </div>
          <p className="mt-1 text-lg font-bold text-textMain">{cpu}%</p>
        </div>
        <div className="rounded-lg bg-[#1a1e26] p-3">
          <div className="flex items-center gap-1.5 text-xs text-textMuted">
            <MemoryStick className="h-3.5 w-3.5" /> {t('dashboard.ram')}
          </div>
          <p className="mt-1 text-lg font-bold text-textMain">{ramText}</p>
          <p className="text-xs text-textMuted">{t('dashboard.ramOf', { pct: ramPct })}</p>
        </div>
      </div>

      {/* График CPU */}
      <MetricsChart
        label={t('dashboard.cpuLoad')}
        value={`${cpu}%`}
        data={cpuHistory}
        color="#e05638"
        className="mt-3 p-3"
      />

      <div className="mt-3 flex items-center justify-between text-xs text-textMuted">
        <span>{t('dashboard.uptime')}: {formatUptime(uptime)}</span>
        <span>{t('dashboard.pluginsCount', { count: server.installedPlugins })}</span>
      </div>

      {/* Быстрые действия */}
      <div className="mt-4 flex items-center gap-2 border-t border-[#232833] pt-4">
        {!isOnline ? (
          <Button
            size="sm"
            variant="success"
            className="flex-1"
            disabled={transitioning}
            loading={server.status === 'starting'}
            onClick={() => startServer(server.id)}
          >
            <Play className="h-4 w-4" /> {t('dashboard.start')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              disabled={transitioning}
              loading={server.status === 'stopping'}
              onClick={() => setConfirm('stop')}
            >
              <Square className="h-4 w-4" /> {t('dashboard.stop')}
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirm('restart')}>
              <RotateCw className="h-4 w-4" /> {t('dashboard.restart')}
            </Button>
          </>
        )}
        <Link
          to={`/servers/${server.id}`}
          className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          {t('dashboard.manage')}
        </Link>
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm === 'stop' ? t('confirm.stopTitle') : t('confirm.restartTitle')}
        message={
          confirm === 'stop'
            ? t('confirm.stopMessage', { name: server.name })
            : t('confirm.restartMessage', { name: server.name })
        }
        confirmLabel={
          confirm === 'stop' ? t('confirm.stopConfirm') : t('confirm.restartConfirm')
        }
        onCancel={() => setConfirm(null)}
        onConfirm={runAction}
      />
    </div>
  );
}
