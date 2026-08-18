import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { httpGet } from './http';
import type { ServerPayload } from './types';

const IS_WIN = process.platform === 'win32';
const STEAMCMD_URL = IS_WIN
  ? 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
  : 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
const RUST_APP_ID = '258550';

export type UpdateStage = 'checking' | 'downloading' | 'validating' | 'done' | 'error';

/** Событие прогресса обновления: сообщение + разобранные метрики SteamCMD. */
export interface SteamProgressEvent {
  message: string;
  pct?: number;
  stage?: UpdateStage;
  downloadedMb?: number;
  totalMb?: number;
  speedMb?: number;
  etaSeconds?: number;
  /** Последние строки вывода SteamCMD (для панели прогресса). */
  log?: string[];
}

export type UpdateEmitter = (event: SteamProgressEvent) => void;

/** Активный процесс SteamCMD — для отмены обновления. */
let activeUpdateChild: ChildProcess | null = null;

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* процесс уже завершился */
    }
  }
}

/** Отмена текущего обновления: завершает процесс SteamCMD. */
export function cancelUpdate(): void {
  if (activeUpdateChild?.pid) killTree(activeUpdateChild.pid);
}

/** Разбор вывода SteamCMD: этап, проценты, размер загрузки, скорость. */
function parseSteamLine(text: string): SteamProgressEvent {
  const out: SteamProgressEvent = { message: '' };

  const stateMatch = /Update state\s*\(0x([0-9a-fA-F]+)\)/i.exec(text);
  if (stateMatch) {
    const code = stateMatch[1].toLowerCase();
    if (code === '11') out.stage = 'checking';
    else if (code === '61' || code === '71') out.stage = 'downloading';
    else if (code === '81' || code === '91') out.stage = 'validating';
    else if (code === '0') out.stage = 'done';
  } else if (/Checking for update/i.test(text)) {
    out.stage = 'checking';
  } else if (/downloading/i.test(text)) {
    out.stage = 'downloading';
  } else if (/validating/i.test(text)) {
    out.stage = 'validating';
  }

  if (/Success - App '\d+' fully installed/i.test(text)) out.stage = 'done';
  if (/ERROR!|failed/i.test(text) && !out.stage) out.stage = 'error';

  // progress: 45.23 (123456 / 234567) — числа в байтах.
  const prog = /progress:\s*([\d.]+)\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)/i.exec(text);
  if (prog) {
    out.pct = Math.min(100, Math.round(Number(prog[1]) * 10) / 10);
    out.downloadedMb = Math.round(Number(prog[2]) / (1024 * 1024));
    out.totalMb = Math.round(Number(prog[3]) / (1024 * 1024));
  }

  // Downloading update (1234 / 5678 MB, 12.3 MB/s)
  const dl = /Downloading update\s*\(([\d.]+)\s*\/\s*([\d.]+)\s*MB,\s*([\d.]+)\s*MB\/s\)/i.exec(text);
  if (dl) {
    out.downloadedMb = Math.round(Number(dl[1]));
    out.totalMb = Math.round(Number(dl[2]));
    out.speedMb = Math.round(Number(dl[3]) * 10) / 10;
  }

  return out;
}

function steamcmdDir(): string {
  return path.join(app.getPath('userData'), 'steamcmd');
}

function steamcmdExe(): string {
  return path.join(steamcmdDir(), IS_WIN ? 'steamcmd.exe' : 'steamcmd.sh');
}

function extractArchive(archivePath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${dest}' -Force`,
          ],
          { windowsHide: true }
        )
      : spawn('tar', ['-xzf', archivePath, '-C', dest]);
    cmd.on('error', reject);
    cmd.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Archive extraction failed with code ${code}`));
    });
  });
}

/** Гарантирует наличие steamcmd.exe (скачивает и распаковывает при необходимости). */
async function ensureSteamCmd(emit: UpdateEmitter): Promise<string> {
  const exe = steamcmdExe();
  if (fs.existsSync(exe)) return exe;

  const dir = steamcmdDir();
  fs.mkdirSync(dir, { recursive: true });
  emit({ message: 'SteamCMD not found — downloading…', pct: 0, stage: 'downloading' });

  const archivePath = path.join(dir, IS_WIN ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz');
  const res = await httpGet(STEAMCMD_URL);
  if (res.status !== 200) {
    throw new Error(`SteamCMD download failed with HTTP ${res.status}`);
  }
  fs.writeFileSync(archivePath, res.body);
  emit({ message: 'Extracting SteamCMD…', pct: 5, stage: 'downloading' });
  await extractArchive(archivePath, dir);
  fs.unlinkSync(archivePath);
  return steamcmdExe();
}

/**
 * Обновление серверной части Rust через SteamCMD:
 * +force_install_dir <путь> +login anonymous +app_update 258550 validate +quit.
 * Вывод SteamCMD разбирается в события прогресса: этап, проценты, скорость,
 * ETA и живой лог (последние ~150 строк) — для панели прогресса в UI.
 */
export async function updateRustServer(
  server: ServerPayload,
  emit: UpdateEmitter
): Promise<{ ok: boolean; error?: string }> {
  if (!server.installPath) {
    return { ok: false, error: 'Server install path is not configured.' };
  }

  try {
    const exe = await ensureSteamCmd(emit);
    emit({
      message: `Updating Rust (app ${RUST_APP_ID}) in ${server.installPath}…`,
      pct: 5,
      stage: 'checking',
    });

    return await new Promise((resolve) => {
      const child = spawn(
        exe,
        [
          '+force_install_dir',
          server.installPath,
          '+login',
          'anonymous',
          '+app_update',
          RUST_APP_ID,
          ...(server.steamBetaBranch ? ['-beta', server.steamBetaBranch] : []),
          'validate',
          '+quit',
        ],
        { windowsHide: true }
      );
      activeUpdateChild = child;

      const logLines: string[] = [];
      /** Сэмплы (время, скачано МБ) — расчёт скорости, если SteamCMD её не печатает. */
      const samples: Array<{ at: number; mb: number }> = [];
      let last: SteamProgressEvent = { message: '' };

      const pushLog = (text: string): void => {
        logLines.push(text);
        if (logLines.length > 150) logLines.splice(0, logLines.length - 150);
      };

      const onData = (data: Buffer) => {
        const text = String(data).trim();
        if (!text) return;
        pushLog(text);

        const event: SteamProgressEvent = {
          ...last,
          ...parseSteamLine(text),
          message: text.slice(0, 400),
          log: logLines.slice(),
        };

        // Скорость и ETA считаем по разнице сэмплов, если SteamCMD не указал MB/s.
        if (event.downloadedMb !== undefined) {
          samples.push({ at: Date.now(), mb: event.downloadedMb });
          if (samples.length > 6) samples.shift();
          if (event.speedMb === undefined && samples.length >= 2) {
            const a = samples[0];
            const b = samples[samples.length - 1];
            const dt = (b.at - a.at) / 1000;
            if (dt > 0) event.speedMb = Math.max(0, Math.round(((b.mb - a.mb) / dt) * 10) / 10);
          }
          if (event.speedMb && event.totalMb && event.totalMb > event.downloadedMb) {
            event.etaSeconds = Math.round((event.totalMb - event.downloadedMb) / event.speedMb);
          }
        }

        last = event;
        emit(event);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err) => {
        activeUpdateChild = null;
        resolve({ ok: false, error: err.message });
      });
      child.on('close', (code) => {
        activeUpdateChild = null;
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: `SteamCMD exited with code ${code}` });
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
