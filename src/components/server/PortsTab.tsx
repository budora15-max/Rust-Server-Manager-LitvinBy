import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, RefreshCw, Search, Shield, Unlock, Wifi } from 'lucide-react';
import type { FirewallRuleStatus, PortStatus, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

interface Row extends PortStatus {
  fw?: FirewallRuleStatus;
  fwLoading: boolean;
  probe: 'idle' | 'loading' | 'ok' | 'fail';
  probeDetail?: string;
}

interface PortsTabProps {
  server: RustServer;
}

export function PortsTab({ server }: PortsTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [auto, setAuto] = useState(false);

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
    setLoading(true);
    setError('');
    try {
      const ports = (await bridge.portsCheck(server)) ?? [];
      const enriched = await Promise.all(
        ports.map(async (p): Promise<Row> => {
          let fw: FirewallRuleStatus | undefined;
          try {
            fw = await bridge.portsFirewallStatus(server, p.port, p.protocol);
          } catch {
            fw = undefined;
          }
          return { ...p, fw, fwLoading: false, probe: 'idle' };
        })
      );
      setRows(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge, server]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [auto, load]);

  const toggleFirewall = async (row: Row, action: 'open' | 'close') => {
    if (!bridge) return;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, fwLoading: true } : r)));
    try {
      const fw =
        action === 'open'
          ? await bridge.portsFirewallOpen(server, row.port, row.protocol)
          : await bridge.portsFirewallClose(server, row.port, row.protocol);
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, fw, fwLoading: false } : r)));
      flash(fw.error ?? t('ports.firewallDone'));
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), true);
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, fwLoading: false } : r)));
    }
  };

  const probe = async (row: Row) => {
    if (!bridge || row.protocol !== 'TCP') return;
    const host = server.rconHost || '127.0.0.1';
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, probe: 'loading' } : r)));
    try {
      const res = await bridge.portsProbeExternal(host, row.port);
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? { ...r, probe: res.ok && res.reachable ? 'ok' : 'fail', probeDetail: res.error }
            : r
        )
      );
    } catch (e) {
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key ? { ...r, probe: 'fail', probeDetail: String(e) } : r
        )
      );
    }
  };

  const stateBadge = (row: Row) => {
    if (row.state === 'managed') {
      return (
        <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-400">
          {t('ports.stateManaged')}
        </span>
      );
    }
    if (row.state === 'used') {
      return (
        <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-400">
          {t('ports.stateUsed', { pid: row.pid ?? '?', process: row.process ?? '?' })}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
        {t('ports.stateFree')}
      </span>
    );
  };

  const firewallBadge = (row: Row) => {
    if (row.fwLoading) return <span className="text-xs text-textMuted">{t('ports.checking')}</span>;
    if (!row.fw) return <span className="text-xs text-textMuted">—</span>;
    if (row.fw.error) return <span className="text-xs text-amber-400">{t('ports.fwError')}</span>;
    if (row.fw.exists && row.fw.enabled)
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
          <Unlock className="mr-1 h-3 w-3" /> {t('ports.fwOpen')}
        </span>
      );
    if (row.fw.exists)
      return (
        <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
          <Lock className="mr-1 h-3 w-3" /> {t('ports.fwDisabled')}
        </span>
      );
    return <span className="text-xs text-textMuted">{t('ports.fwNone')}</span>;
  };

  if (!bridge) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
        {t('ports.browserDemo')}
      </p>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Панель управления */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <Wifi className="h-4 w-4 text-accent" /> {t('ports.title')}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-textMuted">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            {t('ports.autoRefresh')}
          </label>
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('ports.refresh')}
          </Button>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-textMuted">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        {t('ports.hint')}
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

      {/* Таблица портов */}
      <div className="mt-4 overflow-hidden rounded-xl border border-[#232833] bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#232833] text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-2.5 font-medium">{t('ports.port')}</th>
              <th className="px-4 py-2.5 font-medium">{t('ports.localStatus')}</th>
              <th className="px-4 py-2.5 font-medium">{t('ports.firewall')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('ports.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-textMuted">
                  {t('ports.checking')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="border-b border-[#1a1e26] last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-textMain">
                      {t(`ports.portLabels.${row.key}`)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-textMuted">
                      {row.port} / {row.protocol}
                    </p>
                  </td>
                  <td className="px-4 py-3">{stateBadge(row)}</td>
                  <td className="px-4 py-3">{firewallBadge(row)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {row.probe !== 'idle' && (
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            row.probe === 'ok'
                              ? 'text-emerald-400'
                              : row.probe === 'loading'
                                ? 'text-textMuted'
                                : 'text-red-400'
                          )}
                        >
                          {row.probe === 'ok'
                            ? t('ports.probeOk')
                            : row.probe === 'loading'
                              ? '…'
                              : row.probeDetail || t('ports.probeFail')}
                        </span>
                      )}
                      {row.protocol === 'TCP' && (
                        <Button size="sm" variant="ghost" onClick={() => void probe(row)}>
                          <Search className="h-3.5 w-3.5" /> {t('ports.probe')}
                        </Button>
                      )}
                      {row.fw?.exists && row.fw.enabled ? (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={row.fwLoading}
                          onClick={() => void toggleFirewall(row, 'close')}
                        >
                          <Lock className="h-3.5 w-3.5" /> {t('ports.close')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          loading={row.fwLoading}
                          onClick={() => void toggleFirewall(row, 'open')}
                        >
                          <Unlock className="h-3.5 w-3.5" /> {t('ports.open')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
