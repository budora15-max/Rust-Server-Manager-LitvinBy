import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { httpGet } from './http';
import type { ServerPayload } from './types';

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const RUST_APP_ID = '258550';

export type UpdateEmitter = (message: string, pct?: number) => void;

function steamcmdDir(): string {
  return path.join(app.getPath('userData'), 'steamcmd');
}

function steamcmdExe(): string {
  return path.join(steamcmdDir(), 'steamcmd.exe');
}

function extractZip(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`,
      ],
      { windowsHide: true }
    );
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive failed with code ${code}`));
    });
  });
}

/** Гарантирует наличие steamcmd.exe (скачивает и распаковывает при необходимости). */
async function ensureSteamCmd(emit: UpdateEmitter): Promise<string> {
  const exe = steamcmdExe();
  if (fs.existsSync(exe)) return exe;

  const dir = steamcmdDir();
  fs.mkdirSync(dir, { recursive: true });
  emit('SteamCMD not found — downloading…', 0);

  const zipPath = path.join(dir, 'steamcmd.zip');
  const res = await httpGet(STEAMCMD_URL);
  if (res.status !== 200) {
    throw new Error(`SteamCMD download failed with HTTP ${res.status}`);
  }
  fs.writeFileSync(zipPath, res.body);
  emit('Extracting SteamCMD…', 5);
  await extractZip(zipPath, dir);
  fs.unlinkSync(zipPath);
  return steamcmdExe();
}

/**
 * Обновление серверной части Rust через SteamCMD:
 * +force_install_dir <путь> +login anonymous +app_update 258550 validate +quit.
 * Прогресс загрузки транслируется через emit (проценты из stdout).
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
    emit(`Updating Rust (app ${RUST_APP_ID}) in ${server.installPath}…`, 5);

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

      const onData = (data: Buffer) => {
        const text = String(data).trim();
        if (!text) return;
        const pctMatch = /(\d+(?:\.\d+)?)%/.exec(text);
        emit(text.slice(0, 400), pctMatch ? Number(pctMatch[1]) : undefined);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: `SteamCMD exited with code ${code}` });
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
