import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';
import type { SteamUpdateProgress } from '@/types';

export interface UpdatePanelState {
  running: boolean;
  pct?: number;
  stage?: SteamUpdateProgress['stage'];
  message?: string;
  downloadedMb?: number;
  totalMb?: number;
  speedMb?: number;
  etaSeconds?: number;
  log?: string[];
  error?: string;
}

interface UpdateProgressPanelProps {
  state: UpdatePanelState;
  onCancel: () => void;
  onClose: () => void;
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function formatEta(t: TFn, sec: number): string {
  if (sec < 60) return t('serverPage.update.etaSeconds', { value: Math.max(1, sec) });
  if (sec < 3600) return t('serverPage.update.etaMinutes', { value: Math.max(1, Math.round(sec / 60)) });
  return t('serverPage.update.etaHours', { value: Math.max(1, Math.round(sec / 3600)) });
}

export function UpdateProgressPanel({ state, onCancel, onClose }: UpdateProgressPanelProps) {
  const { t } = useTranslation();
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (showLog && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.log, showLog]);

  const stageLabel = (): string => {
    switch (state.stage) {
      case 'checking':
        return t('serverPage.update.stageChecking');
      case 'validating':
        return t('serverPage.update.stageValidating');
      case 'done':
        return t('serverPage.update.stageDone');
      case 'error':
        return t('serverPage.update.stageError');
      default:
        return t('serverPage.update.stageDownloading');
    }
  };

  const pct = state.pct;
  const details: string[] = [];
  if (state.downloadedMb !== undefined && state.totalMb !== undefined) {
    details.push(
      t('serverPage.update.downloaded', { downloaded: state.downloadedMb, total: state.totalMb })
    );
  }
  if (state.speedMb !== undefined) {
    details.push(t('serverPage.update.speed', { speed: state.speedMb }));
  }
  if (state.etaSeconds !== undefined) {
    details.push(formatEta(t, state.etaSeconds));
  }

  return (
    <div className="mb-6 rounded-xl border border-[#232833] bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-textMuted">
          <Download className="h-3.5 w-3.5 text-accent" />
          {t('serverPage.update.title')}
        </span>
        <div className="flex items-center gap-2">
          {state.running && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
          <span
            className={cn(
              'text-xs font-semibold',
              state.stage === 'error'
                ? 'text-red-400'
                : state.stage === 'done'
                  ? 'text-emerald-400'
                  : 'text-textMain'
            )}
          >
            {stageLabel()}
          </span>
          {!state.running && (
            <button
              type="button"
              onClick={onClose}
              title={t('serverPage.update.close')}
              className="text-textMuted transition-colors hover:text-textMain"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {pct !== undefined ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1a1e26]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                state.stage === 'error' ? 'bg-red-500' : 'bg-accent'
              )}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[10px] text-textMuted">{Math.round(pct)}%</div>
        </>
      ) : (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1a1e26]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
        </div>
      )}

      {details.length > 0 && (
        <div className="mt-2 text-xs text-textMuted">{details.join(' · ')}</div>
      )}
      {state.message && (
        <p className="mt-1 truncate text-[11px] text-textMuted/80" title={state.message}>
          {state.message}
        </p>
      )}
      {state.error && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {t('serverPage.updateError', { error: state.error })}
        </p>
      )}

      {state.log && state.log.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-textMuted transition-colors hover:text-textMain"
          >
            {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showLog
              ? t('serverPage.update.hideLog')
              : t('serverPage.update.showLog', { count: state.log.length })}
          </button>
          {showLog && (
            <pre
              ref={logRef}
              className="mt-2 max-h-52 overflow-auto rounded-lg border border-[#232833] bg-[#111318] p-3 text-[10px] leading-relaxed text-textMuted/90"
            >
              {state.log.join('\n')}
            </pre>
          )}
        </div>
      )}

      {state.running && (
        <div className="mt-3">
          <Button size="sm" variant="danger" onClick={onCancel}>
            {t('serverPage.update.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
