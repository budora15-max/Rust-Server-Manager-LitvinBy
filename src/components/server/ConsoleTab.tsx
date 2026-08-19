import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, Link2, Link2Off, Plus, Send, Terminal, Zap } from 'lucide-react';
import type { RconLineEvent, RustServer } from '@/types';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

type ConnState = 'idle' | 'connecting' | 'connected' | 'error';

const MAX_LINES = 500;

export function ConsoleTab({ server }: { server: RustServer }) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [host, setHost] = useState(server.rconHost || '127.0.0.1');
  const [port, setPort] = useState(String(server.rconPort || server.port + 2));
  const [password, setPassword] = useState(server.rconPassword);
  const [conn, setConn] = useState<ConnState>('idle');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<string[]>([
    '[--:--:--] [RCON] ' + t('console.title'),
    '[--:--:--] [RCON] ' + t('console.placeholder'),
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<ConnState>('idle');

  const QUICK_KEY = 'rsm.quickCommands';
  const [quick, setQuick] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(QUICK_KEY) ?? '[]') as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [quickInput, setQuickInput] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(QUICK_KEY, JSON.stringify(quick));
    } catch {
    }
  }, [quick]);

  useEffect(() => {
    connRef.current = conn;
  }, [conn]);

  useEffect(() => {
    setPassword(server.rconPassword);
  }, [server.rconPassword]);

  const append = (line: string) => {
    setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line]);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (!bridge?.onRconLine) return;
    const unsubscribe = bridge.onRconLine((event: RconLineEvent) => {
      if (event.serverId !== server.id) return;
      if (connRef.current !== 'connected') return;
      if (event.kind === 'console') return;
      const tag =
        event.kind === 'chat'
          ? '[Chat]'
          : event.kind === 'system'
            ? '[RCON]'
            : event.kind === 'response'
              ? '[Rsp]'
              : '';
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), `${event.ts} ${tag} ${event.line}`]);
    });
    return unsubscribe;
  }, [bridge, server.id]);

  const serverRunning = server.status === 'online' || server.status === 'starting';

  useEffect(() => {
    if (!serverRunning) {
      setLines((prev) => {
        const without = prev.filter((l) => !l.startsWith('[Server]'));
        if (without.some((l) => l.startsWith('[--:--:--] [System]'))) return without;
        return [...without, `[--:--:--] [System] ${t('console.serverNotRunning')}`];
      });
      return;
    }
    if (!bridge?.serverLogTail) return;
    setLines((prev) => prev.filter((l) => !l.startsWith('[--:--:--] [System]')));

    let cancelled = false;
    let offset = 0;
    let first = true;
    const load = async () => {
      try {
        const res = await bridge.serverLogTail(
          server,
          offset,
          first ? { sessionStart: true } : undefined
        );
        if (cancelled) return;
        first = false;
        offset = res.offset;
        if (res.lines.length > 0) {
          const incoming = res.lines.map((l) => `[Server] ${l}`);
          setLines((prev) => [...prev, ...incoming].slice(-MAX_LINES));
        }
      } catch {
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bridge, server.id, server.installPath, server.identity, serverRunning]);

  const translateConnectError = (raw: string): string => {
    const s = raw.toLowerCase();
    const insecure = ` ${t('console.errorInsecurePasswordHint')}`;
    if (/ecoonnrefused|connection refused|connect refused/.test(s)) {
      return t('console.errorRefused') + insecure;
    }
    if (/non-websocket|parse error|expected http|unexpected server response/i.test(raw)) {
      return t('console.errorNonWebsocket') + insecure;
    }
    if (/auth/i.test(s)) {
      return t('console.errorAuth') + insecure;
    }
    if (/timeout/i.test(s)) {
      return t('console.errorTimeout') + insecure;
    }
    return raw;
  };

  const handleConnect = async () => {
    if (!bridge) {
      setError(t('console.bridgeError'));
      return;
    }
    setConn('connecting');
    setError('');
    try {
      const res = await bridge.rconConnect({
        serverId: server.id,
        host: host.trim() || '127.0.0.1',
        port: Number(port) || server.port + 2,
        password,
      });
      if (res.ok) {
        setConn('connected');
        append(t('console.connectedTo', { host, port }));
      } else {
        setConn('error');
        setError(res.error ? translateConnectError(res.error) : t('console.errorGeneric'));
      }
    } catch (e) {
      setConn('error');
      setError(translateConnectError(e instanceof Error ? e.message : String(e)));
    }
  };

  const handleDisconnect = async () => {
    await bridge?.rconDisconnect(server.id);
    setConn('idle');
    append(t('console.disconnected'));
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    await runCommand(cmd);
  };

  const runCommand = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    const ts = new Date().toLocaleTimeString('en-GB');

    if (bridge && connRef.current === 'connected') {
      const res = await bridge.rconSend(server.id, cmd);
      if (!res.ok) append(t('console.commandNotSent', { error: res.error ?? '?' }));
      return;
    }

    append(`${ts} [RCON] > ${cmd}`);
    if (bridge) {
      append(
        serverRunning
          ? `${ts} [RCON] ${t('console.notConnectedHonest')}`
          : `${ts} [RCON] ${t('console.serverStoppedCmd')}`
      );
      return;
    }

    const reply =
      cmd.toLowerCase() === 'status'
        ? t('console.statusReply', {
            name: server.name,
            current: server.onlinePlayers,
            max: server.maxPlayers,
            map: server.map,
            seed: server.seed,
          })
        : t('console.demoReply');
    append(`${ts} ${reply}`);
  };

  const addQuick = () => {
    const cmd = quickInput.trim();
    if (!cmd) return;
    setQuick((prev) => (prev.includes(cmd) ? prev : [...prev, cmd].slice(-12)));
    setQuickInput('');
  };

  const removeQuick = (cmd: string) => setQuick((prev) => prev.filter((c) => c !== cmd));

  const lineClass = (line: string) =>
    line.includes('[Server:err]')
      ? 'text-red-400/90'
      : line.includes('[RCON]')
        ? 'text-amber-400/90'
        : line.includes('[Chat]')
          ? 'text-sky-400/90'
          : line.includes('[Rsp]')
            ? 'text-violet-400/90'
            : 'text-emerald-400/80';

  return (
    <div>
      {/* Панель подключения */}
      <div className="rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className="mb-1.5 block text-sm font-medium text-textMain">{t('console.host')}</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="127.0.0.1"
              className="h-10 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </div>
          <div className="w-32">
            <label className="mb-1.5 block text-sm font-medium text-textMain">{t('console.port')}</label>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="28017"
              className="h-10 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </div>
          <div className="w-48">
            <label className="mb-1.5 block text-sm font-medium text-textMain">{t('console.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="rcon.password"
              className="h-10 w-full rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3 text-sm text-textMain focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </div>
          <div className="flex items-end">
            {conn !== 'connected' ? (
              <Button onClick={handleConnect} loading={conn === 'connecting'} disabled={conn === 'connecting'}>
                <Link2 className="h-4 w-4" /> {t('console.connect')}
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleDisconnect}>
                <Link2Off className="h-4 w-4" /> {t('console.disconnect')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-1 text-xs text-textMuted">
          <p>{t('console.processLogHint')}</p>
          <p>{t('console.connectHint')}</p>
        </div>

        {!bridge && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            {t('console.browserDemo')}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Быстрые команды (избранное) */}
      <div className="mt-4 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <Zap className="h-4 w-4 text-accent" /> {t('console.quickCommands')}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {quick.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-2.5 py-1.5 font-mono text-xs text-textMuted"
            >
              <button onClick={() => void runCommand(c)} className="transition-colors hover:text-accent">
                {c}
              </button>
              <button
                onClick={() => removeQuick(c)}
                title={t('console.removeCommand')}
                className="text-textMuted/50 transition-colors hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <input
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuick();
              }}
              placeholder={t('console.quickPlaceholder')}
              className="h-8 w-44 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-2.5 font-mono text-xs text-textMain placeholder:text-textMuted/50 focus:border-accent focus:outline-none"
            />
            <Button size="sm" variant="secondary" onClick={addQuick}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </span>
        </div>
      </div>

      {/* Консоль */}
      <div className="mt-4 overflow-hidden rounded-xl border border-[#232833] bg-[#0b0d11]">
        <div className="flex items-center justify-between border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-textMain">
            <Terminal className="h-4 w-4 text-accent" /> {t('console.title')}
          </span>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                conn === 'connected'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : conn === 'error'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : conn === 'connecting'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
              )}
            >
              {conn === 'connected'
                ? t('console.connected')
                : conn === 'connecting'
                  ? t('console.connecting')
                  : conn === 'error'
                    ? t('console.error')
                    : t('console.notConnected')}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLines([])}>
              <Eraser className="h-3.5 w-3.5" /> {t('console.clear')}
            </Button>
          </div>
        </div>

        <div className="h-96 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {lines.length === 0 && <p className="text-textMuted">{t('console.consoleCleared')}</p>}
          {lines.map((line, i) => (
            <div key={i} className={cn('whitespace-pre-wrap', lineClass(line))}>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={send}
          className="flex items-center gap-2 border-t border-[#232833] bg-[#1a1e26] p-3"
        >
          <span className="font-mono text-sm font-bold text-accent">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('console.placeholder')}
            className="h-9 flex-1 bg-transparent font-mono text-sm text-textMain placeholder:text-textMuted/60 focus:outline-none"
          />
          <Button type="submit" size="sm">
            <Send className="h-3.5 w-3.5" /> {t('console.send')}
          </Button>
        </form>
      </div>
    </div>
  );
}
