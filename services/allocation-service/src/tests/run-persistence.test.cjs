const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { parseCandidateRequest, AllocationInputError } = require('../validation/allocation-input');
const { runOperation } = require('../services/run-operation');

const RUN_ID = 'run-11111111-1111-4111-8111-111111111111';
const RUN_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREATED_AT = '2026-11-27T03:30:00.000Z';
const COMPLETED_AT = '2026-11-27T03:30:01.000Z';

// This cloning fake checks the API boundary; it does not demonstrate MongoDB durability.
function fakeStore() {
  const records = new Map();
  return {
    records,
    async save(record) { records.set(record.runId, structuredClone(record)); },
    async findById(runId) { return records.has(runId) ? structuredClone(records.get(runId)) : null; },
    async close() {},
  };
}

function resultFor(data, changes = {}) {
  return {
    runId: RUN_ID, mode: 'fixture', scope: 'direct-only', validationStatus: 'pending',
    scenarioId: data.scenarioId, scenarioRevision: data.scenarioRevision,
    facilitiesVersion: data.facilitiesVersion, truncated: false,
    candidates: [], roomChecks: [], reasons: [], ...changes,
  };
}

function mockValidator() {
  return { source: 'fixture', async validateProposal(proposal) {
    return {
      ...structuredClone(proposal), validationStatus: 'valid',
      validationReference: 'validation-001', validatedAt: '2026-11-27T09:00:00+05:30', conflicts: [],
    };
  } };
}

function scoreRequest(data, candidate) {
  return {
    scenarioId: data.scenarioId, scenarioRevision: data.scenarioRevision,
    facilitiesVersion: data.facilitiesVersion, affectedSessionId: data.request.affectedSessionId,
    allowedMoveCount: data.request.allowedMoveCount,
    candidates: [{ candidateId: candidate.candidateId, moves: candidate.moves }],
  };
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
}

test('disabled run storage leaves execution responses and their IDs unchanged', async () => {
  const data = loadFixture('direct-room');
  const original = resultFor(data);
  let executions = 0;
  const result = await runOperation({
    operation: 'direct', request: parseCandidateRequest(data.request),
    onRunId() { assert.fail('Disabled storage must not allocate a stored run ID.'); },
  }, async () => { executions += 1; return original; });
  assert.strictEqual(result, original);
  assert.equal(executions, 1);
  assert.equal(result.runId, RUN_ID);
});

test('successful execution saves one complete historical record with its tracked response ID', async () => {
  const data = loadFixture('direct-room');
  const parsed = parseCandidateRequest(data.request);
  const runStore = fakeStore();
  const saved = [];
  const save = runStore.save;
  runStore.save = async (record) => { saved.push(structuredClone(record)); await save(record); };
  const times = [CREATED_AT, COMPLETED_AT];
  const clocks = [100, 115];
  let trackedId;
  const result = await runOperation({
    operation: 'direct', request: parsed, runStore, traceId: 'trace-unit',
    onRunId(runId) { trackedId = runId; },
    now: () => times.shift(), clock: () => clocks.shift(),
  }, async () => {
    assert.match(trackedId, RUN_PATTERN);
    return resultFor(data);
  });
  assert.equal(saved.length, 1);
  assert.equal(result.runId, trackedId);
  assert.notEqual(result.runId, RUN_ID);
  const record = saved[0];
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.operation, 'direct');
  assert.equal(record.status, 'completed');
  assert.equal(record.historical, true);
  assert.equal(record.createdAt, CREATED_AT);
  assert.equal(record.completedAt, COMPLETED_AT);
  assert.equal(record.elapsedMs, 15);
  assert.equal(record.scenarioId, data.scenarioId);
  assert.equal(record.scenarioRevision, data.scenarioRevision);
  assert.equal(record.facilitiesVersion, data.facilitiesVersion);
  assert.equal(record.mode, 'fixture');
  assert.equal(record.scoringVersion, null);
  assert.deepEqual(record.request, parsed);
  assert.deepEqual(record.limits, parsed.limits);
  assert.equal(record.candidateCount, 0);
  assert.equal(record.validatedCount, 0);
  assert.deepEqual(record.response, result);
  assert.equal(record.error, null);
});

