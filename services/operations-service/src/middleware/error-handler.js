function notFound(request, response) {
  response.status(404).json({
    code: 'NOT_FOUND',
    message: 'Route not found.',
    traceId: response.locals.traceId
  });
}

function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    return next(error);
  }

  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || 'An unexpected error occurred.';

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body exceeds the allowed limit.';
  }

  const payload = {
    code,
    message,
    traceId: response.locals.traceId
  };

  if (error.details) {
    payload.details = error.details;
  }

  return response.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
