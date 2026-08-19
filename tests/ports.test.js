const { test } = require('node:test');
const assert = require('node:assert');
const { serverPorts, parseNetstatText, parseNetstatLinuxText, parseTasklistText } = require('../dist-electron/ports.js');

function makeServer(port = 28015, rconPort = 28017) {
  return {
    id: 'srv1',
    identity: 'main',
    name: 'Test',
    installPath: '',
    port,
    seed: 1,
    worldSize: 4000,
    maxPlayers: 100,
    rconHost: '127.0.0.1',
    rconPort,
    rconPassword: 'secret',
    map: 'Procedural Map',
  };
}

test('serverPorts: default game/query/rcon', () => {
  const ports = serverPorts(makeServer());
  assert.strictEqual(ports.length, 3);
  const game = ports.find((p) => p.key === 'game');
  assert.strictEqual(game.port, 28015);
  assert.strictEqual(game.protocol, 'UDP');
  const query = ports.find((p) => p.key === 'query');
  assert.strictEqual(query.port, 28016);
  assert.strictEqual(query.protocol, 'UDP');
  const rcon = ports.find((p) => p.key === 'rcon');
  assert.strictEqual(rcon.port, 28017);
  assert.strictEqual(rcon.protocol, 'TCP');
});

test('serverPorts: custom port / rconPort', () => {
  const ports = serverPorts(makeServer(30000, 30007));
  assert.strictEqual(ports.find((p) => p.key === 'game').port, 30000);
  assert.strictEqual(ports.find((p) => p.key === 'query').port, 30001);
  assert.strictEqual(ports.find((p) => p.key === 'rcon').port, 30007);
});

test('parseNetstatText: TCP LISTENING vs TIME_WAIT, UDP', () => {
  const text = [
    '  TCP    0.0.0.0:28017   0.0.0.0:0    LISTENING       4321',
    '  TCP    127.0.0.1:28015 0.0.0.0:0    TIME_WAIT       0',
    '  UDP    0.0.0.0:28016   *:*   5678',
    'Header line',
  ].join('\n');
  const map = parseNetstatText(text);
  const tcp = map.get('TCP:28017');
  assert.ok(tcp && tcp.pid === 4321 && tcp.listening === true, 'TCP LISTENING parsed');
  const udp = map.get('UDP:28016');
  assert.ok(udp && udp.pid === 5678 && udp.listening === true, 'UDP parsed as listening');
  const tcpWait = map.get('TCP:28015');
  assert.ok(tcpWait && tcpWait.listening === false, 'TIME_WAIT is not listening');
});

test('serverPorts: custom queryport', () => {
  const ports = serverPorts({ ...makeServer(), queryport: 30002 });
  assert.strictEqual(ports.find((p) => p.key === 'query').port, 30002);
});

test('parseNetstatLinuxText: netstat -tunlp', () => {
  const text = [
    'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
    'tcp        0      0 0.0.0.0:28017           0.0.0.0:*               LISTEN      4321/RustDedicated',
    'udp        0      0 0.0.0.0:28015           0.0.0.0:*                           5678/RustDedicated',
    'udp        0      0 0.0.0.0:28016           0.0.0.0:*                           -',
  ].join('\n');
  const map = parseNetstatLinuxText(text);
  const tcp = map.get('TCP:28017');
  assert.ok(tcp && tcp.pid === 4321 && tcp.listening === true, 'TCP parsed');
  const udp = map.get('UDP:28015');
  assert.ok(udp && udp.pid === 5678 && udp.listening === true, 'UDP parsed');
  assert.ok(!map.has('UDP:28016'), 'no PID (root required) → not attributed');
});

test('parseTasklistText: PID → process name', () => {
  const text = [
    '"RustDedicatedServer.exe","4321","Console","1","1,234 K"',
    '"svchost.exe","5678","Services","0","12 K"',
  ].join('\n');
  const map = parseTasklistText(text);
  assert.strictEqual(map.get(4321), 'RustDedicatedServer.exe');
  assert.strictEqual(map.get(5678), 'svchost.exe');
});
