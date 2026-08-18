import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Download,
  Eraser,
  FileText,
  FlaskConical,
  Map,
  Package,
  Play,
  Plug,
  RotateCw,
  Send,
  Settings,
  Square,
  Terminal,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { MetricsChart } from '@/components/MetricsChart';
import { StatusBadge } from '@/components/StatusBadge';
import { useServer } from '@/context/ServerContext';
import { useMetricHistory, useMetrics } from '@/context/MetricsContext';
import { cn } from '@/lib/utils';
import type { SteamUpdateProgress } from '@/types';
import { GeneralTab } from '@/components/server/GeneralTab';
import { ConsoleTab } from '@/components/server/ConsoleTab';
import { MapTab } from '@/components/server/MapTab';
import { PlayersTab } from '@/components/server/PlayersTab';
import { PluginsTab } from '@/components/server/PluginsTab';
import { WipesTab } from '@/components/server/WipesTab';
import { ScheduleTab } from '@/components/server/ScheduleTab';
import { AnalyticsSection } from '@/components/server/AnalyticsSection';
import { LogsTab } from '@/components/server/LogsTab';
import { TelegramTab } from '@/components/server/TelegramTab';
import { PortsTab } from '@/components/server/PortsTab';
import { ModsTab } from '@/components/server/ModsTab';
import { DiscordTab } from '@/components/server/DiscordTab';
import { MarketplaceTab } from '@/components/server/MarketplaceTab';

type Tab =
  | 'general'
  | 'console'
  | 'map'
  | 'players'
  | 'plugins'
  | 'mods'
  | 'wipes'
  | 'schedule'
  | 'logs'
  | 'ports'
  | 'discord'
  | 'telegram'
  | 'marketplace';

type TabDef = { id: Tab; labelKey: string; Icon: typeof Settings };

const TABS: TabDef[] = [
  { id: 'general', labelKey: 'serverPage.tabs.general', Icon: Settings },
  { id: 'console', labelKey: 'serverPage.tabs.console', Icon: Terminal },
  { id: 'map', labelKey: 'serverPage.tabs.map', Icon: Map },
  { id: 'players', labelKey: 'serverPage.tabs.players', Icon: Users },
  { id: 'plugins', labelKey: 'serverPage.tabs.plugins', Icon: Plug },
  { id: 'mods', labelKey: 'serverPage.tabs.mods', Icon: Boxes },
  { id: 'wipes', labelKey: 'serverPage.tabs.wipes', Icon: Eraser },
  { id: 'schedule', labelKey: 'serverPage.tabs.schedule', Icon: CalendarClock },
  { id: 'logs', labelKey: 'serverPage.tabs.logs', Icon: FileText },
  { id: 'ports', labelKey: 'serverPage.tabs.ports', Icon: Wifi },
  { id: 'discord', labelKey: 'serverPage.tabs.discord', Icon: Bell },
  { id: 'telegram', labelKey: 'serverPage.tabs.telegram', Icon: Send },
  { id: 'marketplace', labelKey: 'serverPage.tabs.marketplace', Icon: Package },
];

