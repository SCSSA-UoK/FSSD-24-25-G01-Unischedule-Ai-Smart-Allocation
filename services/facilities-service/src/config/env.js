const path = require('node:path');
const dotenv = require('dotenv');

const ROOT_ENV_PATH = path.resolve(__dirname, '../../../../.env');

function loadConfig({ env = process.env, envFile = ROOT_ENV_PATH } = {}) {
  const result = dotenv.config({ path: envFile, processEnv: env, override: false, quiet: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('Unable to read root environment file.');
  }

  const uri = env.MONGODB_URI;
  try {
    const parsed = new URL(uri);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error();
    }
  } catch {
    throw new Error('MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.');
  }

  const dbName = env.FACILITIES_DB;
  if (typeof dbName !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(dbName)) {
    throw new Error('FACILITIES_DB must contain 1–63 letters, numbers, underscores or hyphens.');
  }

  const portValue = String(env.FACILITIES_PORT ?? '4002');
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FACILITIES_PORT must be an integer from 1 to 65535.');
  }

  return { uri, dbName, port };
}

module.exports = { loadConfig, ROOT_ENV_PATH };
