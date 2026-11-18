const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, ROOT_ENV_PATH } = require('../config/env');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'allocation-env-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('root environment path is absolute and a missing file uses service defaults', (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(ROOT_ENV_PATH, path.resolve(__dirname, '../../../../.env'));
  assert.ok(path.isAbsolute(ROOT_ENV_PATH));

  const config = loadConfig({ env: {}, envFile: path.join(directory, 'missing.env') });
  assert.deepEqual(config, { port: 4001, timezone: 'Asia/Colombo' });
});

test('environment files supply settings while injected environment values take precedence', (t) => {
  const directory = temporaryDirectory(t);
  const envFile = path.join(directory, '.env');
  fs.writeFileSync(envFile, 'ALLOCATION_PORT=4101\nPROJECT_TIMEZONE=Asia/Colombo\n');

  assert.deepEqual(loadConfig({ env: {}, envFile }), {
    port: 4101,
    timezone: 'Asia/Colombo',
  });
  assert.deepEqual(loadConfig({ env: { ALLOCATION_PORT: '4201' }, envFile }), {
    port: 4201,
    timezone: 'Asia/Colombo',
  });
  assert.deepEqual(loadConfig({
    env: { ALLOCATION_PORT: '4201', PROJECT_TIMEZONE: 'Europe/London' },
    envFile,
  }), { port: 4201, timezone: 'Europe/London' });
});

test('port validation accepts integer boundaries and rejects blank, fractional and out-of-range values', async (t) => {
  const envFile = path.join(temporaryDirectory(t), 'missing.env');
  for (const port of ['1', '4001', '65535']) {
    await t.test(`accepts ${port}`, () => {
      assert.equal(loadConfig({ env: { ALLOCATION_PORT: port }, envFile }).port, Number(port));
    });
  }
  for (const port of ['', ' ', '1.5', 'invalid', '4001abc', '0', '-1', '65536']) {
    await t.test(`rejects ${JSON.stringify(port)}`, () => {
      assert.throws(() => loadConfig({ env: { ALLOCATION_PORT: port }, envFile }), {
        message: 'ALLOCATION_PORT must be an integer from 1 to 65535.',
      });
    });
  }
});

test('timezone validation accepts known IANA values and rejects explicit invalid values', async (t) => {
  const envFile = path.join(temporaryDirectory(t), 'missing.env');
  for (const timezone of ['Asia/Colombo', 'UTC', 'Europe/London']) {
    await t.test(`accepts ${timezone}`, () => {
      assert.equal(loadConfig({ env: { PROJECT_TIMEZONE: timezone }, envFile }).timezone, timezone);
    });
  }
  for (const timezone of ['', 'Definitely/Unknown', 'Mars/Olympus_Mons']) {
    await t.test(`rejects ${JSON.stringify(timezone)}`, () => {
      assert.throws(() => loadConfig({ env: { PROJECT_TIMEZONE: timezone }, envFile }), {
        message: 'PROJECT_TIMEZONE must be a valid IANA timezone.',
      });
    });
  }
});

test('a non-missing environment file read failure is reported without filesystem details', (t) => {
  const directory = temporaryDirectory(t);
  assert.throws(() => loadConfig({ env: {}, envFile: directory }), {
    message: 'Unable to read root environment file.',
  });
});
