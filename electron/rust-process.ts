import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { ServerPayload, ServerStartResult, ServerStopResult } from './types';
import { sanitizeServerConfig } from './config';

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

const EXE_NAMES =
  process.platform === 'win32'
    ? ['RustDedicatedServer.exe', 'RustDedicated.exe']
    : ['RustDedicated', 'RustDedicatedServer'];
const EXE_LABEL = EXE_NAMES.join(' / ');

function splitArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(m[2]);
    else if (m[3]) tokens.push(m[3]);
  }
  return tokens;
}

function killProcessTree(pid: number): void {
  // win — taskkill по дереву, unix — минус pid = вся группа
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
  }
}

const processes = new Map<string, ChildProcess>();

const externalPids = new Map<string, number>();

const RESTART_WINDOW_MS = 30 * 60_000;
const HANG_CHECK_MS = 30_000;
const DEFAULT_HANG_TIMEOUT_MIN = 10;
const MAX_RESTARTS_PER_WINDOW = 3;
const RESTART_DELAY_MS = 5_000;

interface WatchdogState {
  lastLogAt: number;
  hangKilled: boolean;
  restartCount: number;
  restartWindowStart: number;
  restartTimer: NodeJS.Timeout | null;
}

const watchdogStates = new Map<string, WatchdogState>();

interface WatchdogSettings {
  autoRestartOnCrash: boolean;
  autoRestartOnHang: boolean;
  hangTimeoutMinutes: number;
}

function watchdogSettingsFor(server: ServerPayload): WatchdogSettings {
  return {
    autoRestartOnCrash: server.autoRestartOnCrash !== false,
    autoRestartOnHang: server.autoRestartOnHang === true,
    hangTimeoutMinutes:
      typeof server.hangTimeoutMinutes === 'number' && server.hangTimeoutMinutes > 0
        ? server.hangTimeoutMinutes
        : DEFAULT_HANG_TIMEOUT_MIN,
  };
}

function getWatchdog(id: string): WatchdogState {
  let st = watchdogStates.get(id);
  if (!st) {
    st = {
      lastLogAt: Date.now(),
      hangKilled: false,
      restartCount: 0,
      restartWindowStart: Date.now(),
      restartTimer: null,
    };
    watchdogStates.set(id, st);
  }
  return st;
}

function clearRestartTimer(id: string): void {
  const st = watchdogStates.get(id);
  if (st?.restartTimer) {
    clearTimeout(st.restartTimer);
    st.restartTimer = null;
  }
}

export interface AutoRestartInfo {
  serverId: string;
  attempt: number;
  delayMs: number;
}

type AutoRestartHandler = (info: AutoRestartInfo) => void;
let onAutoRestartHandler: AutoRestartHandler | null = null;

export function setOnAutoRestart(handler: AutoRestartHandler): void {
  onAutoRestartHandler = handler;
}

export interface ServerRunningInfo {
  serverId: string;
  pid?: number;
}

type ServerRunningHandler = (info: ServerRunningInfo) => void;
let onServerRunningHandler: ServerRunningHandler | null = null;

export function setOnServerRunning(handler: ServerRunningHandler): void {
  onServerRunningHandler = handler;
}

function scheduleAutoRestart(server: ServerPayload, reason: 'crash' | 'hang'): void {
  const cfg = watchdogSettingsFor(server);
  if (reason === 'crash' && !cfg.autoRestartOnCrash) return;
  if (reason === 'hang' && !cfg.autoRestartOnHang) return;

  const st = getWatchdog(server.id);
  if (Date.now() - st.restartWindowStart > RESTART_WINDOW_MS) {
    st.restartCount = 0;
    st.restartWindowStart = Date.now();
  }
  if (st.restartCount >= MAX_RESTARTS_PER_WINDOW) return;

  st.restartCount += 1;
  onAutoRestartHandler?.({ serverId: server.id, attempt: st.restartCount, delayMs: RESTART_DELAY_MS });
  clearRestartTimer(server.id);
  st.restartTimer = setTimeout(() => {
    st.restartTimer = null;
    if (processes.has(server.id)) return;
    void startServer(server);
  }, RESTART_DELAY_MS);
}

