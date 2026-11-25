const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const httpRequest = require('supertest');
const { createApp } = require('../app');
const { FIXTURE_NAMES, loadFixture } = require('../clients/fixture-clients');
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

function checkObjectFields(value, schema) {
  for (const field of schema.required || []) {
    assert.ok(Object.hasOwn(value, field), `Missing documented response field: ${field}`);
  }
  if (schema.additionalProperties === false) {
    for (const field of Object.keys(value)) {
      assert.ok(Object.hasOwn(schema.properties, field), `Undocumented response field: ${field}`);
    }
  }
}

test('draft OpenAPI identifies health and both candidate searches as implemented while scoring stays planned', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, '0.4.0');
  assert.equal(contract.servers[0].url, 'http://localhost:4001');
  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/allocation/candidates', '/allocation/room-swaps', '/allocation/score', '/health',
  ]);
  assert.equal(contract.paths['/health'].get['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/candidates'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/room-swaps'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/score'].post['x-implementation-status'], 'planned');
  assert.match(contract.paths['/allocation/score'].post.description, /404/);
  for (const route of ['/allocation/candidates', '/allocation/room-swaps']) {
    const responses = contract.paths[route].post.responses;
    for (const status of ['200', '400', '404', '409', '413', '415', '422', '503', '504', '500']) {
      assert.ok(responses[status], `Missing documented ${route} response: ${status}`);
    }
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

test('actual candidate responses follow documented fixture-only fields and direct-move bounds', async () => {
  const schemas = contract.components.schemas;
  const operation = contract.paths['/allocation/candidates'].post;
  const responseSchema = resolveReference(operation.responses['200'].content['application/json'].schema.$ref);
  const candidateSchema = resolveReference(responseSchema.properties.candidates.items.$ref);
  const moveSchema = resolveReference(candidateSchema.properties.moves.items.$ref);
  const roomSchema = resolveReference(responseSchema.properties.roomChecks.items.$ref);
  const idPattern = new RegExp(schemas.Id.pattern);
  const app = createApp();
  const runIds = new Set();

  assert.equal(candidateSchema.properties.moves.minItems, 1);
  assert.equal(candidateSchema.properties.moves.maxItems, 1);
  assert.equal(candidateSchema.properties.displacedExistingSessions.const, 0);
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    const response = await httpRequest(app).post('/allocation/candidates').send(fixture.request).expect(200);
    const result = response.body;
    checkObjectFields(result, responseSchema);
    assert.equal(typeof response.headers['x-request-id'], 'string');
    assert.match(result.runId, idPattern);
    assert.ok(!runIds.has(result.runId), 'Each response must identify a separate run');
    runIds.add(result.runId);
    for (const field of ['mode', 'scope', 'validationStatus']) {
      assert.equal(result[field], responseSchema.properties[field].const);
    }
    assert.equal(result.scenarioId, fixture.scenarioId);
    assert.equal(result.scenarioRevision, fixture.scenarioRevision);
    assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
    assert.equal(typeof result.truncated, 'boolean');
    assert.ok(result.candidates.length <= fixture.request.limits.maxCandidates);
    assert.ok(result.candidates.length <= responseSchema.properties.candidates.maxItems);
    assert.ok(result.roomChecks.length <= responseSchema.properties.roomChecks.maxItems);
    assert.ok(result.reasons.every((reason) => typeof reason === 'string'));

    const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
    const destinations = [];
    for (const candidate of result.candidates) {
      checkObjectFields(candidate, candidateSchema);
      assert.match(candidate.candidateId, idPattern);
      assert.equal(candidate.validationStatus, candidateSchema.properties.validationStatus.const);
      assert.equal(candidate.displacedExistingSessions, 0);
      assert.equal(candidate.moves.length, 1);
      assert.ok(candidate.reasons.every((reason) => typeof reason === 'string'));
      const move = candidate.moves[0];
      checkObjectFields(move, moveSchema);
      assert.equal(move.sessionId, target.sessionId);
      assert.equal(move.fromRoomId, target.roomId);
      assert.notEqual(move.toRoomId, move.fromRoomId);
      assert.ok(fixture.rooms.some((room) => room.roomId === move.toRoomId));
      assert.equal(move.startAt, target.startAt);
      assert.equal(move.endAt, target.endAt);
      destinations.push(move.toRoomId);
    }
    assert.deepEqual(destinations, [...destinations].sort());
    assert.deepEqual(destinations, [...fixture.expected.directRoomIds].sort());
    for (const room of result.roomChecks) {
      checkObjectFields(room, roomSchema);
      assert.notEqual(room.roomId, target.roomId);
      for (const field of ['suitable', 'available', 'eligible']) assert.equal(typeof room[field], 'boolean');
      assert.equal(room.eligible, room.suitable && room.available);
      assert.ok(Number.isInteger(room.effectiveUsableComputers));
      assert.ok(room.effectiveUsableComputers >= roomSchema.properties.effectiveUsableComputers.minimum);
      assert.ok(room.effectiveUsableComputers <= roomSchema.properties.effectiveUsableComputers.maximum);
      for (const field of ['missingFacilities', 'activeRestrictionIds', 'blockingSessionIds']) {
        assert.equal(new Set(room[field]).size, room[field].length);
        for (const id of room[field]) assert.match(id, idPattern);
      }
      for (const reason of room.reasons) {
        checkObjectFields(reason, roomSchema.properties.reasons.items);
        assert.ok(roomSchema.properties.reasons.items.properties.code.enum.includes(reason.code));
        assert.equal(typeof reason.message, 'string');
      }
    }
  }
});

