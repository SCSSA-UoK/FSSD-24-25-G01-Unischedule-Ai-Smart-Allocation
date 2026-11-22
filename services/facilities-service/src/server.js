const mongoose = require('mongoose');
const { createApp } = require('./app');
const { loadConfig } = require('./config/env');
const { connectDatabase, databaseErrorMessage } = require('./config/database');

async function startServer() {
  // Configuration errors are authored locally and never include supplied values.
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase(config);
  } catch (error) {
    console.error(databaseErrorMessage(error));
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
    return;
  }

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listener = createApp().listen(config.port);
      listener.once('error', reject);
      listener.once('listening', () => {
        listener.removeListener('error', reject);
        resolve(listener);
      });
    });
  } catch (error) {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Set a different FACILITIES_PORT.`
      : 'Facilities service could not start its HTTP listener.');
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
    return;
  }

  console.log(`Facilities service listening on port ${config.port}.`);
  async function shutdown() {
    server.close(async (error) => {
      try {
        await mongoose.disconnect();
        if (error) throw error;
      } catch {
        console.error('Facilities service could not close cleanly.');
        process.exitCode = 1;
      }
    });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startServer().catch(() => {
    console.error('Facilities service startup failed.');
    process.exitCode = 1;
  });
}

module.exports = { startServer };
