import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, Trash2 } from 'lucide-react';
import type { NotificationEntry } from '@/types';
import { cn } from '@/lib/utils';

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

export function NotificationsBell() {
  const bridge = window.rustManager;
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!bridge) return;
    try {
      setItems(await bridge.notificationsList());
    } catch {
    }
  }, [bridge]);

  useEffect(() => {
    void load();
    if (!bridge?.onNotificationsChanged) return;
    return bridge.onNotificationsChanged(() => void load());
  }, [bridge, load]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications.title')}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#232833] bg-surface text-textMuted transition-colors hover:text-textMain"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-[#232833] bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#232833] bg-[#1a1e26] px-4 py-2.5">
            <span className="text-sm font-semibold text-textMain">{t('notifications.title')}</span>
            <div className="flex items-center gap-1">
              <button
                title={t('notifications.markRead')}
                onClick={() => void bridge?.notificationsMarkAllRead()}
                className="rounded p-1 text-textMuted transition-colors hover:text-textMain"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                title={t('notifications.clear')}
                onClick={() => void bridge?.notificationsClear()}
                className="rounded p-1 text-textMuted transition-colors hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-textMuted">{t('notifications.empty')}</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'border-b border-[#1a1e26] px-4 py-3 last:border-0',
                    !n.read && 'bg-accent/5'
                  )}
                >
                  <p className="text-sm font-semibold text-textMain">{n.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-textMuted">{n.body}</p>
                  <p className="mt-1 text-[10px] text-textMuted/60">
                    {n.serverName ? `${n.serverName} · ` : ''}
                    {fmtTime(n.at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