test('actual relocation and literal swap responses follow the complete two-move contract', async () => {
  const operation = contract.paths['/allocation/room-swaps'].post;
  const responseSchema = resolveReference(operation.responses['200'].content['application/json'].schema.$ref);
  const candidateSchema = resolveReference(responseSchema.properties.candidates.items.$ref);
  const moveSchema = resolveReference(candidateSchema.properties.moves.items.$ref);
  const roomSchema = resolveReference(responseSchema.properties.roomChecks.items.$ref);
  const idPattern = new RegExp(contract.components.schemas.Id.pattern);
  const app = createApp();
  const example = operation.requestBody.content['application/json'].example;
  checkRequestKeys(example);
  assert.doesNotThrow(() => parseCandidateRequest(example));
  assert.equal(responseSchema.properties.scope.const, 'single-displacement');
  assert.equal(candidateSchema.properties.displacedExistingSessions.const, 1);
  assert.equal(candidateSchema.properties.moves.minItems, 2);
  assert.equal(candidateSchema.properties.moves.maxItems, 2);

  for (const [name, expectedKind] of [['single-relocation', 'relocation'], ['single-swap', 'swap']]) {
    const fixture = loadFixture(name);
    const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
    const response = await httpRequest(app).post('/allocation/room-swaps').send(fixture.request).expect(200);
    const result = response.body;
    checkObjectFields(result, responseSchema);
    assert.match(result.runId, idPattern);
    assert.equal(typeof response.headers['x-request-id'], 'string');
    for (const field of ['mode', 'scope', 'validationStatus']) {
      assert.equal(result[field], responseSchema.properties[field].const);
    }
    assert.equal(result.scenarioId, fixture.scenarioId);
    assert.equal(result.scenarioRevision, fixture.scenarioRevision);
    assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
    assert.equal(result.truncated, false);
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.length <= fixture.request.limits.maxCandidates);
    assert.ok(result.candidates.some((candidate) => candidate.kind === expectedKind));
    assert.ok(result.reasons.every((reason) => typeof reason === 'string'));
    for (const room of result.roomChecks) checkObjectFields(room, roomSchema);

    for (const candidate of result.candidates) {
      checkObjectFields(candidate, candidateSchema);
      assert.match(candidate.candidateId, idPattern);
      assert.equal(candidate.validationStatus, candidateSchema.properties.validationStatus.const);
      assert.equal(candidate.displacedExistingSessions, 1);
      assert.ok(candidateSchema.properties.kind.enum.includes(candidate.kind));
      assert.equal(candidate.moves.length, 2);
      assert.ok(candidate.reasons.every((reason) => typeof reason === 'string'));
      const [blockerMove, targetMove] = candidate.moves;
      assert.notEqual(blockerMove.sessionId, target.sessionId);
      assert.equal(targetMove.sessionId, target.sessionId);
      assert.equal(blockerMove.fromRoomId, targetMove.toRoomId);
      const isRoomExchange = target.roomId !== null && blockerMove.toRoomId === target.roomId;
      assert.equal(candidate.kind, isRoomExchange ? 'swap' : 'relocation');
      for (const move of candidate.moves) {
        checkObjectFields(move, moveSchema);
        const original = fixture.sessions.find((session) => session.sessionId === move.sessionId);
        assert.ok(original);
        assert.equal(move.fromRoomId, original.roomId);
        assert.notEqual(move.toRoomId, move.fromRoomId);
        assert.ok(fixture.rooms.some((room) => room.roomId === move.toRoomId));
        assert.equal(move.startAt, original.startAt);
        assert.equal(move.endAt, original.endAt);
      }
      // The diagnostic describes the occupied original room, not the copied final assignment.
      const originalRoomCheck = result.roomChecks.find((room) => room.roomId === targetMove.toRoomId);
      assert.ok(originalRoomCheck);
      assert.equal(originalRoomCheck.available, false);
      assert.deepEqual(originalRoomCheck.blockingSessionIds, [blockerMove.sessionId]);
    }
    const repeated = await httpRequest(app).post('/allocation/room-swaps').send(fixture.request).expect(200);
    assert.notEqual(repeated.body.runId, result.runId);
    assert.deepEqual(repeated.body.candidates, result.candidates);
  }
});

test('zero displacement allowance is a documented successful empty swap search', async () => {
  const fixture = loadFixture('single-relocation');
  const response = await httpRequest(createApp()).post('/allocation/room-swaps')
    .send({ ...fixture.request, allowedMoveCount: 0 }).expect(200);
  const result = response.body;
  checkObjectFields(result, contract.components.schemas.SwapResponse);
  assert.equal(result.scope, 'single-displacement');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.candidates, []);
  assert.ok(result.reasons.length > 0);
});

test('documented planned scoring endpoint still returns an unknown-route error', async () => {
  const operation = contract.paths['/allocation/score'].post;
  const example = operation.requestBody.content['application/json'].example;
  const response = await httpRequest(createApp()).post('/allocation/score').send(example).expect(404);
  const errorSchema = resolveReference(resolveReference(operation.responses['404'].$ref)
    .content['application/json'].schema.$ref);
  checkObjectFields(response.body, errorSchema);
  assert.equal(response.body.code, 'NOT_FOUND');
  assert.equal(response.body.traceId, response.headers['x-request-id']);
});
