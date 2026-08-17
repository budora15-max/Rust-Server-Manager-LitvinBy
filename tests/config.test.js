// Тесты модуля конфигурации server.cfg.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const {
  readServerConfig,
  saveServerConfig,
  sanitizeServerConfig,
} = require('../dist-electron/config.js');

function setupServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  const install = path.join(root, 'install');
  return {
    root,
    server: {
      id: 'srv1',
      identity: 'main',
      name: 'Test',
      installPath: install,
      port: 28015,
      seed: 12345,
      worldSize: 4000,
      maxPlayers: 100,
      rconHost: '127.0.0.1',
      rconPort: 28017,
      rconPassword: 'secret',
      map: 'Procedural Map',
    },
  };
}

const CFG_PATH = ['server', 'main', 'cfg', 'server.cfg'];

test('readServerConfig creates default when missing', () => {
  const { root, server } = setupServer();
  const res = readServerConfig(server);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.exists, false, 'file was created');
  assert.ok(res.config['server.seed'], 'default has server.seed');
  assert.ok(fs.existsSync(path.join(server.installPath, ...CFG_PATH)), 'file on disk');
  fs.rmSync(root, { recursive: true, force: true });
});

test('readServerConfig parses existing file', () => {
  const { root, server } = setupServer();
  const cfg = path.join(server.installPath, ...CFG_PATH);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, '# comment\nserver.seed 111\nserver.level "Procedural Map"\n', 'utf8');

  const res = readServerConfig(server);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.exists, true);
  assert.strictEqual(res.config['server.seed'], '111');
  assert.strictEqual(res.config['server.level'], '"Procedural Map"', 'quotes preserved as-is');
  fs.rmSync(root, { recursive: true, force: true });
});

test('saveServerConfig updates in place and appends new keys', () => {
  const { root, server } = setupServer();
  const cfg = path.join(server.installPath, ...CFG_PATH);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, 'server.seed 111\n# keep me\n', 'utf8');

  const res = saveServerConfig(server, { 'server.seed': '222', 'server.maxplayers': '50' });
  assert.strictEqual(res.ok, true);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes('server.seed 222'), 'updated');
  assert.ok(after.includes('# keep me'), 'comment kept');
  assert.ok(after.includes('server.maxplayers 50'), 'new key appended');
  fs.rmSync(root, { recursive: true, force: true });
});

test('sanitizeServerConfig quotes values with spaces', () => {
  const { root, server } = setupServer();
  const cfg = path.join(server.installPath, ...CFG_PATH);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, 'server.level Procedural Map\nserver.seed 111\n', 'utf8');

  const changed = sanitizeServerConfig(server);
  assert.strictEqual(changed, true, 'file was modified');
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes('server.level "Procedural Map"'), 'quoted');
  assert.ok(after.includes('server.seed 111'), 'no-space value untouched');

  // Второй проход — уже корректно
  assert.strictEqual(sanitizeServerConfig(server), false, 'no change on second pass');
  fs.rmSync(root, { recursive: true, force: true });
});
