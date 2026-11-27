const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const httpRequest = require('supertest');
const { createApp } = require('../app');
const { FIXTURE_NAMES, loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { parseCandidateRequest } = require('../validation/allocation-input');
const { createCandidateId } = require('../algorithms/candidate-id');

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

function fixtureValidator(proposals = []) {
  return {
    source: 'fixture',
    async validateProposal(proposal) {
      proposals.push(structuredClone(proposal));
      return {
        ...proposal,
        validationStatus: 'valid',
        validationReference: 'fixture-validation-001',
        validatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        conflicts: [],
      };
    },
  };
}

// A transport-contract fake, not a MongoDB or restart-durability demonstration.
function contractRunStore() {
  const records = new Map();
  return {
    async save(record) {
      records.set(record.runId, structuredClone(record));
      return structuredClone(record);
    },
    async findById(runId) {
      return records.has(runId) ? structuredClone(records.get(runId)) : null;
    },
  };
}

test('draft OpenAPI identifies the implemented routes without claiming a live Platform peer', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, '0.7.0');
  assert.equal(contract.servers[0].url, 'http://localhost:4001');
  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/allocation/candidates', '/allocation/results/{runId}', '/allocation/room-swaps',
    '/allocation/score', '/allocation/validate', '/health',
  ]);
  assert.equal(contract.paths['/health'].get['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/candidates'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/room-swaps'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/score'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/validate'].post['x-implementation-status'], 'implemented');
  assert.equal(contract.paths['/allocation/validate'].post['x-peer-contract-status'], 'proposed');
  assert.equal(contract.paths['/allocation/results/{runId}'].get['x-implementation-status'], 'implemented');
  for (const route of ['/allocation/candidates', '/allocation/room-swaps', '/allocation/score']) {
    const responses = contract.paths[route].post.responses;
    for (const status of ['200', '400', '404', '409', '413', '415', '422', '503', '504', '500']) {
      assert.ok(responses[status], `Missing documented ${route} response: ${status}`);
    }
    for (const header of ['X-Allocation-Persistence', 'X-Allocation-Run-Id', 'Location']) {
      assert.ok(responses['200'].headers[header], `Missing documented ${route} header: ${header}`);
    }
  }
  assert.ok(contract.paths['/allocation/validate'].post.responses['502']);
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
    assert.equal(response.headers['x-allocation-persistence'], 'disabled');
    assert.equal(response.headers['x-allocation-run-id'], undefined);
    assert.equal(response.headers.location, undefined);
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

test('documented scoring input accepts bounded explicit plans rather than IDs for lookup', () => {
  const schemas = contract.components.schemas;
  const schema = schemas.ScoreRequest;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'scenarioId', 'scenarioRevision', 'facilitiesVersion', 'affectedSessionId', 'allowedMoveCount', 'candidates',
  ]);
  assert.equal(schema.properties.candidateIds, undefined);
  assert.equal(schema.properties.scenarioRevision.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.properties.candidates.minItems, 0);
  assert.equal(schema.properties.candidates.maxItems, 50);
  const submitted = resolveReference(schema.properties.candidates.items.$ref);
  assert.equal(submitted.additionalProperties, false);
  assert.deepEqual(submitted.required, ['candidateId', 'moves']);
  assert.equal(submitted.properties.moves.minItems, 1);
  assert.equal(submitted.properties.moves.maxItems, 2);
  const example = contract.paths['/allocation/score'].post.requestBody.content['application/json'].example;
  checkObjectFields(example, schema);
  for (const candidate of example.candidates) checkObjectFields(candidate, submitted);
  assert.deepEqual(schemas.ScoringPolicy.properties.weights.required, [
    'displacedExistingSessions', 'timeChangedSessions', 'buildingChangedSessions', 'totalUnusedSeats',
  ]);
});

