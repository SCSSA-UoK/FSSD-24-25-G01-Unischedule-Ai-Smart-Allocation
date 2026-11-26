const express = require('express');
const { healthRouter } = require('./routes/health');
const { createCandidateRouter } = require('./routes/candidates');
const { traceId } = require('./middleware/trace-id');
const { notFound, errorHandler } = require('./middleware/error-handler');

function createApp({ clients, searchOptions, validationClient, validationOptions } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(traceId);
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter);
  app.use(createCandidateRouter({ clients, searchOptions, validationClient, validationOptions }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
