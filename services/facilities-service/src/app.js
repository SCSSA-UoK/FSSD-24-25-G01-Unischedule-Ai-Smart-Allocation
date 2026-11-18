const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  return app;
}

module.exports = { createApp };
