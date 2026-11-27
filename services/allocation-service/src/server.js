const { createApp } = require('./app');
const { loadConfig } = require('./config/env');
const { createValidationClientFromEnv } = require('./clients/platform-validation-client');
const { createRunStoreFromEnv } = require('./models/mongo-run-store');

async function startServer({ env = process.env, envFile } = {}) {
  const config = loadConfig({ env, envFile });
  const validationClient = createValidationClientFromEnv(env);
  const runStore = await createRunStoreFromEnv(env);
  const server = createApp({ validationClient, runStore }).listen(config.port);
  server.once('listening', () => {
    console.log(`Allocation service listening on port ${config.port}. Fixture data mode.`);
  });

  server.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set a different ALLOCATION_PORT.`);
    } else {
      console.error('Allocation service could not start.');
    }
    process.exitCode = 1;
    if (runStore) await runStore.close().catch(() => {});
  });

  function shutdown() {
    server.close(async (error) => {
      if (error) {
        console.error('Allocation service could not close cleanly.');
        process.exitCode = 1;
      }
      if (runStore) {
        try { await runStore.close(); } catch {
          console.error('Allocation result storage could not close cleanly.');
          process.exitCode = 1;
        }
      }
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