export default function ServerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { getServer, startServer, stopServer, restartServer, updateServer, removeServer } = useServer();
  const server = getServer(id);

  const [tab, setTab] = useState<Tab>('general');
  const [confirm, setConfirm] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updateState, setUpdateState] = useState<{
    running: boolean;
    pct?: number;
    message?: string;
    error?: string;
  } | null>(null);

  // Прогресс обновления сервера (SteamCMD)
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.onServerUpdateProgress) return;
    const unsubscribe = bridge.onServerUpdateProgress((event: SteamUpdateProgress) => {
      if (event.serverId !== server?.id) return;
      setUpdateState({ running: true, pct: event.pct, message: event.message });
    });
    return unsubscribe;
  }, [server?.id]);

  // Синхронизация счётчика плагинов (для «Свойств сервера» и карточек на дашборде).
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge || !server?.installPath) return;
    let stale = false;
    bridge
      .pluginsList(server)
      .then((res) => {
        if (stale || !res?.ok || !Array.isArray(res.plugins)) return;
        const count = res.plugins.length;
        if (server.installedPlugins !== count) updateServer(server.id, { installedPlugins: count });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  if (!server) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-center">
          <AlertTriangle className="h-12 w-12 text-textMuted" />
          <div>
            <h2 className="text-lg font-semibold text-textMain">{t('serverPage.notFound')}</h2>
            <p className="mt-1 text-sm text-textMuted">{t('serverPage.notFoundSubtitle')}</p>
          </div>
          <Button onClick={() => navigate('/servers')}>{t('serverPage.backToServers')}</Button>
        </div>
      </AppShell>
    );
  }

  const transitioning = server.status === 'starting' || server.status === 'stopping';
  const isOnline = server.status === 'online' || server.status === 'sim';

  const runAction = () => {
    if (!confirm) return;
    if (confirm === 'start') startServer(server.id);
    else if (confirm === 'stop') stopServer(server.id);
    else restartServer(server.id);
    setConfirm(null);
  };

  const confirmMessage =
    confirm === 'start'
      ? t('confirm.startMessage', { name: server.name })
      : confirm === 'stop'
        ? t('confirm.stopMessage', { name: server.name })
        : t('confirm.restartMessage', { name: server.name });

  const handleUpdateServer = async () => {
    setConfirmUpdate(false);
    setUpdateState({ running: true, message: t('serverPage.updateStarting') });
    try {
      const result = await window.rustManager?.serverUpdate(server);
      if (result?.ok) {
        setUpdateState({ running: false, message: t('serverPage.updateSuccess') });
      } else {
        setUpdateState({ running: false, message: undefined, error: t('serverPage.updateError', { error: result?.error ?? t('serverPage.updateFailed') }) });
      }
    } catch (e) {
      setUpdateState({ running: false, message: undefined, error: String(e) });
    }
  };

  const handleDeleteServer = () => {
    setConfirmDelete(false);
    removeServer(server.id);
    navigate('/servers');
  };

  return (
    <AppShell>
      <Link
        to="/servers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-textMuted transition-colors hover:text-textMain"
      >
        <ArrowLeft className="h-4 w-4" /> {t('serverPage.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-textMain">{server.name}</h1>
            <StatusBadge status={server.status} />
          </div>
          <p className="mt-1 text-sm text-textMuted">
            {server.map} · {t('serverPage.identity')}{' '}
            <span className="font-mono text-textMain">{server.identity}</span> ·{' '}
            {t('serverPage.port', { port: server.port })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setConfirmUpdate(true)}
            loading={updateState?.running}
            disabled={updateState?.running}
          >
            <Download className="h-4 w-4" /> {t('serverPage.updateServer')}
          </Button>
          {!isOnline ? (
            <Button
              variant="success"
              onClick={() => setConfirm('start')}
              loading={server.status === 'starting'}
              disabled={transitioning}
            >
              <Play className="h-4 w-4" /> {t('serverPage.start')}
            </Button>
          ) : (
            <>
              <Button
                variant="danger"
                onClick={() => setConfirm('stop')}
                loading={server.status === 'stopping'}
                disabled={transitioning}
              >
                <Square className="h-4 w-4" /> {t('serverPage.stop')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm('restart')}>
                <RotateCw className="h-4 w-4" /> {t('serverPage.restart')}
              </Button>
            </>
          )}
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" /> {t('serverPage.deleteServer')}
          </Button>
        </div>
      </div>

      {server.status === 'sim' && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-300">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div>{t('serverPage.simMode')}</div>
            {server.lastError && (
              <div className="font-mono text-xs text-violet-300/80">{server.lastError}</div>
            )}
          </div>
        </div>
      )}
      {server.status === 'online' && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div>{t('serverPage.runningInfo')}</div>
            <div className="font-mono text-xs text-emerald-300/80">
              {server.installPath && (
                <span className="mr-3">
                  {t('serverPage.exePath', { path: server.installPath })}
                </span>
              )}
              {server.externalPid && (
                <span className="mr-3">
                  {t('serverPage.externalDetected', { pid: server.externalPid })}
                </span>
              )}
              {(server.autoRestartOnCrash !== false || server.autoRestartOnHang) && (
                <span className="mr-3">
                  {t('serverPage.watchdogInfo', {
                    crash: server.autoRestartOnCrash !== false ? t('serverPage.on') : t('serverPage.off'),
                    hang: server.autoRestartOnHang ? t('serverPage.on') : t('serverPage.off'),
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {server.lastError && server.status === 'crashed' && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{server.lastError}</span>
        </div>
      )}

      {/* Прогресс обновления сервера */}
      {updateState && (
        <div className="mb-6 rounded-xl border border-[#232833] bg-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className={cn('truncate', updateState.error ? 'text-red-400' : 'text-textMuted')}>
              {updateState.error
                ? t('serverPage.updateError', { error: updateState.error })
                : updateState.message}
            </span>
            {typeof updateState.pct === 'number' && (
              <span className="shrink-0 font-semibold text-textMain">
                {Math.round(updateState.pct)}%
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1a1e26]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                updateState.error ? 'bg-red-500' : 'bg-accent'
              )}
              style={{ width: `${updateState.pct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Живые метрики */}
      <ServerMetrics serverId={server.id} />

      {/* Посещаемость за период (история из main-процесса) */}
      <div className="mb-6">
        <AnalyticsSection server={server} />
      </div>

      {/* Вкладки */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-[#232833]">
        {TABS.map(({ id: tabId, labelKey, Icon }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === tabId
                ? 'border-accent text-accent'
                : 'border-transparent text-textMuted hover:text-textMain'
            )}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <GeneralTab server={server} onSave={(patch) => updateServer(server.id, patch)} />
      )}
      {tab === 'console' && <ConsoleTab server={server} />}
      {tab === 'map' && <MapTab server={server} />}
      {tab === 'players' && <PlayersTab server={server} />}
      {tab === 'plugins' && <PluginsTab server={server} />}
      {tab === 'mods' && <ModsTab server={server} />}
      {tab === 'wipes' && (
        <WipesTab server={server} onSeedChange={(seed) => updateServer(server.id, { seed })} />
      )}
      {tab === 'schedule' && <ScheduleTab server={server} />}
      {tab === 'logs' && <LogsTab server={server} />}
      {tab === 'ports' && <PortsTab server={server} />}
      {tab === 'telegram' && <TelegramTab server={server} />}
      {tab === 'discord' && <DiscordTab server={server} />}
      {tab === 'marketplace' && <MarketplaceTab server={server} />}

      <ConfirmModal
        open={confirm !== null}
        title={
          confirm === 'stop'
            ? t('confirm.stopTitle')
            : confirm === 'restart'
              ? t('confirm.restartTitle')
              : t('confirm.startTitle')
        }
        message={confirmMessage}
        confirmLabel={
          confirm === 'stop'
            ? t('confirm.stopConfirm')
            : confirm === 'restart'
              ? t('confirm.restartConfirm')
              : t('confirm.startConfirm')
        }
        onCancel={() => setConfirm(null)}
        onConfirm={runAction}
      />

      <ConfirmModal
        open={confirmUpdate}
        title={t('serverPage.updateConfirmTitle')}
        message={t('serverPage.updateConfirmMessage', {
          name: server.name,
          path: server.installPath || '…',
        })}
        confirmLabel={t('serverPage.startUpdate')}
        onCancel={() => setConfirmUpdate(false)}
        onConfirm={handleUpdateServer}
      />

      <ConfirmModal
        open={confirmDelete}
        title={t('confirm.deleteServerTitle')}
        message={t('confirm.deleteServerMessage', { name: server.name })}
        confirmLabel={t('confirm.deleteServerConfirm')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDeleteServer}
      />
    </AppShell>
  );
}

/** Блок живых метрик сервера (игроки, FPS, CPU, RAM). */
function ServerMetrics({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const metrics = useMetrics();
  const history = useMetricHistory(serverId);
  const sample = metrics[serverId];

  const playersMax = sample?.maxPlayers ?? 100;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricsChart
        label={t('serverPage.metrics.players')}
        value={`${sample?.onlinePlayers ?? 0} / ${playersMax}`}
        data={history.map((h) => h.onlinePlayers)}
        max={playersMax}
        color="#34d399"
      />
      <MetricsChart
        label={t('serverPage.metrics.fps')}
        value={String(sample?.fps ?? 0)}
        data={history.map((h) => h.fps)}
        max={120}
        color="#38bdf8"
      />
      <MetricsChart
        label={t('serverPage.metrics.cpu')}
        value={`${sample?.cpu ?? 0}%`}
        data={history.map((h) => h.cpu)}
        color="#e05638"
      />
      <MetricsChart
        label={t('serverPage.metrics.ram')}
        value={sample ? `${sample.memoryMb} MB` : '—'}
        data={history.map((h) => h.memoryMb)}
        color="#a78bfa"
      />
    </div>
  );
}
