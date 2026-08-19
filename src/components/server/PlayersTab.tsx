import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Clock, Link2, Link2Off, RefreshCw, ShieldBan, Users } from 'lucide-react';
import type { RconBannedPlayer, RconPlayer, RustServer, ScheduledTask } from '@/types';
import { Button } from '@/components/Button';

interface PlayersTabProps {
  server: RustServer;
}

type ActionState = {
  type: 'kick' | 'ban' | 'unban';
  target: string;
  name: string;
} | null;

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}min`;
}

function shortId(id: string): string {
  if (!id) return '';
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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

export function PlayersTab({ server }: PlayersTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<RconPlayer[]>([]);
  const [banned, setBanned] = useState<RconBannedPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<ActionState>(null);
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [tempBans, setTempBans] = useState<ScheduledTask[]>([]);

  const flash = (text: string, isError = false) => {
    if (isError) setError(text);
    else setNotice(text);
    setTimeout(() => {
      setError('');
      setNotice('');
    }, 5000);
  };

  const loadTempBans = useCallback(async () => {
    if (!bridge) return;
    try {
      const list = await bridge.tasksList();
      setTempBans((list ?? []).filter((t) => t.serverId === server.id && t.type === 'unban'));
    } catch {
    }
  }, [bridge, server.id]);

  useEffect(() => {
    setDurationMinutes(0);
  }, [action]);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    setError('');
    try {
      const [p, b] = await Promise.all([
        bridge.rconPlayerlist(server.id),
        bridge.rconBannedlist(server.id),
      ]);
      if (p.ok) setPlayers(p.players ?? []);
      if (b.ok) setBanned(b.players ?? []);
      if (!p.ok) flash(p.error ?? 'playerlist error', true);
      if (!b.ok) flash(b.error ?? 'banned error', true);
    } catch (e) {
      flash(t('players.loadFailed', { error: e instanceof Error ? e.message : String(e) }), true);
    } finally {
      setLoading(false);
    }
  }, [bridge, server.id]);

  const doConnect = async () => {
    if (!bridge) return;
    setConnecting(true);
    setError('');
    try {
      const res = await bridge.rconConnect({
        serverId: server.id,
        host: server.rconHost || '127.0.0.1',
        port: server.rconPort || server.port + 2,
        password: server.rconPassword,
      });
      if (res.ok) {
        setConnected(true);
        void refresh();
      } else {
        flash(res.error ?? t('players.connectFailed'), true);
      }
    } catch (e) {
      flash(t('players.loadFailed', { error: e instanceof Error ? e.message : String(e) }), true);
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    await bridge?.rconDisconnect(server.id);
    setConnected(false);
    setPlayers([]);
    setBanned([]);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await bridge?.rconStatus();
        if (!cancelled) {
          const isConn = !!status?.[server.id];
          setConnected(isConn);
          if (isConn) void refresh();
        }
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  useEffect(() => {
    void loadTempBans();
  }, [loadTempBans]);

  useEffect(() => {
    if (!bridge?.onTasksChanged) return;
    return bridge.onTasksChanged(() => void loadTempBans());
  }, [bridge, loadTempBans]);

  const runAction = async () => {
    if (!action || !bridge) return;
    try {
      const res = await bridge.rconPlayerAction({
        serverId: server.id,
        action: action.type,
        target: action.target,
        reason: reason.trim() || undefined,
        durationMinutes: action.type === 'ban' && durationMinutes > 0 ? durationMinutes : undefined,
        server: action.type === 'ban' ? server : undefined,
      });
      if (res.ok) {
        if (action.type === 'ban' && res.unbanAt) {
          flash(`${t('players.tempBanScheduled')} ${fmtDate(res.unbanAt)}`);
        } else {
          flash(t('players.actionDone', { cmd: res.message ?? '' }));
        }
        setAction(null);
        setReason('');
        void refresh();
        void loadTempBans();
      } else {
        flash(res.error ?? t('players.actionFailed', { error: 'unknown' }), true);
      }
    } catch (e) {
      flash(t('players.actionFailed', { error: e instanceof Error ? e.message : String(e) }), true);
    }
  };

  const unbanNow = async (tb: ScheduledTask) => {
    if (!bridge || !tb.steamId) return;
    try {
      const res = await bridge.rconPlayerAction({
        serverId: server.id,
        action: 'unban',
        target: tb.steamId,
      });
      if (res.ok) {
        await bridge.tasksRemove(tb.id);
        void loadTempBans();
        flash(t('players.actionDone', { cmd: `unbanid ${tb.steamId}` }));
      } else {
        flash(res.error ?? t('players.actionFailed', { error: 'unknown' }), true);
      }
    } catch (e) {
      flash(t('players.actionFailed', { error: e instanceof Error ? e.message : String(e) }), true);
    }
  };

  if (!bridge) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
        {t('players.browserDemo')}
      </p>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <Users className="h-4 w-4 text-accent" /> {t('players.title')}
          <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
            {players.length}
          </span>
          {connected && (
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              RCON ✓
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void refresh()} loading={loading}>
                <RefreshCw className="h-3.5 w-3.5" /> {t('players.refresh')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void doDisconnect()}>
                <Link2Off className="h-3.5 w-3.5" /> {t('players.disconnect')}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void doConnect()} loading={connecting}>
              <Link2 className="h-3.5 w-3.5" /> {t('players.connect')}
            </Button>
          )}
        </div>
      </div>

      {!connected && (
        <p className="mt-4 rounded-lg border border-dashed border-[#2a2f3a] bg-surface/50 p-6 text-center text-sm text-textMuted">
          {t('players.notConnected')}
        </p>
      )}

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

      {connected && (
        <>
          {/* Игроки онлайн */}
          <div className="mt-5 overflow-hidden rounded-xl border border-[#232833] bg-surface">
            <div className="border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5 text-sm font-semibold text-textMain">
              {t('players.online')}
            </div>
            {players.length === 0 ? (
              <p className="p-6 text-center text-sm text-textMuted">{t('players.empty')}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#232833] text-xs uppercase tracking-wide text-textMuted">
                    <th className="px-4 py-2 font-medium">{t('players.name')}</th>
                    <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('players.steamId')}</th>
                    <th className="px-4 py-2 font-medium">{t('players.ping')}</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">{t('players.time')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('players.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.SteamID} className="border-b border-[#1a1e26] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-textMain">{p.Name}</td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-textMuted sm:table-cell">
                        {shortId(p.SteamID)}
                      </td>
                      <td className="px-4 py-2.5 text-textMuted">{p.Ping}</td>
                      <td className="hidden px-4 py-2.5 text-textMuted md:table-cell">
                        {fmtUptime(p.ConnectedSeconds)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="mr-2 text-xs font-semibold text-amber-400 hover:text-amber-300"
                          onClick={() => setAction({ type: 'kick', target: p.Name, name: p.Name })}
                        >
                          {t('players.kick')}
                        </button>
                        <button
                          className="text-xs font-semibold text-red-400 hover:text-red-300"
                          onClick={() => setAction({ type: 'ban', target: p.SteamID, name: p.Name })}
                        >
                          {t('players.ban')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Бан-лист */}
          <div className="mt-6 overflow-hidden rounded-xl border border-[#232833] bg-surface">
            <div className="flex items-center gap-2 border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5 text-sm font-semibold text-textMain">
              <ShieldBan className="h-4 w-4 text-red-400" /> {t('players.banned')}
              <span className="rounded-full bg-[#0f1115] px-2 py-0.5 text-xs text-textMuted">
                {banned.length}
              </span>
            </div>
            {banned.length === 0 ? (
              <p className="p-6 text-center text-sm text-textMuted">{t('players.bannedEmpty')}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#232833] text-xs uppercase tracking-wide text-textMuted">
                    <th className="px-4 py-2 font-medium">{t('players.name')}</th>
                    <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('players.reason')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('players.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {banned.map((p) => (
                    <tr key={p.SteamID + p.Name} className="border-b border-[#1a1e26] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-textMain">{p.Name}</td>
                      <td className="hidden px-4 py-2.5 text-xs text-textMuted sm:table-cell">
                        {p.Reason || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                          onClick={() => setAction({ type: 'unban', target: p.SteamID, name: p.Name })}
                        >
                          {t('players.unban')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Временные баны (авторазбан через планировщик) */}
          <div className="mt-6 overflow-hidden rounded-xl border border-[#232833] bg-surface">
            <div className="flex items-center gap-2 border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5 text-sm font-semibold text-textMain">
              <Clock className="h-4 w-4 text-amber-400" /> {t('players.tempBans')}
              <span className="rounded-full bg-[#0f1115] px-2 py-0.5 text-xs text-textMuted">
                {tempBans.length}
              </span>
            </div>
            {tempBans.length === 0 ? (
              <p className="p-6 text-center text-sm text-textMuted">{t('players.tempBansEmpty')}</p>
            ) : (
              tempBans.map((tb) => (
                <div
                  key={tb.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1a1e26] px-5 py-3 last:border-0"
                >
                  <div>
                    <p className="font-medium text-textMain">{tb.playerName || tb.steamId}</p>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {t('players.tempBanUntil', { when: fmtDate(tb.nextRun) })}
                      {tb.reason ? ` · ${tb.reason}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="success" onClick={() => void unbanNow(tb)}>
                    <Ban className="h-3.5 w-3.5" /> {t('players.unban')}
                  </Button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Панель подтверждения действия */}
      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#232833] bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
              <Ban className="h-4 w-4 text-red-400" />
              {t(`players.${action.type}Title`, { name: action.name })}
            </div>
            <p className="mt-1 text-sm text-textMuted">
              {t(`players.${action.type}Message`, { name: action.name })}
            </p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('players.reasonPlaceholder')}
              autoFocus
              className="mt-3 h-10 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            {action?.type === 'ban' && (
              <label className="mt-3 block text-sm">
                <span className="font-medium text-textMain">{t('players.banDuration')}</span>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none"
                >
                  <option value={0}>{t('players.banPermanent')}</option>
                  <option value={60}>{t('players.ban1h')}</option>
                  <option value={360}>{t('players.ban6h')}</option>
                  <option value={1440}>{t('players.ban1d')}</option>
                  <option value={10080}>{t('players.ban7d')}</option>
                  <option value={43200}>{t('players.ban30d')}</option>
                </select>
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAction(null)}>
                {t('players.cancel')}
              </Button>
              <Button
                variant={action.type === 'unban' ? 'success' : 'danger'}
                onClick={() => void runAction()}
              >
                {t(`players.${action.type}Confirm`)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
