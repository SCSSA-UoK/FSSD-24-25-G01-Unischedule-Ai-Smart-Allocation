const express = require('express');
const { healthRouter } = require('./routes/health');
const { createCandidateRouter } = require('./routes/candidates');
const { createResultRouter } = require('./routes/results');
const { traceId } = require('./middleware/trace-id');
const { notFound, errorHandler } = require('./middleware/error-handler');

function createApp({ clients, searchOptions, validationClient, validationOptions, runStore } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(traceId);
  app.use((request, response, next) => {
    if (request.method === 'POST') {
      response.set('X-Allocation-Persistence', runStore ? 'enabled' : 'disabled');
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter);
  app.use(createCandidateRouter({ clients, searchOptions, validationClient, validationOptions, runStore }));
  app.use(createResultRouter({ runStore }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