test('actual scores match the documented fixed policy, counts, contributions and pending metadata', async () => {
  const operation = contract.paths['/allocation/score'].post;
  const responseSchema = resolveReference(operation.responses['200'].content['application/json'].schema.$ref);
  const rankedSchema = resolveReference(responseSchema.properties.rankedCandidates.items.$ref);
  const policySchema = resolveReference(responseSchema.properties.scoringPolicy.$ref);
  const breakdownSchema = resolveReference(rankedSchema.properties.costBreakdown.$ref);
  const app = createApp();
  const example = operation.requestBody.content['application/json'].example;
  const exampleResponse = await httpRequest(app).post('/allocation/score').send(example).expect(200);
  assert.equal(exampleResponse.body.rankedCandidates[0].cost, 2);

  for (const [name, route, kind, cost] of [
    ['direct-room', '/allocation/candidates', 'direct', 2],
    ['equipment-failure', '/allocation/candidates', 'direct', 1],
    ['single-relocation', '/allocation/room-swaps', 'relocation', 103],
    ['single-swap', '/allocation/room-swaps', 'swap', 103],
  ]) {
    const fixture = loadFixture(name);
    const generated = await httpRequest(app).post(route).send(fixture.request).expect(200);
    const submission = {
      scenarioId: fixture.scenarioId,
      scenarioRevision: fixture.scenarioRevision,
      facilitiesVersion: fixture.facilitiesVersion,
      affectedSessionId: fixture.request.affectedSessionId,
      allowedMoveCount: fixture.request.allowedMoveCount,
      candidates: generated.body.candidates.map(({ candidateId, moves }) => ({ candidateId, moves })),
    };
    const response = await httpRequest(app).post('/allocation/score').send(submission).expect(200);
    const result = response.body;
    checkObjectFields(result, responseSchema);
    assert.equal(typeof response.headers['x-request-id'], 'string');
    for (const field of ['mode', 'scope', 'validationStatus']) {
      assert.equal(result[field], responseSchema.properties[field].const);
    }
    assert.equal(result.scenarioId, fixture.scenarioId);
    assert.equal(result.scenarioRevision, fixture.scenarioRevision);
    assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
    checkObjectFields(result.scoringPolicy, policySchema);
    assert.equal(result.scoringPolicy.version, policySchema.properties.version.const);
    checkObjectFields(result.scoringPolicy.weights, policySchema.properties.weights);
    for (const [field, weight] of Object.entries(policySchema.properties.weights.properties)) {
      assert.equal(result.scoringPolicy.weights[field], weight.const);
    }
    assert.equal(result.rankedCandidates.length, submission.candidates.length);
    assert.ok(result.reasons.every((reason) => typeof reason === 'string'));
    for (const [index, candidate] of result.rankedCandidates.entries()) {
      checkObjectFields(candidate, rankedSchema);
      assert.equal(candidate.rank, index + 1);
      assert.equal(candidate.kind, kind);
      assert.equal(candidate.validationStatus, rankedSchema.properties.validationStatus.const);
      assert.equal(candidate.cost, cost);
      assert.ok(candidate.reasons.every((reason) => typeof reason === 'string'));
      const submitted = submission.candidates.find((item) => item.candidateId === candidate.candidateId);
      assert.ok(submitted);
      assert.deepEqual(candidate.moves, submitted.moves);
      checkObjectFields(candidate.costBreakdown, breakdownSchema);
      assert.equal(candidate.costBreakdown.timeChangedSessions, 0);
      assert.equal(candidate.costBreakdown.buildingChangedSessions, 0);
      assert.equal(candidate.costBreakdown.displacedExistingSessions, kind === 'direct' ? 0 : 1);
      checkObjectFields(candidate.costBreakdown.weightedCosts, breakdownSchema.properties.weightedCosts);
      for (const [field, weight] of Object.entries(result.scoringPolicy.weights)) {
        assert.ok(Number.isInteger(candidate.costBreakdown[field]));
        assert.ok(candidate.costBreakdown[field] >= 0);
        assert.equal(candidate.costBreakdown.weightedCosts[field], candidate.costBreakdown[field] * weight);
      }
      assert.equal(candidate.cost, Object.values(candidate.costBreakdown.weightedCosts)
        .reduce((sum, contribution) => sum + contribution, 0));
    }
  }
});

