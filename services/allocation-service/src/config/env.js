const path = require('node:path');
const dotenv = require('dotenv');

const ROOT_ENV_PATH = path.resolve(__dirname, '../../../../.env');

function loadConfig({ env = process.env, envFile = ROOT_ENV_PATH } = {}) {
  const result = dotenv.config({ path: envFile, processEnv: env, override: false, quiet: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('Unable to read root environment file.');
  }

  const portValue = String(env.ALLOCATION_PORT ?? '4001');
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ALLOCATION_PORT must be an integer from 1 to 65535.');
  }

  const timezone = env.PROJECT_TIMEZONE ?? 'Asia/Colombo';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error('PROJECT_TIMEZONE must be a valid IANA timezone.');
  }

  return { port, timezone };
}

module.exports = { loadConfig, ROOT_ENV_PATH };
