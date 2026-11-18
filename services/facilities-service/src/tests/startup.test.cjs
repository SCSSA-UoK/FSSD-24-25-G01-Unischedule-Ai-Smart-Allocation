const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const mongoose = require('mongoose');
const { loadConfig, ROOT_ENV_PATH } = require('../config/env');
const { databaseErrorMessage } = require('../config/database');

test('configuration validates required values, defaults and process overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facilities-config-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'MONGODB_URI=mongodb://localhost:27017\nFACILITIES_DB=from_file\n');
  try {
    const config = loadConfig({ env: { FACILITIES_DB: 'from_process' }, envFile });
    assert.equal(config.dbName, 'from_process');
    assert.equal(config.port, 4002);
    assert.equal(ROOT_ENV_PATH, path.resolve(__dirname, '../../../../.env'));
    const valid = { MONGODB_URI: 'mongodb://localhost:27017', FACILITIES_DB: 'facilities_db' };
    for (const invalid of [
      { MONGODB_URI: '' }, { MONGODB_URI: 'https://example.com' },
      { FACILITIES_DB: '' }, { FACILITIES_DB: 'bad/name' },
      { FACILITIES_PORT: '0' }, { FACILITIES_PORT: '65536' }, { FACILITIES_PORT: 'abc' },
    ]) {
      assert.throws(() => loadConfig({ env: { ...valid, ...invalid }, envFile }));
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('database errors report categories without driver messages or credentials', () => {
  const secret = 'mongodb+srv://example_user:example_password@example.invalid';
  const cases = [
    [{ code: 18 }, /authentication/],
    [{ code: 13 }, /authorization/],
    [{ code: 'ECONNREFUSED', syscall: 'querySrv' }, /DNS/],
    [{ code: 'CERT_HAS_EXPIRED' }, /TLS/],
    [{ name: 'MongooseServerSelectionError' }, /server selection/],
    [{ name: 'MongoParseError' }, /configuration/],
    [{}, /connection or ping/],
  ];
  for (const [error, category] of cases) {
    const message = databaseErrorMessage({ ...error, message: secret });
    assert.match(message, category);
    assert.ok(!message.includes(secret));
    assert.ok(!message.includes('example_password'));
  }
});

test('startup connects with dbName, pings before HTTP, and never listens on failure', async (t) => {
  const { createApp } = require('../app');
  const appModule = require('../app');
  const originalDb = mongoose.connection.db;
  const previousEnv = { ...process.env };
  const previousExitCode = process.exitCode;
  const events = [];
  const logs = [];
  t.mock.method(console, 'log', (message) => logs.push(message));
  t.mock.method(console, 'error', (message) => logs.push(message));
  process.env.MONGODB_URI = 'mongodb://localhost:27017';
  process.env.FACILITIES_DB = 'startup_test';
  process.env.FACILITIES_PORT = '4002';
  t.mock.method(mongoose, 'connect', async (_uri, options) => {
    assert.equal(options.dbName, 'startup_test');
    events.push('connect');
  });
  t.mock.method(mongoose, 'disconnect', async () => events.push('disconnect'));
  let failPing = false;
  mongoose.connection.db = { command: async (command) => {
    assert.deepEqual(command, { ping: 1 });
    events.push('ping');
    if (failPing) throw new Error('private driver details');
    return { ok: 1 };
  } };
  t.mock.method(appModule, 'createApp', () => {
    events.push('app');
    const app = createApp();
    const listen = app.listen.bind(app);
    app.listen = () => { events.push('listen'); return listen(0, '127.0.0.1'); };
    return app;
  });
  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const { startServer } = require('../server');
  const beforeInt = process.listeners('SIGINT');
  const beforeTerm = process.listeners('SIGTERM');
  let server;
  try {
    server = await startServer();
    assert.deepEqual(events, ['connect', 'ping', 'app', 'listen']);
    assert.ok(logs.some((line) => line.includes('ping succeeded')));
    await new Promise((resolve) => server.close(resolve));
    events.length = 0;
    logs.length = 0;
    failPing = true;
    assert.equal(await startServer(), undefined);
    assert.deepEqual(events, ['connect', 'ping', 'disconnect']);
    assert.equal(process.exitCode, 1);
    assert.ok(!logs.join('\n').includes('private driver details'));
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const fn of process.listeners('SIGINT')) if (!beforeInt.includes(fn)) process.removeListener('SIGINT', fn);
    for (const fn of process.listeners('SIGTERM')) if (!beforeTerm.includes(fn)) process.removeListener('SIGTERM', fn);
    mongoose.connection.db = originalDb;
    for (const key of ['MONGODB_URI', 'FACILITIES_DB', 'FACILITIES_PORT']) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    process.exitCode = previousExitCode;
    delete require.cache[serverPath];
  }
});
