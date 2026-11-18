const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { parseCandidateRequest } = require('../validation/allocation-input');

const contractPath = path.resolve(__dirname, '../../../../contracts/openapi/allocation.openapi.yaml');
const contract = YAML.parse(fs.readFileSync(contractPath, 'utf8'));
const requestSchema = contract.components.schemas.CandidateRequest;

function resolveReference(reference) {
  assert.ok(reference.startsWith('#/'), `Expected an internal reference: ${reference}`);
  return reference.slice(2).split('/').reduce((current, encodedKey) => {
    const key = encodedKey.replace(/~1/g, '/').replace(/~0/g, '~');
    assert.ok(current && Object.hasOwn(current, key), `Unresolved reference: ${reference}`);
    return current[key];
  }, contract);
}

function checkReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) resolveReference(value.$ref);
  for (const child of Object.values(value)) checkReferences(child);
}

function checkRequestKeys(request) {
  for (const key of Object.keys(request)) {
    assert.ok(Object.hasOwn(requestSchema.properties, key), `Undocumented request field: ${key}`);
  }
  for (const group of ['preferences', 'limits', 'searchWindow']) {
    if (request[group]) {
      for (const key of Object.keys(request[group])) {
        assert.ok(Object.hasOwn(requestSchema.properties[group].properties, key),
          `Undocumented ${group} field: ${key}`);
      }
    }
  }
}

test('draft OpenAPI identifies the implemented health route and keeps candidate APIs planned', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, '0.2.0');
  assert.equal(contract.servers[0].url, 'http://localhost:4001');
  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/allocation/candidates', '/allocation/score', '/health',
  ]);
  assert.equal(contract.paths['/health'].get['x-implementation-status'], 'implemented');
  for (const route of ['/allocation/candidates', '/allocation/score']) {
    const operation = contract.paths[route].post;
    assert.equal(operation['x-implementation-status'], 'planned');
    assert.match(operation.description, /404/);
  }
  assert.ok(Object.keys(contract.paths).every((route) => !/apply|bookings/i.test(route)));
});

test('every internal reference resolves, including shared error and trace header schemas', () => {
  checkReferences(contract);
  const health = contract.paths['/health'].get.responses['200'];
  assert.equal(resolveReference(health.headers['X-Request-Id'].$ref).schema.format, 'uuid');
  assert.deepEqual(health.content['application/json'].example, {
    status: 'ok', service: 'allocation-service',
  });
  assert.deepEqual(contract.components.schemas.Error.required, ['code', 'message', 'traceId']);
});

test('documented candidate request shape and bounds match the local input boundary', () => {
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, [
    'scenarioId', 'scenarioRevision', 'affectedSessionId', 'allowedMoveCount',
  ]);
  assert.equal(contract.components.schemas.Id.pattern, '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$');
  assert.equal(requestSchema.properties.scenarioRevision.minimum, 0);
  assert.equal(requestSchema.properties.scenarioRevision.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(requestSchema.properties.allowedMoveCount.minimum, 0);
  assert.equal(requestSchema.properties.allowedMoveCount.maximum, 3);
  const limits = requestSchema.properties.limits.properties;
  assert.deepEqual(limits.maxCandidates, { type: 'integer', minimum: 1, maximum: 50, default: 10 });
  assert.deepEqual(limits.timeoutMs, { type: 'integer', minimum: 1, maximum: 10000, default: 2000 });

  const example = contract.paths['/allocation/candidates'].post.requestBody.content['application/json'].example;
  checkRequestKeys(example);
  assert.doesNotThrow(() => parseCandidateRequest(structuredClone(example)));
  assert.deepEqual(contract.components.schemas.ValidationStatus.enum, ['pending', 'valid', 'invalid', 'stale']);
});

test('documented dated timestamps agree with whole-second offset input validation', () => {
  const timestampPattern = new RegExp(contract.components.schemas.OffsetDateTime.pattern);
  const example = contract.paths['/allocation/candidates'].post.requestBody.content['application/json'].example;
  const request = {
    ...example,
    searchWindow: {
      startAt: '2026-11-16T09:00:00+05:30',
      endAt: '2026-11-16T11:00:00+05:30',
    },
  };
  assert.match(request.searchWindow.startAt, timestampPattern);
  assert.doesNotThrow(() => parseCandidateRequest(request));
  for (const startAt of ['2026-11-16T09:00:00.500+05:30', '2026-11-16T09:00:00']) {
    assert.doesNotMatch(startAt, timestampPattern);
    assert.throws(() => parseCandidateRequest({
      ...request, searchWindow: { ...request.searchWindow, startAt },
    }));
  }
});

test('fictional fixture requests use documented fields and pass local request validation', () => {
  const fixturesPath = path.resolve(__dirname, '../../fixtures');
  const filenames = fs.readdirSync(fixturesPath).filter((name) => name.endsWith('.json')).sort();
  assert.ok(filenames.includes('single-relocation.json'));
  for (const filename of filenames) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesPath, filename), 'utf8'));
    assert.equal(fixture.mode, 'fixture', filename);
    assert.ok(fixture.request, `Missing request in ${filename}`);
    checkRequestKeys(fixture.request);
    assert.doesNotThrow(() => parseCandidateRequest(structuredClone(fixture.request)), filename);
    assert.equal(fixture.request.scenarioId, fixture.scenarioId, filename);
    assert.equal(fixture.request.scenarioRevision, fixture.scenarioRevision, filename);
  }
});