test('documented equal-cost ties use candidate ID rather than caller order', async () => {
  const fixture = loadFixture('direct-room');
  for (const roomId of ['ROOM_EQUAL_A', 'ROOM_EQUAL_B']) {
    fixture.rooms.push({ roomId, seats: 80, features: ['projector'], usableComputers: 0, building: 'Main' });
  }
  const app = createApp({ clients: createFixtureClients({ fixture }) });
  const generated = await httpRequest(app).post('/allocation/candidates').send(fixture.request).expect(200);
  const candidates = generated.body.candidates.map(({ candidateId, moves }) => ({ candidateId, moves })).reverse();
  const response = await httpRequest(app).post('/allocation/score').send({
    scenarioId: fixture.scenarioId, scenarioRevision: fixture.scenarioRevision,
    facilitiesVersion: fixture.facilitiesVersion, affectedSessionId: fixture.request.affectedSessionId,
    allowedMoveCount: fixture.request.allowedMoveCount, candidates,
  }).expect(200);
  assert.equal(response.body.rankedCandidates.length, 3);
  assert.deepEqual(response.body.rankedCandidates.map((candidate) => candidate.candidateId),
    candidates.map((candidate) => candidate.candidateId).sort());
  assert.deepEqual(response.body.rankedCandidates.map((candidate) => candidate.rank), [1, 2, 3]);
  assert.ok(response.body.rankedCandidates.every((candidate) => candidate.cost === 2));
});

test('empty score batches still check versions and invalid plans reject without a partial ranking', async () => {
  const operation = contract.paths['/allocation/score'].post;
  const example = operation.requestBody.content['application/json'].example;
  const app = createApp();
  const empty = await httpRequest(app).post('/allocation/score').send({ ...example, candidates: [] }).expect(200);
  checkObjectFields(empty.body, contract.components.schemas.ScoreResponse);
  assert.deepEqual(empty.body.rankedCandidates, []);
  assert.equal(empty.body.validationStatus, 'pending');
  const stale = await httpRequest(app).post('/allocation/score')
    .send({ ...example, facilitiesVersion: 'fixture-old', candidates: [] }).expect(409);
  assert.equal(stale.body.code, 'STALE_FACILITIES');

  const tampered = { ...structuredClone(example.candidates[0]), candidateId: 'candidate-tampered' };
  const rejected = await httpRequest(app).post('/allocation/score')
    .send({ ...example, candidates: [...example.candidates, tampered] }).expect(422);
  const errorSchema = resolveReference(resolveReference(operation.responses['422'].$ref)
    .content['application/json'].schema.$ref);
  checkObjectFields(rejected.body, errorSchema);
  assert.equal(rejected.body.code, 'INVALID_CANDIDATE');
  assert.equal(rejected.body.rankedCandidates, undefined);
  assert.equal(rejected.body.traceId, rejected.headers['x-request-id']);
});

test('validation has the documented stricter batch bound and is unavailable by default', async () => {
  const operation = contract.paths['/allocation/validate'].post;
  const requestSchema = resolveReference(operation.requestBody.content['application/json'].schema.$ref);
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, contract.components.schemas.ScoreRequest.required);
  assert.equal(requestSchema.properties.candidates.minItems, 0);
  assert.equal(requestSchema.properties.candidates.maxItems, 10);
  assert.equal(contract.components.schemas.ScoreRequest.properties.candidates.maxItems, 50);
  const example = operation.requestBody.content['application/json'].example;
  checkObjectFields(example, requestSchema);
  const response = await httpRequest(createApp()).post('/allocation/validate').send(example).expect(503);
  checkObjectFields(response.body, contract.components.schemas.Error);
  assert.equal(response.body.code, 'PLATFORM_VALIDATION_UNAVAILABLE');
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.validatedCandidates, undefined);
});

test('explicit fixture validation matches evidence fields but cannot produce an authoritative valid candidate', async () => {
  const operation = contract.paths['/allocation/validate'].post;
  const example = operation.requestBody.content['application/json'].example;
  const responseSchema = resolveReference(operation.responses['200'].content['application/json'].schema.$ref);
  const assessedSchema = resolveReference(responseSchema.properties.rankedCandidates.items.$ref);
  const evidenceSchema = resolveReference(assessedSchema.properties.validationEvidence.$ref);
  const proposals = [];
  const app = createApp({ validationClient: fixtureValidator(proposals) });
  const response = await httpRequest(app).post('/allocation/validate').send(example).expect(200);
  const result = response.body;
  checkObjectFields(result, responseSchema);
  for (const field of ['mode', 'scope', 'validationStatus', 'validationSource']) {
    assert.equal(result[field], responseSchema.properties[field].const);
  }
  assert.deepEqual(result.validatedCandidates, responseSchema.properties.validatedCandidates.const);
  assert.deepEqual(result.validatedCandidates, []);
  assert.equal(result.rankedCandidates.length, 1);
  assert.ok(!assessedSchema.properties.validationStatus.enum.includes('valid'));
  const [candidate] = result.rankedCandidates;
  checkObjectFields(candidate, assessedSchema);
  assert.equal(candidate.validationStatus, 'pending');
  assert.equal(candidate.cost, 2);
  assert.equal(candidate.candidateId, example.candidates[0].candidateId);
  assert.deepEqual(candidate.moves, example.candidates[0].moves);
  checkObjectFields(candidate.validationEvidence, evidenceSchema);
  assert.equal(candidate.validationEvidence.source, 'fixture');
  assert.equal(candidate.validationEvidence.reportedStatus, 'valid');
  assert.equal(candidate.validationEvidence.validationReference, 'fixture-validation-001');
  assert.ok(Number.isFinite(Date.parse(candidate.validationEvidence.validatedAt)));
  assert.equal(candidate.validationEvidence.scenarioRevision, example.scenarioRevision);
  assert.equal(candidate.validationEvidence.facilitiesVersion, example.facilitiesVersion);
  assert.deepEqual(candidate.validationEvidence.conflicts, []);
  assert.deepEqual(proposals, [{
    scenarioId: example.scenarioId,
    scenarioRevision: example.scenarioRevision,
    facilitiesVersion: example.facilitiesVersion,
    candidateId: example.candidates[0].candidateId,
    moves: example.candidates[0].moves,
  }]);
});