test('truncated searches keep their partial candidates and are distinct from completed empty results', async () => {
  const data = loadFixture('direct-room');
  const target = data.sessions.find((session) => session.sessionId === 'S007');
  const candidate = {
    candidateId: `candidate-${'1'.repeat(24)}`, validationStatus: 'pending', displacedExistingSessions: 0,
    moves: [{ sessionId: target.sessionId, fromRoomId: null, toRoomId: 'HALL_A', startAt: target.startAt, endAt: target.endAt }],
    reasons: ['A fixture alternative.'],
  };
  const runStore = fakeStore();
  const result = await runOperation({ operation: 'direct', request: parseCandidateRequest(data.request), runStore },
    async () => resultFor(data, { truncated: true, candidates: [candidate] }));
  const record = await runStore.findById(result.runId);
  assert.equal(record.status, 'truncated');
  assert.equal(record.candidateCount, 1);
  assert.equal(record.validatedCount, 0);
  assert.deepEqual(record.response.candidates, [candidate]);
});

test('execution failures save an error record and sanitize unexpected internal messages', async () => {
  const data = loadFixture('direct-room');
  for (const original of [
    new AllocationInputError(409, 'STALE_SCENARIO', 'Reload the scenario.'),
    new Error('Private database credentials must not be recorded'),
  ]) {
    const runStore = fakeStore();
    let runId;
    await assert.rejects(runOperation({
      operation: 'direct', request: parseCandidateRequest(data.request), runStore, traceId: 'trace-error',
      onRunId(value) { runId = value; },
    }, async () => { throw original; }), (error) => error === original);
    assert.equal(runStore.records.size, 1);
    const record = await runStore.findById(runId);
    assert.equal(record.status, 'error');
    assert.equal(record.response, null);
    assert.equal(record.candidateCount, 0);
    assert.equal(record.validatedCount, 0);
    assert.equal(record.error.traceId, 'trace-error');
    if (original instanceof AllocationInputError) {
      assert.equal(record.error.status, 409);
      assert.equal(record.error.code, 'STALE_SCENARIO');
      assert.equal(record.error.message, 'Reload the scenario.');
    } else {
      assert.equal(record.error.status, 500);
      assert.equal(record.error.code, 'INTERNAL_ERROR');
      assert.equal(record.error.message, 'An unexpected error occurred.');
      assert.ok(!JSON.stringify(record).includes('Private database credentials'));
    }
  }
});

test('a final-save failure is returned once without a successful response or a fallback second save', async () => {
  const data = loadFixture('direct-room');
  for (const failure of [
    new AllocationInputError(503, 'RUN_STORAGE_UNAVAILABLE', 'Run storage is unavailable.'),
    new Error('Private storage URI must not be exposed'),
  ]) {
    for (const executionFails of [false, true]) {
      let saves = 0;
      const runStore = fakeStore();
      runStore.save = async () => { saves += 1; throw failure; };
      await assert.rejects(runOperation({ operation: 'direct', request: parseCandidateRequest(data.request), runStore },
        async () => {
          if (executionFails) throw new AllocationInputError(409, 'STALE_SCENARIO', 'Reload the scenario.');
          return resultFor(data);
        }), (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'RUN_STORAGE_UNAVAILABLE');
        assert.ok(!error.message.includes('Private storage URI'));
        return true;
      });
      assert.equal(saves, 1);
      assert.equal(runStore.records.size, 0);
    }
  }
});

test('no running record is saved and the response waits for final-save acknowledgment', async () => {
  const data = loadFixture('direct-room');
  let completeExecution;
  let acknowledgeSave;
  let announceSave;
  let settled = false;
  let saves = 0;
  const saveStarted = new Promise((resolve) => { announceSave = resolve; });
  const runStore = fakeStore();
  runStore.save = async () => {
    saves += 1;
    announceSave();
    await new Promise((resolve) => { acknowledgeSave = resolve; });
  };
  const operation = runOperation({ operation: 'direct', request: parseCandidateRequest(data.request), runStore },
    () => new Promise((resolve) => { completeExecution = resolve; }));
  operation.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(saves, 0);
  assert.equal(runStore.records.size, 0);
  completeExecution(resultFor(data));
  await saveStarted;
  assert.equal(saves, 1);
  assert.equal(settled, false);
  acknowledgeSave();
  await operation;
  assert.equal(settled, true);
});

