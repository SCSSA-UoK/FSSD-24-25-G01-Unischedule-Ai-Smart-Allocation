const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, ROOT_ENV_PATH } = require('../config/env');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-env-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('root environment path is absolute and missing file uses service defaults', (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(ROOT_ENV_PATH, path.resolve(__dirname, '../../../../.env'));
  assert.ok(path.isAbsolute(ROOT_ENV_PATH));

  const config = loadConfig({ env: {}, envFile: path.join(directory, 'missing.env') });
  assert.equal(config.port, 4003);
  assert.equal(config.timezone, 'Asia/Colombo');
  assert.equal(config.operationsDb, 'operations_db');
  assert.equal(config.platformDb, 'platform_db');
  assert.equal(config.agentDb, 'agent_db');
  assert.equal(config.allocationDb, 'allocation_db');
  assert.equal(config.facilitiesDb, 'facilities_db');
  assert.equal(config.platformBaseUrl, 'http://localhost:8081');
  assert.equal(config.agentBaseUrl, 'http://localhost:8000');
  assert.equal(config.facilitiesBaseUrl, 'http://localhost:4002');
  assert.equal(config.useMockClients, true);
});

test('port validation accepts valid ports and rejects out-of-range values', async (t) => {
  const envFile = path.join(temporaryDirectory(t), 'missing.env');
  for (const port of ['1', '4003', '65535']) {
    await t.test(`accepts ${port}`, () => {
      assert.equal(loadConfig({ env: { OPERATIONS_PORT: port }, envFile }).port, Number(port));
    });
  }
  for (const port of ['', ' ', 'invalid', '0', '-5', '70000']) {
    await t.test(`rejects ${JSON.stringify(port)}`, () => {
      assert.throws(() => loadConfig({ env: { OPERATIONS_PORT: port }, envFile }), {
        message: 'OPERATIONS_PORT must be an integer from 1 to 65535.'
      });
    });
  }
});

test('timezone validation accepts valid IANA zones and rejects invalid ones', async (t) => {
  const envFile = path.join(temporaryDirectory(t), 'missing.env');
  for (const timezone of ['Asia/Colombo', 'UTC', 'America/New_York']) {
    await t.test(`accepts ${timezone}`, () => {
      assert.equal(loadConfig({ env: { PROJECT_TIMEZONE: timezone }, envFile }).timezone, timezone);
    });
  }
  for (const timezone of ['', 'Invalid/Zone', 'Moon/Crater']) {
    await t.test(`rejects ${JSON.stringify(timezone)}`, () => {
      assert.throws(() => loadConfig({ env: { PROJECT_TIMEZONE: timezone }, envFile }), {
        message: 'PROJECT_TIMEZONE must be a valid IANA timezone.'
      });
    });
  }
});
