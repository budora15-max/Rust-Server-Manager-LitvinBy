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

/**
 * Возможные имена исполняемого файла Rust-сервера.
 * Зависит от способа установки/хостера: официальный SteamCMD-клиент даёт
 * RustDedicatedServer.exe, ряд сборок и панелей — RustDedicated.exe.
 */
/** Имена исполняемого файла Rust-сервера: на Windows — .exe, на Linux — нативный бинарник. */
const EXE_NAMES =
  process.platform === 'win32'
    ? ['RustDedicatedServer.exe', 'RustDedicated.exe']
    : ['RustDedicated', 'RustDedicatedServer'];
const EXE_LABEL = EXE_NAMES.join(' / ');

/** Разбор дополнительных аргументов запуска с учётом кавычек. */
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

/** Завершение процесса вместе с дочерними (Windows: taskkill /T; Linux/macOS: процесс-группа). */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      return;
    }
    // Linux/macOS: сервер запускается с detached: true (отдельная группа), -pid = группа.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // процесс уже завершился или нет прав
  }
}

const processes = new Map<string, ChildProcess>();

/** PID сервера, запущенного вне менеджера (обнаружен через список процессов ОС). */
const externalPids = new Map<string, number>();

// ---------------------------------------------------------------------------
// Watchdog: автоконтроль падений и зависаний запущенных серверов.
// ---------------------------------------------------------------------------

const RESTART_WINDOW_MS = 30 * 60_000;
const HANG_CHECK_MS = 30_000;
const DEFAULT_HANG_TIMEOUT_MIN = 10;
const MAX_RESTARTS_PER_WINDOW = 3;
const RESTART_DELAY_MS = 5_000;

interface WatchdogState {
  lastLogAt: number;
  /** Менеджер убил процесс из-за зависания — чтобы не планировать второй рестарт из exit-обработчика. */
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

/** Регистрация обработчика авторестарта (менеджер перезапускает сервер сам). */
export function setOnAutoRestart(handler: AutoRestartHandler): void {
  onAutoRestartHandler = handler;
}

export interface ServerRunningInfo {
  serverId: string;
  pid?: number;
}

type ServerRunningHandler = (info: ServerRunningInfo) => void;
let onServerRunningHandler: ServerRunningHandler | null = null;

/** Регистрация обработчика факта запуска процесса (в т.ч. авторестарта). */
export function setOnServerRunning(handler: ServerRunningHandler): void {
  onServerRunningHandler = handler;
}

/** Планирование авторестарта (crash — падение процесса, hang — зависание). */
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
    // Процесс мог быть запущен вручную, пока ждали — не перезапускаем повторно.
    if (processes.has(server.id)) return;
    void startServer(server);
  }, RESTART_DELAY_MS);
}

let hangTimer: NodeJS.Timeout | null = null;

/** Таймер проверки «зависаний» (нет вывода процесса дольше заданного времени). */
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

/** Регистрация обработчика неожиданного завершения процесса (краш). */
export function setOnProcessExit(handler: ProcessExitHandler): void {
  onProcessExitHandler = handler;
}

