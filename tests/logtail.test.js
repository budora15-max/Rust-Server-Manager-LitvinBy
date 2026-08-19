const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { readServerLogTail } = require('../dist-electron/rust-process.js');

function makeServer(install) {
  return {
    id: 'srv1',
    identity: 'main',
    name: 'T',
    installPath: install,
    port: 28015,
    seed: 1,
    worldSize: 4000,
    maxPlayers: 100,
    rconHost: '127.0.0.1',
    rconPort: 28017,
    rconPassword: 'secret',
    map: 'Procedural Map',
  };
}

test('readServerLogTail: sessionStart returns only the current session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logtail-test-'));
  const install = path.join(root, 'install');
  const logDir = path.join(install, 'Logs');
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, 'server-main.log');
  fs.writeFileSync(
    file,
    [
      'OLD LINE 1',
      'OLD LINE 2',
      '[Manager] Server start requested at 2026-08-15 09:00:00',
      'OLD LINE 3',
      '====================',
      '[Manager] Server start requested at 2026-08-16 19:00:00',
      '====================',
      'NEW LINE 1',
      'NEW LINE 2',
      'NEW LINE 3',
    ].join('\n') + '\n',
    'utf8'
  );

  const res = readServerLogTail(makeServer(install), 0, { sessionStart: true });
  assert.ok(res.lines.length > 0, 'has lines');
  assert.ok(res.lines.some((l) => l.includes('NEW LINE 1')), 'current session line present');
  assert.ok(!res.lines.some((l) => l.includes('OLD LINE')), 'old session lines skipped');

  const res2 = readServerLogTail(makeServer(install), res.offset);
  assert.strictEqual(res2.lines.length, 0, 'no duplicates after returned offset');

  const plain = readServerLogTail(makeServer(install), 0);
  assert.ok(plain.lines.length > 0, 'plain tail works');
  assert.ok(plain.lines.some((l) => l.includes('NEW LINE 3')), 'plain tail ends with latest lines');

  fs.rmSync(root, { recursive: true, force: true });
});

test('readServerLogTail: missing file returns empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logtail-test2-'));
  const res = readServerLogTail(makeServer(path.join(root, 'nope')), 0, { sessionStart: true });
  assert.strictEqual(res.lines.length, 0);
  assert.strictEqual(res.offset, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
