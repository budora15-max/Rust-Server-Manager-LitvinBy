import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MetricSample } from '@/types';
import { useServer } from './ServerContext';

const MAX_POINTS = 24;

type History = Record<string, MetricSample[]>;

const MetricsContext = createContext<History>({});

function pushSample(history: MetricSample[] | undefined, sample: MetricSample): MetricSample[] {
  const next = history ? [...history, sample] : [sample];
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
}

export function MetricsProvider({ children }: { children: ReactNode }) {
  const { servers } = useServer();
  const [history, setHistory] = useState<History>({});
  const serversRef = useRef(servers);

  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.onMetrics) return;
    const unsubscribe = bridge.onMetrics((sample) => {
      setHistory((prev) => ({
        ...prev,
        [sample.serverId]: pushSample(prev[sample.serverId], sample),
      }));
    });
    return unsubscribe;
  }, []);

  // без Electron (браузерное демо) фабрикуем метрики сами, в приложении их шлёт main
  useEffect(() => {
    if (window.rustManager) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setHistory((prev) => {
        let changed = false;
        const next: History = {};
        for (const s of serversRef.current) {
          const arr = prev[s.id];
          const last = arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
          const isOnline = s.status === 'online' || s.status === 'starting' || s.status === 'sim';
          const fresh = last !== undefined && now - last.at < 12_000;

          if (!isOnline) {
            if (arr !== undefined) changed = true;
            continue;
          }
          if (fresh) {
            next[s.id] = arr;
            continue;
          }

          const jitter = (base: number, amp: number) =>
            Math.max(0, Math.round(base + (Math.random() - 0.5) * amp));

          const sample: MetricSample = {
            serverId: s.id,
            onlinePlayers: last ? jitter(last.onlinePlayers, 8) : s.onlinePlayers,
            maxPlayers: s.maxPlayers,
            fps: last ? jitter(last.fps, 10) : 60,
            cpu: last ? jitter(last.cpu, 12) : s.cpu,
            memoryMb: last ? jitter(last.memoryMb, 200) : 0,
            uptimeSeconds: last ? last.uptimeSeconds + 5 : s.uptimeSeconds,
            at: now,
          };
          next[s.id] = pushSample(arr, sample);
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return <MetricsContext.Provider value={history}>{children}</MetricsContext.Provider>;
}

export function useMetrics(): Record<string, MetricSample> {
  const history = useContext(MetricsContext);
  const { servers } = useServer();
  const latest: Record<string, MetricSample> = {};
  for (const [id, arr] of Object.entries(history)) {
    if (arr.length === 0) continue;
    const server = servers.find((s) => s.id === id);
    const live =
      server?.status === 'online' || server?.status === 'starting' || server?.status === 'sim';
    if (!live) continue;
    latest[id] = arr[arr.length - 1];
  }
  return latest;
}

export function useMetricHistory(serverId: string): MetricSample[] {
  return useContext(MetricsContext)[serverId] ?? [];
}