/** Строка лога запущенного сервера (stdout/stderr процесса). */
export interface ServerLogLine {
  serverId: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

type ServerLogHandler = (line: ServerLogLine) => void;

let onServerLogHandler: ServerLogHandler | null = null;

/** Регистрация обработчика потока лога запущенного сервера. */
export function setOnServerLog(handler: ServerLogHandler): void {
  onServerLogHandler = handler;
}

/** Очистка ANSI-кодов (цвета Unity-лога) и переводов каретки. */
function normalizeLogText(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

/** Путь к файлу, куда сохраняется лог запущенного сервера (постоянный лог). */
function logFilePath(server: ServerPayload): string {
  if (!server.installPath) return '';
  return path.join(server.installPath, 'Logs', `server-${server.identity || server.id}.log`);
}

/** Дописывает строку лога процесса в постоянный файл Logs/server-<identity>.log. */
function appendToLogFile(serverId: string, line: string): void {
  const server = processMeta.get(serverId)?.server;
  if (!server) return;
  const file = logFilePath(server);
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toLocaleString('en-GB')} ${line}\n`);
  } catch {
    // файл лога недоступен — не мешаем работе сервера
  }
}

/** Заголовок при каждом запуске сервера менеджером. */
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
    // файл лога недоступен
  }
}

/**
 * Перехватывает stdout/stderr процесса сервера и транслирует их построчно
 * в обработчик — дальше строки попадают в консоль приложения (вкладка Console)
 * и сохраняются в файл Logs/server-<identity>.log.
 */
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

/** Метаданные запущенных процессов (для детекции краша). */
const processMeta = new Map<string, { server: ServerPayload; intentionallyStopped: boolean }>();

export interface ExecutableInfo {
  found: boolean;
  exePath?: string;
  searched: string[];
}

/** Подробности поиска исполняемого файла сервера в папке установки. */
export function findExecutableInfo(installPath: string): ExecutableInfo {
  const searched = EXE_NAMES.map((name) => path.join(installPath || '', name));
  for (const exe of searched) {
    if (fs.existsSync(exe)) return { found: true, exePath: exe, searched };
  }
  return { found: false, searched };
}

/** Возвращает путь к исполняемому файлу сервера (по любому известному имени) или null. */
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
  // Сервер мог быть запущен вне менеджера (или в прошлой сессии менеджера и
  // остаться работать после его закрытия) — не запускаем второй экземпляр.
  const externalPid = externalPids.get(server.id);
  if (externalPid) {
    try {
      process.kill(externalPid, 0);
      return Promise.resolve({ success: false, mode: 'real', error: 'Process is already running.' });
    } catch {
      externalPids.delete(server.id);
    }
  }

  // Чиним cfg перед стартом: значения с пробелами (server.level и др.) без кавычек
  // ломают загрузку сцены Procedural на ряде сборок Rust.
  try {
    sanitizeServerConfig(server);
  } catch {
    // не критично — сервер стартует, починка повторится при следующем запуске
  }

  const args = [
    '-batchmode',
    // ВАЖНО: без '-nographics'. На сборках Rust, установленных на этой машине,
    // флаг -nographics ломает загрузку сцены Procedural ("Failed to load level:
    // Procedural", карта не генерируется, сервер зависает на 0 сущностей).
    // Проверено: без флага карта генерируется штатно на обеих установках.
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
    // Конвар gamemode ('', softcore, hardcore, ...) — дублируется и в server.cfg.
    // Пустое значение не передаём: игра сама прочитает server.cfg с `gamemode ""`.
    ...(server.gamemode ? ['+gamemode', server.gamemode] : []),
    // Дополнительные аргументы строки запуска (свободный текст администратора).
    ...(server.additionalArgs ? splitArgs(server.additionalArgs) : []),
  ];

  // windowsHide: false — на Windows показываем консольное окно запускаемого сервера,
  // чтобы пользователь видел, что процесс реально стартовал.
  // stdout/stderr перехватываем и транслируем в консоль приложения (вкладка Console),
  // потому что в окне процесса при таком запуске лог не отображается.
  const child = spawn(exe, args, {
    cwd: server.installPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    // На Linux отдельная группа процессов — killProcessTree(-pid) завершит всё дерево.
    detached: process.platform !== 'win32',
  });
  // Метаданные записываем сразу — forwardProcessLog/appendToLogFile используют
  // их для определения пути файла лога.
  processMeta.set(server.id, { server, intentionallyStopped: false });
  writeLogHeader(server);
  forwardProcessLog(child, server.id);

  // Watchdog: фиксируем время старта и включаем проверку зависаний.
  const wst = getWatchdog(server.id);
  wst.lastLogAt = Date.now();
  wst.hangKilled = false;
  clearRestartTimer(server.id);
  ensureHangTimer();

  // Ждём подтверждение spawn или ошибку запуска, чтобы не врать рендереру про «online».
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: ServerStartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(failTimer);
      resolve(result);
    };

    // Страховка: если событий spawn/error не было вовсе — честный таймаут.
    const failTimer = setTimeout(() => {
      processes.delete(server.id);
      processMeta.delete(server.id);
      finish({ success: false, mode: 'real', error: `Timed out waiting for ${EXE_LABEL} to start.` });
    }, 10_000);

    child.once('spawn', () => {
      processes.set(server.id, child);
      // Сообщаем рендереру о факте запуска процесса (обычный старт или авторестарт)
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
      // Выход без явной команды остановки = краш
      if (meta && !meta.intentionallyStopped) {
        onProcessExitHandler?.({ server: meta.server, code });
        // Автоперезапуск при падении; при зависании рестарт уже запланирован выше.
        if (!wasHangKill) scheduleAutoRestart(meta.server, 'crash');
      }
    });
    child.on('error', () => processes.delete(server.id));
  });
}

export function stopServer(id: string): ServerStopResult {
  const child = processes.get(id);
  if (child?.pid) {
    // Помечаем остановку как намеренную — вебхук «краша» не отправится
    const meta = processMeta.get(id);
    if (meta) meta.intentionallyStopped = true;
    // Ручная остановка: отменяем запланированный авторестарт и сбрасываем счётчик
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

  // Сервер мог быть запущен вне менеджера — останавливаем по PID из списка ОС
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
  // Процесс мог быть запущен вне менеджера и обнаружен через список ОС
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

/** PID запущенного процесса сервера (для pidusage) — свой или внешний (переподключённый). */
export function getPid(id: string): number | undefined {
  return statusOf(id).pid;
}

/** Реально ли запущен процесс сервера (свой или внешний). */
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
  // Внешние процессы (запущенные вне менеджера) при выходе не убиваем намеренно.
  externalPids.clear();
}

export interface ServerLogTailResult {
  /** Смещение в файле, с которого нужно продолжать следующее чтение. */
  offset: number;
  /** Новые полные строки лога. */
  lines: string[];
}

/**
 * Чтение хвоста файла лога сервера (Logs/server-<identity>.log).
 * При fromOffset = 0 возвращаются последние ~64 КБ (первое наполнение консоли),
 * при ненулевом — только новые строки после смещения.
 * При opts.sessionStart = true (только для fromOffset = 0) возвращаются строки
 * с последнего заголовка «[Manager] Server start requested» — то есть только
 * текущая сессия без устаревших строк прошлых запусков.
 * Консоль приложения использует этот pull-режим как основной источник,
 * чтобы показывать и прошлые строки, и живой лог независимо от шины событий.
 */
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
      // Начало текущей сессии: ищем последний заголовок запуска сервера менеджером.
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

/**
 * Полное чтение файла лога сервера для браузера логов (последние N строк).
 * Фильтрация и поиск выполняются в рендерере.
 */
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

/**
 * Обнаружение реальных серверных процессов в ОС (могут быть запущены вне менеджера
 * или после перезапуска менеджера, когда PID не сохранился).
 * Возвращает map: serverId → PID для серверов, чей исполняемый файл лежит в installPath.
 */
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
      // Linux: ps — PID + командная строка; находим RustDedicated по имени в аргументах.
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
    // нет доступа к процессам — считаем, что внешних серверов нет
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
