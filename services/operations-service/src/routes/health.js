const express = require('express');

const healthRouter = express.Router();

healthRouter.get('/health', (request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'operations-service',
    timestamp: new Date().toISOString(),
    traceId: response.locals.traceId
  });
});

module.exports = { healthRouter };
