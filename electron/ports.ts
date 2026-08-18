import * as net from 'net';
import { exec } from 'child_process';
import type { ServerPayload } from './types';

/**
 * Порты сервера: локальный статус (свободен/занят — кем), правила Windows
 * Firewall (открытие/закрытие через netsh с выборочным UAC) и TCP-проверка
 * доступности host:port извне.
 */

export type PortState = 'free' | 'used' | 'managed' | 'unknown';

export interface PortStatus {
  key: string;
  label: string;
  port: number;
  protocol: 'TCP' | 'UDP';
  state: PortState;
  pid?: number;
  process?: string;
}

export interface FirewallRuleStatus {
  exists: boolean;
  enabled: boolean;
  error?: string;
}

export interface ExternalProbeResult {
  ok: boolean;
  reachable?: boolean;
  error?: string;
}

/** Порт сервера: имя правила Firewall (уникальное на сервер + порт + протокол). */
function ruleName(server: ServerPayload, port: number, protocol: string): string {
  const safe = (server.name || server.id).replace(/[^\wа-яА-ЯёЁ -]/gi, '').trim() || 'server';
  return `Rust Server Manager - ${safe} - ${port}/${protocol}`;
}

/** Список портов Rust-сервера (игровой UDP, query UDP, WebRcon TCP). */
export function serverPorts(server: ServerPayload): Array<{
  key: string;
  label: string;
  port: number;
  protocol: 'TCP' | 'UDP';
}> {
  const base = Number(server.port) || 28015;
  const rcon = Number(server.rconPort) || base + 2;
  const query = Number(server.queryport) || base + 1;
  return [
    { key: 'game', label: 'Game (server.port)', port: base, protocol: 'UDP' },
    { key: 'query', label: 'Query (server.queryport)', port: query, protocol: 'UDP' },
    { key: 'rcon', label: 'WebRcon (rcon.port)', port: rcon, protocol: 'TCP' },
  ];
}

function execCapture(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 8000 }, (_err, stdout) => resolve(stdout ?? ''));
  });
}

/** Парсинг вывода netstat: порт → протокол/PID/слушает ли. */
export function parseNetstatText(text: string): Map<string, { proto: string; pid: number; listening: boolean }> {
  const map = new Map<string, { proto: string; pid: number; listening: boolean }>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const proto = parts[0].toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') continue;
    const portMatch = /:(\d+)$/.exec(parts[1]);
    if (!portMatch) continue;
    const pid = Number(parts[parts.length - 1]);
    const listening = proto === 'UDP' || parts.includes('LISTENING');
    if (!Number.isFinite(pid)) continue;
    map.set(`${proto}:${portMatch[1]}`, { proto, pid, listening });
  }
  return map;
}

/**
 * Парсинг вывода `netstat -tunlp` (Linux). PID виден только при запуске от root;
 * без прав PID не определяется (порт считается свободным).
 * Формат: `udp 0 0 0.0.0.0:28015 0.0.0.0:* 1234/RustDedicated` (у tcp между ними — State).
 */
export function parseNetstatLinuxText(text: string): Map<string, { proto: string; pid: number; listening: boolean }> {
  const map = new Map<string, { proto: string; pid: number; listening: boolean }>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const proto = parts[0].toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') continue;
    const portMatch = /:(\d+)$/.exec(parts[3]);
    if (!portMatch) continue;
    const pidField = proto === 'UDP' ? parts[5] : parts[6];
    const pid = Number((/\d+/.exec(pidField ?? '') ?? [''])[0]);
    if (pid > 0 && Number.isFinite(pid)) {
      map.set(`${proto}:${portMatch[1]}`, { proto, pid, listening: true });
    }
  }
  return map;
}

/** Парсинг вывода tasklist /fo csv /nh: PID → имя процесса. */
export function parseTasklistText(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m) map.set(Number(m[2]), m[1]);
  }
  return map;
}

async function netstatMap(): Promise<Map<string, { proto: string; pid: number; listening: boolean }>> {
  if (process.platform !== 'win32') {
    // Linux: netstat -tunlp (или ss -tulpn как запасной).
    const out = await execCapture('netstat -tunlp 2>/dev/null || ss -tulpn');
    return parseNetstatLinuxText(out);
  }
  const [tcp, udp] = await Promise.all([
    execCapture('netstat -ano -p tcp'),
    execCapture('netstat -ano -p udp'),
  ]);
  return parseNetstatText(`${tcp}\n${udp}`);
}