test('all four POST operations round-trip through explicit fake storage with persistence headers', async () => {
  const runStore = fakeStore();
  const app = createApp({ runStore, validationClient: mockValidator(), validationOptions: { now: () => Date.parse('2026-11-27T09:00:00+05:30') } });
  const direct = loadFixture('direct-room');
  const relocation = loadFixture('single-relocation');
  const directResponse = await request(app).post('/allocation/candidates').send(direct.request).expect(200);
  const swapResponse = await request(app).post('/allocation/room-swaps').send(relocation.request).expect(200);
  const submitted = scoreRequest(relocation, swapResponse.body.candidates[0]);
  const scoreResponse = await request(app).post('/allocation/score').send(submitted).expect(200);
  const validationResponse = await request(app).post('/allocation/validate').send(submitted).expect(200);
  for (const [response, operation] of [
    [directResponse, 'direct'], [swapResponse, 'single-displacement'],
    [scoreResponse, 'score'], [validationResponse, 'validate'],
  ]) {
    const runId = response.body.runId;
    assert.match(runId, RUN_PATTERN);
    assert.equal(response.headers['x-allocation-persistence'], 'enabled');
    assert.equal(response.headers['x-allocation-run-id'], runId);
    assert.ok(response.headers.location.endsWith(`/allocation/results/${runId}`));
    const stored = await request(app).get(`/allocation/results/${runId}`).expect(200);
    assert.equal(stored.body.operation, operation);
    assert.equal(stored.body.historical, true);
    assert.equal(stored.body.status, 'completed');
    assert.deepEqual(stored.body.response, response.body);
    assert.equal(stored.body.validatedCount, 0);
    assert.equal(stored.body._id, undefined);
    if (operation === 'score' || operation === 'validate') assert.equal(stored.body.scoringVersion, 'allocation-cost-v1');
  }
  assert.equal(runStore.records.size, 4);
});

test('disabled persistence keeps normal search and health working while result lookup is unavailable', async () => {
  const app = createApp();
  const response = await request(app).post('/allocation/candidates').send(loadFixture('direct-room').request).expect(200);
  assert.equal(response.headers['x-allocation-persistence'], 'disabled');
  assert.equal(response.headers['x-allocation-run-id'], undefined);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.body.candidates[0].validationStatus, 'pending');
  await request(app).get('/health').expect(200);
  const missingStore = await request(app).get(`/allocation/results/${RUN_ID}`);
  assertError(missingStore, 503, 'RUN_STORAGE_UNAVAILABLE');
});

test('result IDs are validated before storage access and absent records return a traced 404', async () => {
  const runStore = fakeStore();
  let reads = 0;
  runStore.findById = async () => { reads += 1; return null; };
  const app = createApp({ runStore });
  for (const runId of [
    'not-a-run',
    'run-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    'run-11111111-1111-1111-8111-111111111111',
    '{"$gt":""}',
  ]) {
    const response = await request(app).get(`/allocation/results/${encodeURIComponent(runId)}`);
    assertError(response, 422, 'INVALID_INPUT');
  }
  assert.equal(reads, 0);
  const missing = await request(app).get(`/allocation/results/${RUN_ID}`);
  assertError(missing, 404, 'RUN_NOT_FOUND');
  assert.equal(reads, 1);
});

