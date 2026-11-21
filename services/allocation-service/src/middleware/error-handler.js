const { AllocationInputError } = require('../validation/allocation-input');

function notFound(request, response) {
  response.status(404).json({
    code: 'NOT_FOUND',
    message: 'Route not found.',
    traceId: response.locals.traceId,
  });
}

function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    return next(error);
  }

  if (error instanceof AllocationInputError
      && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    const body = { code: error.code, message: error.message, traceId: response.locals.traceId };
    if (error.details !== undefined) body.details = error.details;
    return response.status(error.status).json(body);
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body exceeds the 100kb limit.';
  } else if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
    status = 415;
    code = 'UNSUPPORTED_ENCODING';
    message = 'Request body encoding is not supported.';
  }

  return response.status(status).json({
    code,
    message,
    traceId: response.locals.traceId,
  });
}

module.exports = { notFound, errorHandler };
