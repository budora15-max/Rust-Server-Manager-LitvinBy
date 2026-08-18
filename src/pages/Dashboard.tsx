import { useState } from 'react';
import { Activity, Cpu, Plus, Server, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/AppShell';
import { ServerCard } from '@/components/ServerCard';
import { SystemMemoryPanel } from '@/components/server/SystemMemoryPanel';
import { Button } from '@/components/Button';
import { NewServerModal } from '@/components/NewServerModal';
import { useServer } from '@/context/ServerContext';
import { useMetrics } from '@/context/MetricsContext';
import { useAuth } from '@/context/AuthContext';

export default function Dashboard() {
  const { servers } = useServer();
  const metrics = useMetrics();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [showNewServer, setShowNewServer] = useState(false);

  const total = servers.length;
  const online = servers.filter((s) => s.status === 'online').length;
  const playersOnline = servers.reduce((acc, s) => {
    const sample = metrics[s.id];
    const count = sample?.onlinePlayers ?? s.onlinePlayers;
    return acc + (s.status === 'online' ? count : 0);
  }, 0);
  const avgCpu =
    total > 0
      ? Math.round(
          servers.reduce((acc, s) => {
            const sample = metrics[s.id];
            return acc + (sample?.cpu ?? s.cpu);
          }, 0) / total
        )
      : 0;

  // Суммарная RAM всех работающих серверов (из живых метрик).
  const serversRamMb = servers.reduce((acc, s) => acc + (metrics[s.id]?.memoryMb ?? 0), 0);

  const stats = [
    { label: t('dashboard.totalServers'), value: String(total), Icon: Server, tint: 'text-accent bg-accent/10' },
    { label: t('dashboard.online'), value: `${online}/${total}`, Icon: Activity, tint: 'text-emerald-400 bg-emerald-500/10' },
    { label: t('dashboard.playersOnline'), value: String(playersOnline), Icon: Users, tint: 'text-sky-400 bg-sky-500/10' },
    { label: t('dashboard.avgCpu'), value: `${avgCpu}%`, Icon: Cpu, tint: 'text-amber-400 bg-amber-500/10' },
  ];

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-textMain">{t('dashboard.title')}</h1>
          <p className="mt-0.5 text-sm text-textMuted">
            {t('dashboard.welcome', { username: user?.username })}
          </p>
        </div>
        <Button onClick={() => setShowNewServer(true)}>
          <Plus className="h-4 w-4" /> {t('dashboard.newServer')}
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, Icon, tint }) => (
          <div
            key={label}
            className="flex items-center gap-4 rounded-xl border border-[#232833] bg-surface p-4"
          >
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tint}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-textMuted">{label}</p>
              <p className="text-xl font-bold text-textMain">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Память: все серверы + система */}
      <div className="mt-6">
        <SystemMemoryPanel
          serverMb={serversRamMb}
          title={t('dashboard.memory.title')}
          serverLabel={t('dashboard.memory.servers')}
        />
      </div>

      {/* Серверы */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-textMain">{t('dashboard.yourServers')}</h2>
          <span className="text-sm text-textMuted">{total} {t('dashboard.configured')}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
          {servers.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-[#2a2f3a] bg-surface/50 p-10 text-center text-sm text-textMuted">
              {t('dashboard.noServers')}
            </div>
          )}
        </div>
      </div>

      <NewServerModal open={showNewServer} onClose={() => setShowNewServer(false)} />
    </AppShell>
  );
}
