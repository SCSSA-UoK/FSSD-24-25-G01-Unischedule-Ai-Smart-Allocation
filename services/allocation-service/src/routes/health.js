const express = require('express');

const healthRouter = express.Router();

// Liveness only: database and upstream connectivity are not checked here.
healthRouter.get('/health', (request, response) => {
  response.json({ status: 'ok', service: 'allocation-service' });
});

module.exports = { healthRouter };
