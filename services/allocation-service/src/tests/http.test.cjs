const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../app');
const { errorHandler } = require('../middleware/error-handler');

test('health identifies the service and generates a different trace ID for each request', async () => {
  const app = createApp();
  const first = await request(app).get('/health').expect(200);
  const second = await request(app).get('/health').expect(200);

  assert.deepEqual(first.body, { status: 'ok', service: 'allocation-service' });
  assert.equal(typeof first.headers['x-request-id'], 'string');
  assert.ok(first.headers['x-request-id'].length > 0);
  assert.equal(typeof second.headers['x-request-id'], 'string');
  assert.ok(second.headers['x-request-id'].length > 0);
  assert.notEqual(first.headers['x-request-id'], second.headers['x-request-id']);
});

test('unknown routes return a consistent JSON error linked to the response trace ID', async () => {
  const response = await request(createApp())
    .get('/allocation/does-not-exist')
    .expect('Content-Type', /json/)
    .expect(404);

  assert.ok(response.headers['x-request-id']);
  assert.deepEqual(response.body, {
    code: 'NOT_FOUND',
    message: 'Route not found.',
    traceId: response.headers['x-request-id'],
  });
});

test('malformed JSON returns a controlled 400 instead of an internal error', async () => {
  const response = await request(createApp())
    .post('/allocation/candidates')
    .set('Content-Type', 'application/json')
    .send('{"scenarioId":')
    .expect('Content-Type', /json/)
    .expect(400);

  assert.equal(response.body.code, 'INVALID_JSON');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
});

test('JSON exceeding the 100kb limit is rejected with a controlled 413', async () => {
  const response = await request(createApp())
    .post('/allocation/candidates')
    .send({ padding: 'x'.repeat(101 * 1024) })
    .expect('Content-Type', /json/)
    .expect(413);

  assert.equal(response.body.code, 'PAYLOAD_TOO_LARGE');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
});

test('unsupported body encoding returns a controlled 415', async () => {
  const response = await request(createApp())
    .post('/allocation/candidates')
    .set('Content-Type', 'application/json')
    .set('Content-Encoding', 'unsupported')
    .send('{}')
    .expect('Content-Type', /json/)
    .expect(415);

  assert.equal(response.body.code, 'UNSUPPORTED_ENCODING');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
});

test('unexpected errors expose a generic response without internal messages or stacks', async () => {
  const app = express();
  app.use((req, res, next) => {
    res.locals.traceId = 'test-trace';
    next();
  });
  app.get('/failure', (req, res, next) => {
    next(new Error('Private database connection details'));
  });
  app.use(errorHandler);

  const response = await request(app).get('/failure').expect(500);
  assert.deepEqual(response.body, {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    traceId: 'test-trace',
  });
});