test('validation accepts ten explicit plans and rejects eleven before invoking the fixture validator', async () => {
  const fixture = loadFixture('direct-room');
  const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
  const candidates = Array.from({ length: 11 }, (_, index) => {
    const roomId = `ROOM_CHECK_${index}`;
    fixture.rooms.push({ roomId, seats: 80, features: ['projector'], usableComputers: 0, building: 'Main' });
    const moves = [{
      sessionId: target.sessionId, fromRoomId: target.roomId, toRoomId: roomId,
      startAt: target.startAt, endAt: target.endAt,
    }];
    return { candidateId: createCandidateId({ snapshot: fixture }, moves), moves };
  });
  const proposals = [];
  const app = createApp({
    clients: createFixtureClients({ fixture }), validationClient: fixtureValidator(proposals),
  });
  const body = {
    scenarioId: fixture.scenarioId, scenarioRevision: fixture.scenarioRevision,
    facilitiesVersion: fixture.facilitiesVersion, affectedSessionId: target.sessionId,
    allowedMoveCount: 0, candidates: candidates.slice(0, 10),
  };
  const accepted = await httpRequest(app).post('/allocation/validate').send(body).expect(200);
  assert.equal(accepted.body.rankedCandidates.length, 10);
  assert.deepEqual(accepted.body.validatedCandidates, []);
  assert.ok(accepted.body.rankedCandidates.every((candidate) => candidate.validationStatus === 'pending'));
  assert.equal(proposals.length, 10);
  const rejected = await httpRequest(app).post('/allocation/validate').send({ ...body, candidates }).expect(422);
  assert.equal(rejected.body.code, 'INVALID_INPUT');
  assert.equal(proposals.length, 10);
});

test('historical lookup documents strict run IDs and distinguishes disabled storage from a missing record', async () => {
  const operation = contract.paths['/allocation/results/{runId}'].get;
  const runIdSchema = resolveReference(operation.parameters[0].schema.$ref);
  const runId = 'run-11111111-1111-4111-8111-111111111111';
  const pattern = new RegExp(runIdSchema.pattern);
  assert.match(runId, pattern);
  for (const invalid of ['candidate-001', 'run-not-a-uuid', runId.toUpperCase(), runId.replace('-4111-', '-1111-')]) {
    assert.doesNotMatch(invalid, pattern);
  }
  const disabled = await httpRequest(createApp()).get(`/allocation/results/${runId}`).expect(503);
  assert.equal(disabled.body.code, 'RUN_STORAGE_UNAVAILABLE');
  assert.equal(disabled.body.traceId, disabled.headers['x-request-id']);
  const app = createApp({ runStore: contractRunStore() });
  const missing = await httpRequest(app).get(`/allocation/results/${runId}`).expect(404);
  assert.equal(missing.body.code, 'RUN_NOT_FOUND');
  await httpRequest(app).get('/allocation/results/run-not-a-uuid').expect(422);
});

