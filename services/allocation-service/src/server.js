const { createApp } = require('./app');
const { loadConfig } = require('./config/env');

function startServer() {
  const config = loadConfig();
  const server = createApp().listen(config.port);
  server.once('listening', () => {
    console.log(`Allocation service listening on port ${config.port}.`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set a different ALLOCATION_PORT.`);
    } else {
      console.error('Allocation service could not start.');
    }
    process.exitCode = 1;
  });

  function shutdown() {
    server.close((error) => {
      if (error) {
        console.error('Allocation service could not close cleanly.');
        process.exitCode = 1;
      }
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { startServer };
