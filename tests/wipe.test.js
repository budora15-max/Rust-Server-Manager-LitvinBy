// Тесты модуля вайпа.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { executeWipe } = require('../dist-electron/wipe.js');

function makeServer(installPath) {
  return {
    id: 'srv1',
    identity: 'main',
    name: 'Test',
    installPath,
    port: 28015,
    seed: 12345,
    worldSize: 4000,
    maxPlayers: 100,
    rconHost: '127.0.0.1',
    rconPort: 28017,
    rconPassword: 'secret',
    map: 'Procedural Map',
  };
}

test('simulation when identity folder missing', () => {
  const res = executeWipe(makeServer(''), {
    wipeMap: true,
    wipeDb: true,
    regenerateSeed: true,
  });
  assert.strictEqual(res.mode, 'sim');
  assert.strictEqual(res.ok, true);
  assert.ok(res.newSeed && res.newSeed !== 12345, 'seed regenerated in sim too');
});

test('real wipe deletes only requested files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wipe-test-'));
  const install = path.join(root, 'install');
  const idDir = path.join(install, 'server', 'main');
  fs.mkdirSync(idDir, { recursive: true });
  fs.writeFileSync(path.join(idDir, 'main.map'), 'map');
  fs.writeFileSync(path.join(idDir, 'backup.map'), 'b');
  fs.writeFileSync(path.join(idDir, 'player.db'), 'db');
  fs.writeFileSync(path.join(idDir, 'player.db.2'), 'db2');
  fs.writeFileSync(path.join(idDir, 'notes.txt'), 'keep me');

  const res = executeWipe(makeServer(install), {
    wipeMap: true,
    wipeDb: true,
    regenerateSeed: false,
  });
  assert.strictEqual(res.mode, 'real');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.deletedFiles.length, 4, 'map + backup.map + db + db.2 deleted');
  assert.ok(!fs.existsSync(path.join(idDir, 'main.map')), 'map gone');
  assert.ok(!fs.existsSync(path.join(idDir, 'player.db')), 'db gone');
  assert.ok(fs.existsSync(path.join(idDir, 'notes.txt')), 'non-world file kept');
  assert.strictEqual(res.newSeed, 12345, 'seed unchanged without regenerateSeed');

  fs.rmSync(root, { recursive: true, force: true });
});

test('wipe map only keeps db files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wipe-test2-'));
  const install = path.join(root, 'install');
  const idDir = path.join(install, 'server', 'main');
  fs.mkdirSync(idDir, { recursive: true });
  fs.writeFileSync(path.join(idDir, 'main.map'), 'map');
  fs.writeFileSync(path.join(idDir, 'player.db'), 'db');

  const res = executeWipe(makeServer(install), {
    wipeMap: true,
    wipeDb: false,
    regenerateSeed: true,
  });
  assert.strictEqual(res.deletedFiles.length, 1);
  assert.ok(!fs.existsSync(path.join(idDir, 'main.map')), 'map gone');
  assert.ok(fs.existsSync(path.join(idDir, 'player.db')), 'db kept');
  assert.ok(res.newSeed && res.newSeed !== 12345, 'seed regenerated');

  fs.rmSync(root, { recursive: true, force: true });
});
