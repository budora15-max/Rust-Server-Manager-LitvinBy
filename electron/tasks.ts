import * as fs from 'fs';
import * as path from 'path';
import type {
  BackupScheduleInput,
  RestartScheduleInput,
  ScheduledTask,
} from './types';

export interface TaskActions {
  onRestart: (task: ScheduledTask) => void;
  onWarning: (task: ScheduledTask) => void;
  onBackup: (task: ScheduledTask) => void;
  onUnban: (task: ScheduledTask) => void;
}

export function nextDailyAt(time: string, from: Date): Date {
  const [h, m] = parseHhMm(time);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export function nextWeeklyAt(weekday: number, time: string, from: Date): Date {
  const base = nextDailyAt(time, from);
  const day = (base.getDay() + 6) % 7; // 0=Пн
  const target = (weekday + 6) % 7;
  let delta = target - day;
  if (delta <= 0) delta += 7;
  base.setDate(base.getDate() + delta);
  return base;
}

function parseHhMm(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return [0, 0];
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return [h, mi];
}

export function nextRunFor(task: ScheduledTask, from: Date): Date {
  if (task.type === 'restart') return nextDailyAt(task.time || '00:00', from);
  if (task.type === 'backup') {
    if (task.frequency === 'hourly') {
      const hours = Math.max(1, task.everyHours || 6);
      return new Date(from.getTime() + hours * 3_600_000);
    }
    if (task.frequency === 'weekly') {
      return nextWeeklyAt(task.weekday ?? 0, task.timeOfDay || '00:00', from);
    }
    return nextDailyAt(task.timeOfDay || '00:00', from);
  }
  return new Date(from);
}

export class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    private readonly actions: TaskActions,
    private readonly tickMs = 15_000
  ) {}

  list(): ScheduledTask[] {
    return [...this.tasks];
  }

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ScheduledTask[];
      this.tasks = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.tasks = [];
    }
    const now = Date.now();
    this.tasks = this.tasks.filter((t) => {
      if (t.type !== 'restartwarn') return true;
      const due = Date.parse(t.nextRun);
      return Number.isNaN(due) || now - due < 2 * 60_000;
    });
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf8');
    } catch {
    }
  }

  add(task: ScheduledTask): void {
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    this.tasks.push(task);
    this.save();
  }

  remove(id: string): void {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.save();
  }

  addRestart(input: RestartScheduleInput): ScheduledTask[] {
    const now = new Date();
    const restartId = `restart_${input.serverId}_${Date.now()}`;
    const restart: ScheduledTask = {
      id: restartId,
      serverId: input.serverId,
      type: 'restart',
      nextRun: nextDailyAt(input.time, now).toISOString(),
      createdAt: Date.now(),
      server: input.server,
      time: input.time,
      warnMinutes: input.warnMinutes ?? [5, 1],
    };
    this.add(restart);

    const created: ScheduledTask[] = [restart];
    const warnMinutes = input.warnMinutes ?? [];
    const messages = input.warnMessages ?? [];
    warnMinutes.forEach((min, i) => {
      const warnAt = Date.parse(restart.nextRun) - min * 60_000;
      if (warnAt <= Date.now()) return; // слишком поздно — предупреждение пропускаем
      const warn: ScheduledTask = {
        id: `${restartId}_warn${min}`,
        serverId: input.serverId,
        type: 'restartwarn',
        nextRun: new Date(warnAt).toISOString(),
        createdAt: Date.now(),
        server: input.server,
        warnMinutes: [min],
        warnMessage: messages[i] ?? `Server restarts in ${min} minutes`,
      };
      this.add(warn);
      created.push(warn);
    });
    return created;
  }

  addBackup(input: BackupScheduleInput): ScheduledTask {
    const task: ScheduledTask = {
      id: `backup_${input.serverId}_${Date.now()}`,
      serverId: input.serverId,
      type: 'backup',
      nextRun: nextRunFor(
        { ...input, type: 'backup', id: '', createdAt: 0 } as ScheduledTask,
        new Date()
      ).toISOString(),
      createdAt: Date.now(),
      server: input.server,
      frequency: input.frequency,
      everyHours: input.everyHours,
      weekday: input.weekday,
      timeOfDay: input.timeOfDay,
      retention: input.retention,
      label: input.label,
    };
    this.add(task);
    return task;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    setTimeout(() => this.tick(), 2000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = Date.now();
    for (const task of [...this.tasks]) {
      const due = Date.parse(task.nextRun);
      if (Number.isNaN(due) || due > now) continue;

      if (task.type === 'restart' || task.type === 'backup') {
        task.nextRun = nextRunFor(task, new Date()).toISOString();
        this.save();
        const action = task.type === 'restart' ? this.actions.onRestart : this.actions.onBackup;
        action(task);
        continue;
      }

      this.remove(task.id);
      if (task.type === 'restartwarn') this.actions.onWarning(task);
      else if (task.type === 'unban') this.actions.onUnban(task);
    }
  }
}
