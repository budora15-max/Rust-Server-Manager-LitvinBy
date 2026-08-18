import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryStick } from 'lucide-react';

interface SysMemory {
  totalMb: number;
  usedMb: number;
  freeMb: number;
}

/** Период опроса системной памяти. */
const POLL_MS = 10_000;

/**
 * Панель памяти: RAM сервера (процесс), занято всеми процессами ОС и общий объём.
 * Системные значения приходят из main (os.totalmem/freemem) через IPC.
 */
export function SystemMemoryPanel({ serverMb }: { serverMb: number }) {
  const { t } = useTranslation();
  const [mem, setMem] = useState<SysMemory | null>(null);

  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.systemMemory) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await bridge.systemMemory();
        if (!cancelled) setMem(res);
      } catch {
        /* IPC недоступен — оставляем прежнее значение */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const used = mem?.usedMb ?? 0;
  const total = mem?.totalMb ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const gb = (mb: number): string => t('serverPage.memory.gb', { value: (mb / 1024).toFixed(1) });
  const usedTxt = mem ? gb(used) : '—';
  const totalTxt = mem ? gb(total) : '—';

  return (
    <div className="mb-6 rounded-xl border border-[#232833] bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-textMuted">
          <MemoryStick className="h-3.5 w-3.5" /> {t('serverPage.memory.title')}
        </span>
        <span className="text-xs text-textMuted">
          {mem
            ? t('serverPage.memory.usedOfTotal', { used: usedTxt, total: totalTxt })
            : '—'}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1a1e26]">
        <div
          className="h-full rounded-full bg-[#a78bfa] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <span className="block text-xs text-textMuted">{t('serverPage.memory.server')}</span>
          <span className="text-sm font-bold text-textMain">{serverMb} MB</span>
        </div>
        <div>
          <span className="block text-xs text-textMuted">
            {t('serverPage.memory.systemUsed')}
          </span>
          <span className="text-sm font-bold text-textMain">{usedTxt}</span>
        </div>
        <div>
          <span className="block text-xs text-textMuted">{t('serverPage.memory.total')}</span>
          <span className="text-sm font-bold text-textMain">{totalTxt}</span>
        </div>
      </div>
    </div>
  );
}
