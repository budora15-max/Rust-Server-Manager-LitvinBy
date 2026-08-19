const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { TaskScheduler, nextDailyAt, nextWeeklyAt } = require('../dist-electron/tasks.js');

function makeServer(id) {
  return {
    id,
    identity: 'test',
    name: 'Test',
    installPath: '',
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

test('nextDailyAt: earlier/later/equal times', () => {
  const d1 = nextDailyAt('06:00', new Date(2026, 0, 10, 10, 0, 0));
  assert.strictEqual(d1.getDate(), 11);
  assert.strictEqual(d1.getHours(), 6);

  const d2 = nextDailyAt('22:00', new Date(2026, 0, 10, 10, 0, 0));
  assert.strictEqual(d2.getDate(), 10);
  assert.strictEqual(d2.getHours(), 22);

  const d3 = nextDailyAt('10:00', new Date(2026, 0, 10, 10, 0, 0));
  assert.strictEqual(d3.getDate(), 11);
});

test('nextWeeklyAt: Friday from Saturday', () => {
  const dw = nextWeeklyAt(5, '06:00', new Date(2026, 0, 10, 10, 0, 0));
  assert.strictEqual(dw.getDay(), 5);
  assert.strictEqual(dw.getHours(), 6);
  assert.ok(dw.getTime() > Date.parse('2026-01-10T10:00:00'));
});

test('addRestart: restart + warnings, persisted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test-'));
  const file = path.join(dir, 'tasks.json');
  const s = new TaskScheduler(file, { onRestart() {}, onWarning() {}, onBackup() {}, onUnban() {} });

  const created = s.addRestart({
    serverId: 'srv1',
    server: makeServer('srv1'),
    time: '06:00',
    warnMinutes: [5, 1],
    warnMessages: ['in 5', 'in 1'],
  });
  assert.strictEqual(created.length, 3, 'restart + 2 warnings');

  const list = s.list();
  const restart = list.find((t) => t.type === 'restart');
  assert.ok(restart, 'has restart task');
  assert.ok(Date.parse(restart.nextRun) > Date.now(), 'restart in the future');
  assert.strictEqual(new Date(restart.nextRun).getHours(), 6);

  const warn5 = list.find((t) => t.warnMessage === 'in 5');
  assert.ok(warn5, 'warn 5 task exists');
  assert.strictEqual(Date.parse(restart.nextRun) - Date.parse(warn5.nextRun), 5 * 60000);

  const warn1 = list.find((t) => t.warnMessage === 'in 1');
  assert.ok(warn1, 'warn 1 task exists');
  assert.strictEqual(Date.parse(restart.nextRun) - Date.parse(warn1.nextRun), 1 * 60000);

  const s2 = new TaskScheduler(file, { onRestart() {}, onWarning() {}, onBackup() {}, onUnban() {} });
  s2.load();
  assert.strictEqual(s2.list().length, s.list().length);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('overdue warning is skipped when too late', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test2-'));
  const s = new TaskScheduler(
    path.join(dir, 't.json'),
    { onRestart() {}, onWarning() {}, onBackup() {}, onUnban() {} }
  );
  const soon = new Date(Date.now() + 6 * 60_000);
  const soonTime = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  const created = s.addRestart({
    serverId: 'srv2',
    server: makeServer('srv2'),
    time: soonTime,
    warnMinutes: [10, 1],
    warnMessages: ['in10', 'in1'],
  });
  assert.strictEqual(created.length, 2, 'warn10 in the past skipped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('addBackup hourly nextRun', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test3-'));
  const s = new TaskScheduler(
    path.join(dir, 't.json'),
    { onRestart() {}, onWarning() {}, onBackup() {}, onUnban() {} }
  );
  const backup = s.addBackup({
    serverId: 'srv1',
    server: makeServer('srv1'),
    frequency: 'hourly',
    everyHours: 2,
    retention: 3,
    label: 'x',
  });
  const diff = Date.parse(backup.nextRun) - Date.now();
  assert.ok(diff >= 2 * 3600 * 1000 - 5000 && diff <= 2 * 3600 * 1000 + 5000, '~2h');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tick: one-shot fired and removed, repeating rescheduled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test4-'));
  const calls = { restart: 0, warn: 0, unban: 0 };
  const s = new TaskScheduler(
    path.join(dir, 't.json'),
    {
      onRestart() { calls.restart += 1; },
      onWarning() { calls.warn += 1; },
      onBackup() {},
      onUnban() { calls.unban += 1; },
    }
  );
  const server = makeServer('srv1');

  s.add({ ...server, id: 'owarn', serverId: 'srv1', type: 'restartwarn', nextRun: new Date(Date.now() - 1000).toISOString(), createdAt: Date.now(), server, warnMessage: 'x' });
  s.add({ id: 'oban', serverId: 'srv1', type: 'unban', nextRun: new Date(Date.now() - 1000).toISOString(), createdAt: Date.now(), server, steamId: '76561198000000000', playerName: 'test' });
  s.tick();
  assert.strictEqual(calls.warn, 1);
  assert.strictEqual(calls.unban, 1);
  assert.ok(!s.list().find((t) => t.id === 'owarn'));
  assert.ok(!s.list().find((t) => t.id === 'oban'));

  s.add({ id: 'orestart', serverId: 'srv1', type: 'restart', nextRun: new Date(Date.now() - 1000).toISOString(), createdAt: Date.now(), server, time: '06:00' });
  const before = calls.restart;
  s.tick();
  assert.strictEqual(calls.restart, before + 1, 'restart fired');
  const rAfter = s.list().find((t) => t.id === 'orestart');
  assert.ok(rAfter && Date.parse(rAfter.nextRun) > Date.now(), 'rescheduled to future');

  fs.rmSync(dir, { recursive: true, force: true });
});
