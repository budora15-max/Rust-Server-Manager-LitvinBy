import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface MetricsChartProps {
  label: string;
  value: string;
  data: number[];
  color?: string;
  max?: number;
  className?: string;
}

/** Мини-график (SVG-спарклайн) для метрик сервера. */
export function MetricsChart({
  label,
  value,
  data,
  color = '#e05638',
  max = 100,
  className,
}: MetricsChartProps) {
  const { t } = useTranslation();
  const width = 100;
  const height = 32;
  const lastPoints = data.slice(-24);

  const points = lastPoints
    .map((v, i) => {
      const x = (i / Math.max(1, lastPoints.length - 1)) * width;
      const y = height - (Math.min(max, Math.max(0, v)) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className={cn('rounded-xl border border-[#232833] bg-surface p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-textMuted">{label}</span>
        <span className="shrink-0 text-sm font-bold text-textMain">{value}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 h-8 w-full"
        preserveAspectRatio="none"
      >
        {lastPoints.length > 1 ? (
          <>
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity="0.9"
            />
            <polygon
              points={`0,${height} ${points} ${width},${height}`}
              fill={color}
              opacity="0.12"
            />
          </>
        ) : (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="#9ca3af"
            fontSize="6"
          >
            {t('metrics.waiting')}
          </text>
        )}
      </svg>
    </div>
  );
}

