// Тесты модуля бэкапов мира.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const {
  createWorldBackup,
  listWorldBackups,
  restoreWorldBackup,
  deleteWorldBackup,
} = require('../dist-electron/backup.js');

function setupServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  const install = path.join(root, 'server-install');
  const idDir = path.join(install, 'server', 'main');
  fs.mkdirSync(idDir, { recursive: true });
  fs.writeFileSync(path.join(idDir, 'main.map'), 'mapdata');
  fs.writeFileSync(path.join(idDir, 'main.sav'), 'savdata');
  fs.writeFileSync(path.join(idDir, 'player.db'), 'dbdata');
  fs.writeFileSync(path.join(idDir, 'player.db-wal'), 'waldb');
  return {
    root,
    server: {
      id: 'srv1',
      identity: 'main',
      name: 'Test',
      installPath: install,
      port: 28015,
      seed: 1,
      worldSize: 4000,
      maxPlayers: 100,
      rconHost: '127.0.0.1',
      rconPort: 28017,
      rconPassword: 'secret',
      map: 'Procedural Map',
    },
  };
}

test('create/list/restore/delete backup', () => {
  const { root, server } = setupServer();

  const created = createWorldBackup(server, 'test-label');
  assert.ok(created.ok, `create ok: ${created.error ?? ''}`);
  assert.ok(created.entry, 'has entry');
  assert.strictEqual(created.entry.fileCount, 4, 'all 4 world files copied');
  assert.ok(created.entry.sizeBytes > 0, 'size > 0');

  const list = listWorldBackups(server);
  assert.strictEqual(list.length, 1, 'one backup in list');

  // Восстановление: удаляем мир и возвращаем из бэкапа
  fs.rmSync(path.join(server.installPath, 'server', 'main'), { recursive: true, force: true });
  const restored = restoreWorldBackup(server, created.entry.id);
  assert.ok(restored.ok, `restore ok: ${restored.error ?? ''}`);
  assert.ok(fs.existsSync(path.join(server.installPath, 'server', 'main', 'main.map')), 'map restored');
  assert.ok(fs.existsSync(path.join(server.installPath, 'server', 'main', 'player.db')), 'db restored');

  const deleted = deleteWorldBackup(server, created.entry.id);
  assert.ok(deleted.ok, 'delete ok');
  assert.strictEqual(listWorldBackups(server).length, 0, 'backup removed');

  fs.rmSync(root, { recursive: true, force: true });
});

test('two backups in the same millisecond get unique names', () => {
  const { root, server } = setupServer();
  const a = createWorldBackup(server, 'same');
  const b = createWorldBackup(server, 'same');
  assert.ok(a.ok && b.ok, 'both created');
  assert.notStrictEqual(a.entry.id, b.entry.id, 'names differ');
  assert.strictEqual(listWorldBackups(server).length, 2, 'two backups present');
  fs.rmSync(root, { recursive: true, force: true });
});

test('backup without identity folder fails gracefully', () => {
  const { root } = setupServer();
  const server = {
    id: 'srv2',
    identity: 'missing',
    name: 'Test',
    installPath: path.join(root, 'nowhere'),
    port: 28015,
    seed: 1,
    worldSize: 4000,
    maxPlayers: 100,
    rconHost: '127.0.0.1',
    rconPort: 28017,
    rconPassword: 'secret',
    map: 'Procedural Map',
  };
  const res = createWorldBackup(server, 'x');
  assert.strictEqual(res.ok, false);
  assert.ok(res.error, 'has error message');
  fs.rmSync(root, { recursive: true, force: true });
});
