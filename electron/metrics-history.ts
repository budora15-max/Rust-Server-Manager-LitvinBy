import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { MetricSample } from './types';

/**
 * Персистентная история метрик: семплы из MetricsCollector сохраняются
 * в userData/metrics/<serverId>.json (не чаще 1 точки в минуту, последние ~30 дней).
 * Рендерер читает её для графиков «посещаемость за день/неделю/месяц».
 */

const DEDUPE_MS = 60_000;
const MAX_POINTS = 30 * 24 * 60; // ~30 дней по 1 точке в минуту

function historyFile(serverId: string): string {
  return path.join(app.getPath('userData'), 'metrics', `${serverId}.json`);
}

export function appendMetric(sample: MetricSample): void {
  try {
    const file = historyFile(sample.serverId);
    let arr: MetricSample[] = [];
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MetricSample[];
        if (Array.isArray(parsed)) arr = parsed;
      } catch {
        arr = [];
      }
    }
    const last = arr.length > 0 ? arr[arr.length - 1] : undefined;
    if (last && sample.at - last.at < DEDUPE_MS) return;
    arr.push(sample);
    if (arr.length > MAX_POINTS) arr = arr.slice(-MAX_POINTS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(arr), 'utf8');
  } catch {
    // запись истории не критична
  }
}

/** Чтение истории метрик сервера (опционально — только за период sinceMs). */
export function readMetricsHistory(serverId: string, sinceMs?: number): MetricSample[] {
  try {
    const file = historyFile(serverId);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MetricSample[];
    if (!Array.isArray(parsed)) return [];
    return sinceMs ? parsed.filter((s) => s.at >= sinceMs) : parsed;
  } catch {
    return [];
  }
}
