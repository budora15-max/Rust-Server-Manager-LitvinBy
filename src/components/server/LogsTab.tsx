import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, RefreshCw, Search } from 'lucide-react';
import type { RustServer } from '@/types';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

interface LogsTabProps {
  server: RustServer;
}

type LevelFilter = 'all' | 'error' | 'warn' | 'chat';

function lineClass(line: string): string {
  if (/\[error\]|exception|failed|crash|\[err\]/i.test(line)) return 'text-red-400/90';
  if (/\[warning\]|\[warn\]/i.test(line)) return 'text-amber-400/80';
  if (/\[chat\]/i.test(line)) return 'text-sky-400/80';
  if (/\[manager\]/i.test(line)) return 'text-accent/90';
  return 'text-emerald-400/70';
}

/** Браузер файла лога сервера: поиск, фильтры уровня, автообновление. */
export function LogsTab({ server }: LogsTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [lines, setLines] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      const res = await bridge.serverLogBrowser(server);
      if (res.ok) {
        setLines(res.lines);
        setPath(res.path ?? '');
        setTotal(res.total);
      } else {
        setLines([]);
      }
    } catch {
      setLines([]);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (q && !l.toLowerCase().includes(q)) return false;
      if (filter === 'error' && !/\[error\]|exception|failed|crash|\[err\]/i.test(l)) return false;
      if (filter === 'warn' && !/\[warning\]|\[warn\]/i.test(l)) return false;
      if (filter === 'chat' && !/\[chat\]/i.test(l)) return false;
      return true;
    });
  }, [lines, query, filter]);

  const filterOptions: Array<{ id: LevelFilter; labelKey: string }> = [
    { id: 'all', labelKey: 'logs.all' },
    { id: 'error', labelKey: 'logs.errors' },
    { id: 'warn', labelKey: 'logs.warnings' },
    { id: 'chat', labelKey: 'logs.chat' },
  ];

  return (
    <div>
      {/* Панель управления */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#232833] bg-surface p-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-textMain">
          <FileText className="h-4 w-4 shrink-0 text-accent" /> {t('logs.title')}
          {total !== undefined && (
            <span className="rounded-full bg-[#1a1e26] px-2 py-0.5 text-xs text-textMuted">
              {total}
            </span>
          )}
        </div>
        <div className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-3">
          <Search className="h-4 w-4 shrink-0 text-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            className="h-9 w-full bg-transparent text-sm text-textMain placeholder:text-textMuted/60 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#1a1e26] p-1">
          {filterOptions.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === f.id ? 'bg-accent/20 text-accent' : 'text-textMuted hover:text-textMain'
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-textMuted">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          {t('logs.autoRefresh')}
        </label>
        <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('logs.refresh')}
        </Button>
      </div>

      {!bridge && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          {t('logs.browserDemo')}
        </p>
      )}

      {path && <p className="mt-2 truncate font-mono text-xs text-textMuted/60">{path}</p>}

      {/* Лог */}
      <div className="mt-3 overflow-hidden rounded-xl border border-[#232833] bg-[#0b0d11]">
        <div className="h-[28rem] overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {filtered.length === 0 ? (
            <p className="py-16 text-center text-textMuted">
              {lines.length === 0 ? t('logs.empty') : t('logs.noMatch')}
            </p>
          ) : (
            filtered.map((l, i) => (
              <div key={i} className={cn('whitespace-pre-wrap', lineClass(l))}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
