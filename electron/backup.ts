import * as fs from 'fs';
import * as path from 'path';
import type { ServerPayload } from './types';

// тащим только мир и базы, скриншоты/прочее в бэкап не пишем
const WORLD_FILE_RE = /\.(sav|map|db|db-wal|db-shm|db\.\d+)$/i;

export interface BackupEntry {
  id: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
  fileCount: number;
  label: string;
}

export interface BackupResult {
  ok: boolean;
  error?: string;
  entry?: BackupEntry;
}

function identityDir(server: ServerPayload): string {
  return server.installPath ? path.join(server.installPath, 'server', server.identity) : '';
}

function backupsDir(server: ServerPayload): string {
  return server.installPath ? path.join(server.installPath, 'backups', server.identity) : '';
}

export function createWorldBackup(server: ServerPayload, label = 'manual'): BackupResult {
  const idDir = identityDir(server);
  if (!idDir || !fs.existsSync(idDir)) {
    return { ok: false, error: 'Identity folder not found — set install path and start the server first.' };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const safeLabel =
    label.replace(/[^\wа-яА-ЯёЁ -]/gi, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'backup';
  let dest = path.join(backupsDir(server), `${stamp}-${safeLabel}`);
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(backupsDir(server), `${stamp}-${safeLabel}-${n}`);
    n += 1;
  }

  try {
    fs.mkdirSync(dest, { recursive: true });
    let sizeBytes = 0;
    let fileCount = 0;
    for (const f of fs.readdirSync(idDir)) {
      if (!WORLD_FILE_RE.test(f)) continue;
      const src = path.join(idDir, f);
      try {
        fs.copyFileSync(src, path.join(dest, f));
        sizeBytes += fs.statSync(src).size;
        fileCount += 1;
      } catch {
      }
    }
    if (fileCount === 0) {
      fs.rmdirSync(dest);
      return { ok: false, error: 'No world files (.sav/.map/.db) found to back up.' };
    }
    return {
      ok: true,
      entry: {
        id: path.basename(dest),
        path: dest,
        createdAt: fs.statSync(dest).mtimeMs,
        sizeBytes,
        fileCount,
        label: safeLabel,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function listWorldBackups(server: ServerPayload): BackupEntry[] {
  const dir = backupsDir(server);
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d): BackupEntry => {
        const p = path.join(dir, d.name);
        let sizeBytes = 0;
        let fileCount = 0;
        try {
          for (const f of fs.readdirSync(p)) {
            const s = fs.statSync(path.join(p, f));
            sizeBytes += s.size;
            fileCount += 1;
          }
        } catch {
        }
        return {
          id: d.name,
          path: p,
          createdAt: fs.statSync(p).mtimeMs,
          sizeBytes,
          fileCount,
          label: d.name,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function restoreWorldBackup(server: ServerPayload, backupId: string): BackupResult {
  const idDir = identityDir(server);
  const src = path.join(backupsDir(server), backupId);
  if (!idDir || !fs.existsSync(src)) {
    return { ok: false, error: 'Backup not found.' };
  }
  try {
    fs.mkdirSync(idDir, { recursive: true });
    let count = 0;
    for (const f of fs.readdirSync(src)) {
      const from = path.join(src, f);
      try {
        fs.copyFileSync(from, path.join(idDir, f));
        count += 1;
      } catch (err) {
        return { ok: false, error: `Cannot restore "${f}": ${err instanceof Error ? err.message : String(err)}. Stop the server first.` };
      }
    }
    return { ok: true, entry: { id: backupId, path: src, createdAt: Date.now(), sizeBytes: 0, fileCount: count, label: backupId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function deleteWorldBackup(server: ServerPayload, backupId: string): { ok: boolean; error?: string } {
  const dir = path.join(backupsDir(server), backupId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'Backup not found.' };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
