const { createApp } = require('./app');
const { loadConfig } = require('./config/env');
const { connectDb, disconnectDb } = require('./config/db');

async function startServer() {
  const config = loadConfig();
  await connectDb(config);

  const server = createApp().listen(config.port);

  server.once('listening', () => {
    console.log(`Operations service listening on port ${config.port}.`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set a different OPERATIONS_PORT.`);
    } else {
      console.error('Operations service could not start.');
    }
    process.exitCode = 1;
  });

  async function shutdown() {
    await disconnectDb();
    server.close((error) => {
      if (error) {
        console.error('Operations service could not close cleanly.');
        process.exitCode = 1;
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
