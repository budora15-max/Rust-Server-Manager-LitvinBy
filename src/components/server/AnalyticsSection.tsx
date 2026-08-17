import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, Users } from 'lucide-react';
import type { MetricSample, RustServer } from '@/types';
import { MetricsChart } from '@/components/MetricsChart';
import { cn } from '@/lib/utils';

type Period = '24h' | '7d' | '30d';

const PERIODS: Period[] = ['24h', '7d', '30d'];

const PERIOD_MS: Record<Period, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};

interface ChartData {
  labels: string[];
  data: number[];
  max: number;
}

function buildChart(samples: MetricSample[], period: Period, fallbackMax: number): ChartData {
  if (samples.length === 0) return { labels: [], data: [], max: Math.max(1, fallbackMax) };

  if (period === '24h') {
    const buckets = new Map<number, number[]>();
    for (const s of samples) {
      const h = new Date(s.at).getHours();
      if (!buckets.has(h)) buckets.set(h, []);
      buckets.get(h)!.push(s.onlinePlayers);
    }
    const data: number[] = [];
    const labels: string[] = [];
    for (let h = 0; h < 24; h++) {
      const arr = buckets.get(h) ?? [];
      data.push(arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
      labels.push(`${h}:00`);
    }
    return { labels, data, max: Math.max(Math.max(...data), fallbackMax) };
  }

  const days = period === '7d' ? 7 : 30;
  const now = new Date();
  const dayStart = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return d.getTime();
  };
  const data: number[] = [];
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = dayStart(i);
    const end = start + 24 * 3600_000;
    const inDay = samples.filter((s) => s.at >= start && s.at < end);
    const peak = inDay.length ? Math.max(...inDay.map((s) => s.onlinePlayers)) : 0;
    data.push(peak);
    labels.push(new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  return { labels, data, max: Math.max(Math.max(...data), fallbackMax) };
}

/** Посещаемость сервера за период: график онлайн + пик/среднее. */
export function AnalyticsSection({ server }: { server: RustServer }) {
  const bridge = window.rustManager;
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('7d');
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [loading, setLoading] = useState<boolean>(() => !window.rustManager);

  const load = useCallback(
    async (p: Period) => {
      if (!bridge) return;
      try {
        const since = Date.now() - PERIOD_MS[p];
        setSamples((await bridge.metricsHistory(server.id, since)) ?? []);
      } catch {
        setSamples([]);
      } finally {
        setLoading(false);
      }
    },
    [bridge, server.id]
  );

  useEffect(() => {
    setLoading(true);
    void load(period);
  }, [period, load]);

  const chart = useMemo(
    () => buildChart(samples, period, server.maxPlayers),
    [samples, period, server.maxPlayers]
  );

  const peak = chart.data.length ? Math.max(...chart.data) : 0;
  const avg =
    chart.data.length > 0
      ? Math.round(
          chart.data.reduce((a, b) => a + b, 0) / (chart.data.filter((v) => v > 0).length || 1)
        )
      : 0;

  return (
    <div className="rounded-xl border border-[#232833] bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <BarChart3 className="h-4 w-4 text-accent" /> {t('analytics.title')}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#1a1e26] p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                period === p ? 'bg-accent/20 text-accent' : 'text-textMuted hover:text-textMain'
              )}
            >
              {t(`analytics.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-[#1a1e26] p-3">
          <p className="flex items-center gap-1.5 text-xs text-textMuted">
            <TrendingUp className="h-3.5 w-3.5" /> {t('analytics.peak')}
          </p>
          <p className="mt-1 text-lg font-bold text-textMain">{peak}</p>
        </div>
        <div className="rounded-lg bg-[#1a1e26] p-3">
          <p className="flex items-center gap-1.5 text-xs text-textMuted">
            <Users className="h-3.5 w-3.5" /> {t('analytics.average')}
          </p>
          <p className="mt-1 text-lg font-bold text-textMain">{avg}</p>
        </div>
        <div className="rounded-lg bg-[#1a1e26] p-3">
          <p className="flex items-center gap-1.5 text-xs text-textMuted">
            <BarChart3 className="h-3.5 w-3.5" /> {t('analytics.points')}
          </p>
          <p className="mt-1 text-lg font-bold text-textMain">{samples.length}</p>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-textMuted">{t('analytics.loading')}</p>
        ) : samples.length === 0 ? (
          <p className="py-8 text-center text-sm text-textMuted">{t('analytics.noData')}</p>
        ) : (
          <div>
            <MetricsChart
              label={t('analytics.onlineChart', {
                from: chart.labels[0] ?? '',
                to: chart.labels[chart.labels.length - 1] ?? '',
              })}
              value={`${peak} / ${chart.max}`}
              data={chart.data}
              max={chart.max}
              color="#34d399"
            />
            <p className="mt-2 font-mono text-[10px] leading-tight text-textMuted/60">
              {chart.labels.join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

