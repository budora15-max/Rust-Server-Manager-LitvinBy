import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ServerStatus } from '@/types';
import { cn } from '@/lib/utils';

const CONFIG: Record<
  ServerStatus,
  { className: string; Icon: typeof CheckCircle2 }
> = {
  online: {
    Icon: CheckCircle2,
    className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  offline: {
    Icon: XCircle,
    className: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
  },
  crashed: {
    Icon: AlertTriangle,
    className: 'text-red-400 bg-red-500/10 border-red-500/30',
  },
  starting: {
    Icon: Loader2,
    className: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  stopping: {
    Icon: Loader2,
    className: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  sim: {
    Icon: FlaskConical,
    className: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
  },
};

export function StatusBadge({ status }: { status: ServerStatus }) {
  const { t } = useTranslation();
  const { className, Icon } = CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        className
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5', (status === 'starting' || status === 'stopping') && 'animate-spin')}
      />
      {t(`status.${status}`)}
    </span>
  );
}

