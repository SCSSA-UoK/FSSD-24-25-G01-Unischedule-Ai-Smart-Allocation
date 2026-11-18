const crypto = require('node:crypto');

function traceId(request, response, next) {
  const incoming = request.header('x-trace-id');
  const trace = incoming && incoming.trim() !== '' ? incoming : `trace-${crypto.randomUUID()}`;
  response.locals.traceId = trace;
  response.setHeader('X-Trace-Id', trace);
  next();
}

module.exports = { traceId };
