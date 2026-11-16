const { randomUUID } = require('node:crypto');

function traceId(request, response, next) {
  response.locals.traceId = randomUUID();
  response.set('X-Request-Id', response.locals.traceId);
  next();
}

module.exports = { traceId };
