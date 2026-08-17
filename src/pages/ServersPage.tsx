import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Cpu, MemoryStick, Play, Square, Trash2, Users } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useServer } from '@/context/ServerContext';
import { cn } from '@/lib/utils';

interface PendingAction {
  id: string;
  action: 'stop' | 'restart';
}

export default function ServersPage() {
  const { servers, startServer, stopServer, restartServer, removeServer } = useServer();
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const target = pending ? servers.find((s) => s.id === pending.id) : undefined;
  const deleteTarget = deleteId ? servers.find((s) => s.id === deleteId) : undefined;

  const runAction = () => {
    if (!pending || !target) return;
    if (pending.action === 'stop') stopServer(target.id);
    else restartServer(target.id);
    setPending(null);
  };

  const handleDelete = () => {
    if (deleteId) removeServer(deleteId);
    setDeleteId(null);
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-textMain">{t('servers.title')}</h1>
        <p className="mt-0.5 text-sm text-textMuted">{t('servers.subtitle')}</p>
      </div>

      {servers.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#2a2f3a] bg-surface/50 p-12 text-center text-sm text-textMuted">
          {t('dashboard.noServers')}
        </div>
      )}

      {servers.length > 0 && (
      <div className="overflow-hidden rounded-xl border border-[#232833] bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#232833] bg-[#1a1e26] text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium">{t('servers.server')}</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">{t('servers.status')}</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">{t('servers.players')}</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">{t('servers.cpuRam')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('servers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const transitioning = server.status === 'starting' || server.status === 'stopping';
              const isOnline = server.status === 'online' || server.status === 'sim';
              const playersPct =
                server.maxPlayers > 0
                  ? Math.round((server.onlinePlayers / server.maxPlayers) * 100)
                  : 0;

              return (
                <tr
                  key={server.id}
                  className="border-b border-[#1c2028] transition-colors last:border-b-0 hover:bg-[#1a1e26]"
                >
                  <td className="px-4 py-3.5">
                    <Link
                      to={`/servers/${server.id}`}
                      className="block font-semibold text-textMain transition-colors hover:text-accent"
                    >
                      {server.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {server.identity} · {t('servers.port', { port: server.port })}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3.5 md:table-cell">
                    <StatusBadge status={server.status} />
                  </td>
                  <td className="hidden px-4 py-3.5 md:table-cell">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-textMuted" />
                      <div className="w-24">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-textMain">{server.onlinePlayers}</span>
                          <span className="text-textMuted">{server.maxPlayers}</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#1a1e26]">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                            )}
                            style={{ width: `${playersPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3.5 lg:table-cell">
                    <span className="flex items-center gap-1.5 text-textMuted">
                      <Cpu className="h-3.5 w-3.5" /> {server.cpu}%
                      <MemoryStick className="ml-3 h-3.5 w-3.5" /> {server.ram}%
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      {!isOnline ? (
                        <Button
                          size="sm"
                          variant="success"
                          disabled={transitioning}
                          loading={server.status === 'starting'}
                          onClick={() => startServer(server.id)}
                        >
                          <Play className="h-3.5 w-3.5" /> {t('servers.start')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={transitioning}
                          loading={server.status === 'stopping'}
                          onClick={() => setPending({ id: server.id, action: 'stop' })}
                        >
                          <Square className="h-3.5 w-3.5" /> {t('servers.stop')}
                        </Button>
                      )}
                      {isOnline && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPending({ id: server.id, action: 'restart' })}
                        >
                          {t('servers.restart')}
                        </Button>
                      )}
                      <Link
                        to={`/servers/${server.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-textMuted transition-colors hover:bg-accent/10 hover:text-accent"
                        title={t('dashboard.manage')}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => setDeleteId(server.id)}
                        title={t('servers.delete')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-textMuted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <ConfirmModal
        open={pending !== null}
        title={pending?.action === 'stop' ? t('confirm.stopTitle') : t('confirm.restartTitle')}
        message={
          pending?.action === 'stop'
            ? t('confirm.stopMessage', { name: target?.name })
            : t('confirm.restartMessage', { name: target?.name })
        }
        confirmLabel={
          pending?.action === 'stop' ? t('confirm.stopConfirm') : t('confirm.restartConfirm')
        }
        onCancel={() => setPending(null)}
        onConfirm={runAction}
      />

      <ConfirmModal
        open={deleteId !== null}
        title={t('confirm.deleteServerTitle')}
        message={t('confirm.deleteServerMessage', { name: deleteTarget?.name })}
        confirmLabel={t('confirm.deleteServerConfirm')}
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </AppShell>
  );
}