test('storage read and write failures stay errors without exposing a successful durable result', async () => {
  const readStore = fakeStore();
  readStore.findById = async () => { throw new Error('mongodb://private-storage-uri'); };
  const readFailure = await request(createApp({ runStore: readStore })).get(`/allocation/results/${RUN_ID}`);
  assertError(readFailure, 503, 'RUN_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(readFailure.body).includes('private-storage-uri'));
  const writeStore = fakeStore();
  let saves = 0;
  writeStore.save = async () => {
    saves += 1;
    throw new AllocationInputError(503, 'RUN_STORAGE_UNAVAILABLE', 'Run storage is unavailable.');
  };
  const response = await request(createApp({ runStore: writeStore })).post('/allocation/candidates')
    .send(loadFixture('direct-room').request);
  assertError(response, 503, 'RUN_STORAGE_UNAVAILABLE');
  assert.equal(response.body.candidates, undefined);
  assert.equal(response.headers.location, undefined);
  assert.match(response.headers['x-allocation-run-id'], RUN_PATTERN);
  assert.equal(saves, 1);
  assert.equal(writeStore.records.size, 0);
});

test('a domain-error response exposes the tracked ID for looking up its historical error record', async () => {
  const runStore = fakeStore();
  const app = createApp({ runStore });
  const data = loadFixture('direct-room');
  const response = await request(app).post('/allocation/candidates')
    .send({ ...data.request, scenarioRevision: data.scenarioRevision - 1 });
  assertError(response, 409, 'STALE_SCENARIO');
  const runId = response.headers['x-allocation-run-id'];
  assert.match(runId, RUN_PATTERN);
  const stored = await request(app).get(`/allocation/results/${runId}`).expect(200);
  assert.equal(stored.body.status, 'error');
  assert.equal(stored.body.response, null);
  assert.equal(stored.body.error.status, 409);
  assert.equal(stored.body.error.code, 'STALE_SCENARIO');
  assert.equal(stored.body.error.traceId, response.headers['x-request-id']);
  assert.equal(stored.body.request.scenarioRevision, data.scenarioRevision - 1);
});

test('unparsed or schema-invalid requests never create run records', async () => {
  const runStore = fakeStore();
  const app = createApp({ runStore });
  const malformed = await request(app).post('/allocation/candidates').set('Content-Type', 'application/json').send('{');
  assertError(malformed, 400, 'INVALID_JSON');
  const invalid = await request(app).post('/allocation/candidates').send({ scenarioId: '../invalid' });
  assertError(invalid, 422, 'INVALID_INPUT');
  assert.equal(malformed.headers['x-allocation-run-id'], undefined);
  assert.equal(invalid.headers['x-allocation-run-id'], undefined);
  assert.equal(malformed.headers['x-allocation-persistence'], 'enabled');
  assert.equal(invalid.headers['x-allocation-persistence'], 'enabled');
  assert.equal(runStore.records.size, 0);
});

test('different runs can embed identical candidate IDs and retrieved copies remain independent', async () => {
  const runStore = fakeStore();
  const app = createApp({ runStore });
  const data = loadFixture('direct-room');
  const first = await request(app).post('/allocation/candidates').send(data.request).expect(200);
  const second = await request(app).post('/allocation/candidates').send(data.request).expect(200);
  assert.notEqual(first.body.runId, second.body.runId);
  assert.equal(first.body.candidates[0].candidateId, second.body.candidates[0].candidateId);
  assert.equal(runStore.records.size, 2);
  const stored = await request(app).get(`/allocation/results/${first.body.runId}`).expect(200);
  stored.body.response.candidates[0].moves[0].toRoomId = 'CALLER_CHANGE';
  const repeated = await request(app).get(`/allocation/results/${first.body.runId}`).expect(200);
  assert.deepEqual(repeated.body.response, first.body);
  assert.equal(repeated.body.historical, true);
});

test('stored mock validation evidence remains historical and pending instead of becoming authoritative', async () => {
  const runStore = fakeStore();
  const app = createApp({ runStore, validationClient: mockValidator(), validationOptions: { now: () => Date.parse('2026-11-27T09:00:00+05:30') } });
  const data = loadFixture('single-relocation');
  const swaps = await request(app).post('/allocation/room-swaps').send(data.request).expect(200);
  const validation = await request(app).post('/allocation/validate').send(scoreRequest(data, swaps.body.candidates[0])).expect(200);
  const stored = await request(app).get(`/allocation/results/${validation.body.runId}`).expect(200);
  assert.equal(stored.body.historical, true);
  assert.equal(stored.body.validatedCount, 0);
  assert.equal(stored.body.response.rankedCandidates[0].validationEvidence.reportedStatus, 'valid');
  assert.equal(stored.body.response.rankedCandidates[0].validationStatus, 'pending');
  assert.deepEqual(stored.body.response.validatedCandidates, []);
  assert.deepEqual(stored.body.response, validation.body);
});

test('retrieving an old run does not allow its candidates to be rescored against a new revision', async () => {
  const runStore = fakeStore();
  const data = loadFixture('single-relocation');
  const clients = {
    platformClient: { async getScenarioSnapshot(id) {
      return createFixtureClients({ fixture: data }).platformClient.getScenarioSnapshot(id);
    } },
    facilitiesClient: { async getRoomSnapshot() {
      return createFixtureClients({ fixture: data }).facilitiesClient.getRoomSnapshot();
    } },
  };
  const app = createApp({ runStore, clients });
  const swaps = await request(app).post('/allocation/room-swaps').send(data.request).expect(200);
  const oldRequest = scoreRequest(data, swaps.body.candidates[0]);
  data.scenarioRevision += 1;
  assertError(await request(app).post('/allocation/score').send(oldRequest), 409, 'STALE_SCENARIO');
  assertError(await request(app).post('/allocation/score').send({ ...oldRequest, scenarioRevision: data.scenarioRevision }),
    422, 'INVALID_CANDIDATE');
  const stored = await request(app).get(`/allocation/results/${swaps.body.runId}`).expect(200);
  assert.equal(stored.body.scenarioRevision, oldRequest.scenarioRevision);
  assert.deepEqual(stored.body.response, swaps.body);
});
