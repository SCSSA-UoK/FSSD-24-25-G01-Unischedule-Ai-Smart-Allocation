const path = require('node:path');
const dotenv = require('dotenv');

const ROOT_ENV_PATH = path.resolve(__dirname, '../../../../.env');

function loadConfig({ env = process.env, envFile = ROOT_ENV_PATH } = {}) {
  const result = dotenv.config({ path: envFile, processEnv: env, override: false, quiet: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('Unable to read root environment file.');
  }

  const portValue = String(env.OPERATIONS_PORT ?? '4003');
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('OPERATIONS_PORT must be an integer from 1 to 65535.');
  }

  const timezone = env.PROJECT_TIMEZONE ?? 'Asia/Colombo';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error('PROJECT_TIMEZONE must be a valid IANA timezone.');
  }

  return {
    port,
    timezone,
    mongoUri: env.MONGODB_URI ?? 'mongodb://localhost:27017',
    operationsDb: env.OPERATIONS_DB ?? 'operations_db',
    platformDb: env.PLATFORM_DB ?? 'platform_db',
    agentDb: env.AGENT_DB ?? 'agent_db',
    allocationDb: env.ALLOCATION_DB ?? 'allocation_db',
    facilitiesDb: env.FACILITIES_DB ?? 'facilities_db',
    platformBaseUrl: env.PLATFORM_BASE_URL ?? 'http://localhost:8081',
    agentBaseUrl: env.AGENT_BASE_URL ?? 'http://localhost:8000',
    facilitiesBaseUrl: env.FACILITIES_BASE_URL ?? 'http://localhost:4002',
    useMockClients: (env.USE_MOCK_CLIENTS ?? 'true') === 'true'
  };
}

module.exports = { loadConfig, ROOT_ENV_PATH };
