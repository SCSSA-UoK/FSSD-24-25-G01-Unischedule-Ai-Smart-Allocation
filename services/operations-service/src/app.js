const express = require('express');
const { traceId } = require('./middleware/trace-id');
const { notFound, errorHandler } = require('./middleware/error-handler');
const { healthRouter } = require('./routes/health');
const { disruptionsRouter } = require('./routes/disruptions');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(traceId);
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter);
  app.use(disruptionsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