async function tasklistMap(): Promise<Map<number, string>> {
  if (process.platform !== 'win32') {
    // Linux: ps — PID → имя процесса.
    const out = await execCapture('ps -eo pid=,comm=');
    const map = new Map<number, string>();
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\S+)/.exec(line);
      if (m) map.set(Number(m[1]), m[2]);
    }
    return map;
  }
  return parseTasklistText(await execCapture('tasklist /fo csv /nh'));
}

/** Локальный статус портов сервера. managedPid — PID сервера, запущенного менеджером. */
export async function checkLocalPorts(server: ServerPayload, managedPid?: number): Promise<PortStatus[]> {
  const [netstat, tasks] = await Promise.all([netstatMap(), tasklistMap()]);
  return serverPorts(server).map((def) => {
    const entry = netstat.get(`${def.protocol}:${def.port}`);
    if (!entry || !entry.listening) {
      return { key: def.key, label: def.label, port: def.port, protocol: def.protocol, state: 'free' };
    }
    if (managedPid && entry.pid === managedPid) {
      return { key: def.key, label: def.label, port: def.port, protocol: def.protocol, state: 'managed' };
    }
    return {
      key: def.key,
      label: def.label,
      port: def.port,
      protocol: def.protocol,
      state: 'used',
      pid: entry.pid,
      process: tasks.get(entry.pid) ?? 'Unknown',
    };
  });
}

/** Статус правила Windows Firewall для порта (без прав администратора). */
export async function getFirewallRule(
  server: ServerPayload,
  port: number,
  protocol: 'TCP' | 'UDP'
): Promise<FirewallRuleStatus> {
  if (process.platform !== 'win32') {
    return {
      exists: false,
      enabled: false,
      error: 'Firewall management is available on Windows only (on Linux use iptables/ufw).',
    };
  }
  const name = ruleName(server, port, protocol);
  const script = `try { (Get-NetFirewallRule -DisplayName '${name}' -ErrorAction Stop).Enabled.ToString() } catch { 'NOT_FOUND' }`;
  try {
    const raw = await execCapture(`powershell -NoProfile -NonInteractive -Command "${script}"`);
    const value = raw.trim().split(/\r?\n/).pop() ?? '';
    if (value === 'True') return { exists: true, enabled: true };
    if (value === 'False') return { exists: true, enabled: false };
    return { exists: false, enabled: false };
  } catch (err) {
    return { exists: false, enabled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Выполнение команды с правами администратора (выборочный UAC-промпт). */
async function runElevated(cmd: string): Promise<string> {
  const encoded = Buffer.from(cmd, 'utf16le').toString('base64');
  const outer = `powershell -NoProfile -NonInteractive -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'"`;
  return execCapture(outer);
}

/** Открытие порта в Windows Firewall (UAC-промпт при необходимости). */
export async function openFirewallPort(
  server: ServerPayload,
  port: number,
  protocol: 'TCP' | 'UDP'
): Promise<FirewallRuleStatus> {
  if (process.platform !== 'win32') {
    return {
      exists: false,
      enabled: false,
      error: 'Firewall management is available on Windows only (on Linux use iptables/ufw).',
    };
  }
  const name = ruleName(server, port, protocol);
  const cmd = `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=${protocol} localport=${port}`;
  await runElevated(cmd);
  return getFirewallRule(server, port, protocol);
}

/** Закрытие порта в Windows Firewall (удаление правила, UAC-промпт). */
export async function closeFirewallPort(
  server: ServerPayload,
  port: number,
  protocol: 'TCP' | 'UDP'
): Promise<FirewallRuleStatus> {
  if (process.platform !== 'win32') {
    return {
      exists: false,
      enabled: false,
      error: 'Firewall management is available on Windows only (on Linux use iptables/ufw).',
    };
  }
  const name = ruleName(server, port, protocol);
  const cmd = `netsh advfirewall firewall delete rule name="${name}"`;
  await runElevated(cmd);
  return getFirewallRule(server, port, protocol);
}

/** TCP-проверка доступности host:port извне (таймаут 3 сек). */
export function probeExternal(host: string, port: number): Promise<ExternalProbeResult> {
  return new Promise((resolve) => {
    if (!host) {
      resolve({ ok: false, error: 'No host specified' });
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const done = (reachable: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: true, reachable, error });
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'Timeout'));
    socket.once('error', (err) => done(false, err.message));
    socket.connect(port, host);
  });
}