test('persisted POST headers lead to the documented public historical record without changing its response body', async () => {
  const fixture = loadFixture('direct-room');
  const runStore = contractRunStore();
  const app = createApp({ runStore });
  const generated = await httpRequest(app).post('/allocation/candidates').send(fixture.request).expect(200);
  const runId = generated.body.runId;
  assert.match(runId, new RegExp(contract.components.schemas.RunId.pattern));
  assert.equal(generated.headers['x-allocation-persistence'], 'enabled');
  assert.equal(generated.headers['x-allocation-run-id'], runId);
  assert.equal(generated.headers.location, `/allocation/results/${runId}`);
  const operation = contract.paths['/allocation/results/{runId}'].get;
  const schema = resolveReference(operation.responses['200'].content['application/json'].schema.$ref);
  const retrieved = await httpRequest(app).get(generated.headers.location).expect(200);
  const record = retrieved.body;
  checkObjectFields(record, schema);
  assert.equal(retrieved.headers['cache-control'], 'no-store');
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.runId, runId);
  assert.equal(record.operation, 'direct');
  assert.equal(record.status, 'completed');
  assert.equal(record.historical, true);
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  assert.ok(Date.parse(record.completedAt) >= Date.parse(record.createdAt));
  assert.ok(typeof record.elapsedMs === 'number' && record.elapsedMs >= 0);
  assert.equal(record.scenarioId, fixture.scenarioId);
  assert.equal(record.scenarioRevision, fixture.scenarioRevision);
  assert.equal(record.facilitiesVersion, fixture.facilitiesVersion);
  assert.equal(record.mode, 'fixture');
  assert.equal(record.scoringVersion, null);
  assert.deepEqual(record.limits, fixture.request.limits);
  assert.deepEqual(record.request, parseCandidateRequest(fixture.request));
  assert.equal(record.candidateCount, generated.body.candidates.length);
  assert.equal(record.validatedCount, 0);
  assert.deepEqual(record.response, generated.body);
  assert.equal(record.error, null);
  assert.equal(record._id, undefined);

  // History is a stored snapshot, not a request to read or validate current source data.
  const historyApp = createApp({
    runStore,
    clients: {
      platformClient: { async getScenarioSnapshot() { throw new Error('Unexpected history source read'); } },
      facilitiesClient: { async getRoomSnapshot() { throw new Error('Unexpected history source read'); } },
    },
  });
  const historical = await httpRequest(historyApp).get(generated.headers.location).expect(200);
  assert.deepEqual(historical.body, record);
});

test('persisted operation failures retain their public error and can be retrieved by the response run ID', async () => {
  const example = contract.paths['/allocation/validate'].post.requestBody.content['application/json'].example;
  const app = createApp({ runStore: contractRunStore() });
  const failed = await httpRequest(app).post('/allocation/validate').send(example).expect(503);
  assert.equal(failed.headers['x-allocation-persistence'], 'enabled');
  const runId = failed.headers['x-allocation-run-id'];
  assert.match(runId, new RegExp(contract.components.schemas.RunId.pattern));
  assert.equal(failed.headers.location, undefined);
  const lookup = await httpRequest(app).get(`/allocation/results/${runId}`).expect(200);
  const record = lookup.body;
  checkObjectFields(record, contract.components.schemas.RunRecord);
  assert.equal(record.operation, 'validate');
  assert.equal(record.status, 'error');
  assert.equal(record.historical, true);
  assert.equal(record.response, null);
  assert.equal(record.candidateCount, 0);
  assert.equal(record.validatedCount, 0);
  checkObjectFields(record.error, contract.components.schemas.RunError);
  assert.equal(record.error.status, 503);
  assert.equal(record.error.code, failed.body.code);
  assert.equal(record.error.message, failed.body.message);
  assert.equal(record.error.traceId, failed.body.traceId);
});

test('storage failure is an explicit error rather than an unstored successful POST', async () => {
  const fixture = loadFixture('direct-room');
  const app = createApp({
    runStore: {
      async save() { throw new Error('Raw storage failure should stay private'); },
      async findById() { return null; },
    },
  });
  const failed = await httpRequest(app).post('/allocation/candidates').send(fixture.request).expect(503);
  assert.equal(failed.body.code, 'RUN_STORAGE_UNAVAILABLE');
  assert.ok(!failed.body.message.includes('Raw storage failure'));
  assert.equal(failed.headers['x-allocation-persistence'], 'enabled');
  assert.match(failed.headers['x-allocation-run-id'], new RegExp(contract.components.schemas.RunId.pattern));
  assert.equal(failed.headers.location, undefined);
});