let hangTimer: NodeJS.Timeout | null = null;

function ensureHangTimer(): void {
  if (hangTimer) return;
  hangTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, st] of watchdogStates) {
      const child = processes.get(id);
      const meta = processMeta.get(id);
      if (!child?.pid || !meta) continue;
      const cfg = watchdogSettingsFor(meta.server);
      if (!cfg.autoRestartOnHang) continue;
      if (now - st.lastLogAt < cfg.hangTimeoutMinutes * 60_000) continue;
      if (st.hangKilled) continue;

      st.hangKilled = true;
      st.lastLogAt = now; // не убивать повторно в следующем тике
      killProcessTree(child.pid);
      scheduleAutoRestart(meta.server, 'hang');
    }
  }, HANG_CHECK_MS);
  hangTimer.unref();
}

export interface ProcessExitInfo {
  server: ServerPayload;
  code: number | null;
}

type ProcessExitHandler = (info: ProcessExitInfo) => void;

let onProcessExitHandler: ProcessExitHandler | null = null;

export function setOnProcessExit(handler: ProcessExitHandler): void {
  onProcessExitHandler = handler;
}

export interface ServerLogLine {
  serverId: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

type ServerLogHandler = (line: ServerLogLine) => void;

let onServerLogHandler: ServerLogHandler | null = null;

export function setOnServerLog(handler: ServerLogHandler): void {
  onServerLogHandler = handler;
}

function normalizeLogText(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

function logFilePath(server: ServerPayload): string {
  if (!server.installPath) return '';
  return path.join(server.installPath, 'Logs', `server-${server.identity || server.id}.log`);
}

function appendToLogFile(serverId: string, line: string): void {
  const server = processMeta.get(serverId)?.server;
  if (!server) return;
  const file = logFilePath(server);
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toLocaleString('en-GB')} ${line}\n`);
  } catch {
  }
}

function writeLogHeader(server: ServerPayload): void {
  const file = logFilePath(server);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      `\n${'='.repeat(60)}\n[Manager] Server start requested at ${new Date().toLocaleString('en-GB')}\n${'='.repeat(60)}\n`
    );
  } catch {
  }
}

function forwardProcessLog(child: ChildProcess, serverId: string): void {
  const attach = (stream: 'stdout' | 'stderr') => {
    const source = stream === 'stdout' ? child.stdout : child.stderr;
    if (!source) return;
    let tail = '';
    source.on('data', (chunk: Buffer) => {
      tail += normalizeLogText(String(chunk));
      const parts = tail.split('\n');
      tail = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim() === '') continue;
        const st = watchdogStates.get(serverId);
        if (st) st.lastLogAt = Date.now();
        onServerLogHandler?.({ serverId, stream, line: part });
        appendToLogFile(serverId, part);
      }
    });
    source.on('end', () => {
      if (tail.trim() === '') return;
      onServerLogHandler?.({ serverId, stream, line: tail });
      appendToLogFile(serverId, tail);
    });
  };
  attach('stdout');
  attach('stderr');
}

const processMeta = new Map<string, { server: ServerPayload; intentionallyStopped: boolean }>();

export interface ExecutableInfo {
  found: boolean;
  exePath?: string;
  searched: string[];
}

export function findExecutableInfo(installPath: string): ExecutableInfo {
  const searched = EXE_NAMES.map((name) => path.join(installPath || '', name));
  for (const exe of searched) {
    if (fs.existsSync(exe)) return { found: true, exePath: exe, searched };
  }
  return { found: false, searched };
}

export function findExecutable(installPath: string): string | null {
  return findExecutableInfo(installPath).exePath ?? null;
}

export function startServer(server: ServerPayload): Promise<ServerStartResult> {
  const exe = findExecutable(server.installPath);
  if (!exe) {
    return Promise.resolve({
      success: true,
      mode: 'sim',
      error: `Server executable (${EXE_LABEL}) not found in "${server.installPath || '(empty)'}".`,
    });
  }
  if (processes.has(server.id)) {
    return Promise.resolve({ success: false, mode: 'real', error: 'Process is already running.' });
  }
  // сервер мог пережить прошлую сессию менеджера — второй процесс не нужен
  const externalPid = externalPids.get(server.id);
  if (externalPid) {
    try {
      process.kill(externalPid, 0);
      return Promise.resolve({ success: false, mode: 'real', error: 'Process is already running.' });
    } catch {
      externalPids.delete(server.id);
    }
  }

  try {
    sanitizeServerConfig(server);
  } catch {
  }

  const args = [
    '-batchmode',
    '+server.identity',
    server.identity,
    '+server.seed',
    String(server.seed),
    '+server.worldsize',
    String(server.worldSize),
    '+server.port',
    String(server.port),
    '+server.maxplayers',
    String(server.maxPlayers),
    '+rcon.password',
    server.rconPassword,
    '+rcon.port',
    String(server.rconPort || server.port + 2),
    '+rcon.web',
    '1',
    ...(server.gamemode ? ['+gamemode', server.gamemode] : []),
    ...(server.additionalArgs ? splitArgs(server.additionalArgs) : []),
  ];

  // detached: без него Electron убьёт сервер при своём выходе (job object)
  const child = spawn(exe, args, {
    cwd: server.installPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    detached: true,
  });
  processMeta.set(server.id, { server, intentionallyStopped: false });
  writeLogHeader(server);
  forwardProcessLog(child, server.id);

  const wst = getWatchdog(server.id);
  wst.lastLogAt = Date.now();
  wst.hangKilled = false;
  clearRestartTimer(server.id);
  ensureHangTimer();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: ServerStartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(failTimer);
      resolve(result);
    };

    const failTimer = setTimeout(() => {
      processes.delete(server.id);
      processMeta.delete(server.id);
      finish({ success: false, mode: 'real', error: `Timed out waiting for ${EXE_LABEL} to start.` });
    }, 10_000);

    child.once('spawn', () => {
      processes.set(server.id, child);
      onServerRunningHandler?.({ serverId: server.id, pid: child.pid });
      finish({ success: true, mode: 'real', pid: child.pid });
    });
    child.once('error', (err) => {
      processes.delete(server.id);
      processMeta.delete(server.id);
      finish({ success: false, mode: 'real', error: err.message || String(err) });
    });

    child.on('exit', (code) => {
      processes.delete(server.id);
      clearRestartTimer(server.id);
      const meta = processMeta.get(server.id);
      processMeta.delete(server.id);
      const st = watchdogStates.get(server.id);
      const wasHangKill = st?.hangKilled ?? false;
      if (st) st.hangKilled = false;
      if (meta && !meta.intentionallyStopped) {
        onProcessExitHandler?.({ server: meta.server, code });
        if (!wasHangKill) scheduleAutoRestart(meta.server, 'crash');
      }
    });
    child.on('error', () => processes.delete(server.id));
  });
}

export function stopServer(id: string): ServerStopResult {
  const child = processes.get(id);
  if (child?.pid) {
    const meta = processMeta.get(id);
    if (meta) meta.intentionallyStopped = true;
    clearRestartTimer(id);
    const st = watchdogStates.get(id);
    if (st) {
      st.hangKilled = false;
      st.restartCount = 0;
      st.restartWindowStart = Date.now();
    }

    killProcessTree(child.pid);
    processes.delete(id);
    processMeta.delete(id);
    return { success: true, mode: 'real' };
  }

  const externalPid = externalPids.get(id);
  if (externalPid) {
    killProcessTree(externalPid);
    externalPids.delete(id);
    return { success: true, mode: 'real' };
  }

  return { success: true, mode: 'sim', error: 'No real process — simulated stop.' };
}

export function statusOf(id: string): { running: boolean; pid?: number } {
  const child = processes.get(id);
  if (child?.pid) {
    try {
      process.kill(child.pid, 0);
      return { running: true, pid: child.pid };
    } catch {
      processes.delete(id);
    }
  }
  const externalPid = externalPids.get(id);
  if (externalPid) {
    try {
      process.kill(externalPid, 0);
      return { running: true, pid: externalPid };
    } catch {
      externalPids.delete(id);
    }
  }
  return { running: false };
}

export function getPid(id: string): number | undefined {
  return statusOf(id).pid;
}

export function isProcessRunning(id: string): boolean {
  return statusOf(id).running;
}

export async function restartServer(server: ServerPayload): Promise<ServerStartResult> {
  stopServer(server.id);
  await new Promise((r) => setTimeout(r, 1500));
  return startServer(server);
}

export function stopAll(): void {
  for (const id of Array.from(processes.keys())) stopServer(id);
  externalPids.clear();
}

export interface ServerLogTailResult {
  offset: number;
  lines: string[];
}

export function readServerLogTail(
  server: ServerPayload,
  fromOffset: number,
  opts?: { sessionStart?: boolean }
): ServerLogTailResult {
  const file = logFilePath(server);
  if (!file || !fs.existsSync(file)) return { offset: 0, lines: [] };
  try {
    const size = fs.statSync(file).size;
    if (size <= 0) return { offset: 0, lines: [] };

    let start = fromOffset > size ? 0 : fromOffset;
    const TAIL_BYTES = 64 * 1024;

    if (start === 0 && opts?.sessionStart) {
      const fd0 = fs.openSync(file, 'r');
      const buf0 = Buffer.alloc(size);
      fs.readSync(fd0, buf0, 0, size, 0);
      fs.closeSync(fd0);
      const text0 = buf0.toString('utf8');
      const headerIdx = text0.lastIndexOf('[Manager] Server start requested');
      if (headerIdx > 0) {
        const lineStart = text0.lastIndexOf('\n', headerIdx) + 1;
        start = Buffer.byteLength(text0.slice(0, lineStart), 'utf8');
      } else if (size > TAIL_BYTES) {
        start = size - TAIL_BYTES;
      }
    } else if (start === 0 && size > TAIL_BYTES) {
      start = size - TAIL_BYTES;
    }
    if (start === size) return { offset: size, lines: [] };

    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const nl = text.lastIndexOf('\n');
    if (nl === -1) return { offset: start, lines: [] };

    const complete = text.slice(0, nl + 1);
    const lines = complete.split(/\r?\n/).filter((l) => l.trim() !== '');
    return { offset: start + Buffer.byteLength(complete, 'utf8'), lines };
  } catch {
    return { offset: fromOffset, lines: [] };
  }
}

export function readServerLogFile(
  server: ServerPayload,
  maxLines = 4000
): { ok: boolean; path?: string; lines: string[]; total?: number; error?: string } {
  const file = logFilePath(server);
  if (!file || !fs.existsSync(file)) return { ok: false, lines: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
    const total = lines.length;
    return { ok: true, path: file, lines: lines.slice(-maxLines), total };
  } catch (err) {
    return { ok: false, lines: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function detectExternalServers(servers: ServerPayload[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const withPath = servers.filter((s) => s.installPath);
  if (withPath.length === 0) return result;

  let running: Array<{ pid: number; exePath: string }> = [];
  try {
    if (process.platform === 'win32') {
      const psScript =
        "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | " +
        "Where-Object { $_.Name -in @('RustDedicatedServer.exe','RustDedicated.exe') } | " +
        "ForEach-Object { Write-Output (\"$($_.ProcessId)|$($_.ExecutablePath)\") }";
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 15_000 }
      );
      for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const sep = line.indexOf('|');
        if (sep < 0) continue;
        const pid = Number(line.slice(0, sep));
        const exePath = line.slice(sep + 1);
        if (pid > 0 && exePath) running.push({ pid, exePath });
      }
    } else {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], { timeout: 15_000 });
      for (const rawLine of stdout.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(rawLine);
        if (!m) continue;
        const pid = Number(m[1]);
        const args = m[2].trim();
        if (!/RustDedicated/.test(args)) continue;
        const exePath = args.split(/\s+/)[0];
        if (pid > 0 && exePath) running.push({ pid, exePath });
      }
    }
  } catch {
  }

  for (const s of withPath) {
    const base = path.normalize(s.installPath).toLowerCase().replace(/[\\/]+$/, '');
    const match = running.find((r) => path.dirname(r.exePath).toLowerCase() === base);
    if (match) {
      result[s.id] = match.pid;
      externalPids.set(s.id, match.pid);
    } else {
      externalPids.delete(s.id);
    }
  }
  return result;
}
