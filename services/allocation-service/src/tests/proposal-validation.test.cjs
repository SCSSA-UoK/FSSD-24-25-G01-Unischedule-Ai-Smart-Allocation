const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { PlatformValidationClient } = require('../clients/platform-validation-client');
const { prepareAllocationInput } = require('../services/prepare-allocation-input');
const { createCandidateId } = require('../algorithms/candidate-id');
const { AllocationInputError } = require('../validation/allocation-input');
const { validateCandidates } = require('../services/validate-candidates');

const VALIDATED_AT = '2026-11-26T10:00:00+05:30';
const NOW = Date.parse(VALIDATED_AT);
const options = { now: () => NOW };

async function buildCase(name = 'single-relocation', extraRoomIds = []) {
  const data = loadFixture(name);
  for (const roomId of extraRoomIds) {
    data.rooms.push({ roomId, seats: 80, features: ['projector'], usableComputers: 0, building: 'Main' });
  }
  const clients = createFixtureClients({ fixture: data });
  const input = await prepareAllocationInput(data.request, clients);
  const target = input.affectedSession;
  const plans = name === 'direct-room' ? ['HALL_A', ...extraRoomIds].map((toRoomId) => [{
    sessionId: target.sessionId, fromRoomId: target.roomId, toRoomId,
    startAt: target.startAt, endAt: target.endAt,
  }]) : [data.expected.proposal.moves];
  return {
    data,
    clients,
    raw: {
      scenarioId: data.scenarioId,
      scenarioRevision: data.scenarioRevision,
      facilitiesVersion: data.facilitiesVersion,
      affectedSessionId: data.request.affectedSessionId,
      allowedMoveCount: data.request.allowedMoveCount,
      candidates: plans.map((moves) => ({
        candidateId: createCandidateId(input, moves), moves: structuredClone(moves),
      })),
    },
  };
}

function responseFor(proposal, changes = {}) {
  return {
    ...structuredClone(proposal),
    validationStatus: 'valid',
    validationReference: 'validation-001',
    validatedAt: VALIDATED_AT,
    conflicts: [],
    ...changes,
  };
}

function fixtureValidator(respond = (proposal) => responseFor(proposal)) {
  return { source: 'fixture', async validateProposal(proposal, context) { return respond(proposal, context); } };
}

function conflict() {
  return { code: 'LECTURER_CONFLICT', message: 'Lecturer has an overlapping session.', sessionIds: ['S007'] };
}

test('fixture validation sends one complete canonical plan and records evidence without granting validity', async () => {
  const { data, raw, clients } = await buildCase();
  raw.candidates[0].moves.reverse();
  const before = structuredClone({ data, raw });
  const calls = [];
  const validationClient = fixtureValidator((proposal, { signal }) => {
    assert.ok(signal && typeof signal.addEventListener === 'function');
    calls.push(structuredClone(proposal));
    return responseFor(proposal);
  });
  const result = await validateCandidates(raw, clients, validationClient, options);
  assert.deepEqual(calls, [{
    scenarioId: raw.scenarioId, scenarioRevision: raw.scenarioRevision,
    facilitiesVersion: raw.facilitiesVersion,
    candidateId: raw.candidates[0].candidateId, moves: data.expected.proposal.moves,
  }]);
  assert.equal(result.mode, 'fixture');
  assert.equal(result.scope, 'platform-validation');
  assert.equal(result.validationSource, 'fixture');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.rankedCandidates[0].validationStatus, 'pending');
  assert.deepEqual(result.validatedCandidates, []);
  assert.deepEqual(result.rankedCandidates[0].validationEvidence, {
    source: 'fixture', reportedStatus: 'valid', validationReference: 'validation-001',
    validatedAt: VALIDATED_AT, scenarioRevision: raw.scenarioRevision,
    facilitiesVersion: raw.facilitiesVersion, conflicts: [],
  });
  assert.deepEqual({ data, raw }, before);
  result.rankedCandidates[0].moves[0].toRoomId = 'CALLER_CHANGE';
  assert.deepEqual({ data, raw }, before);
});

test('an explicit lecturer or group conflict invalidates a locally suitable plan', async () => {
  const { raw, clients } = await buildCase();
  const conflicts = [conflict(), {
    code: 'GROUP_CONFLICT', message: 'Student group is unavailable.', sessionIds: ['S007'],
  }];
  const result = await validateCandidates(raw, clients, fixtureValidator((proposal) => responseFor(proposal, {
    validationStatus: 'invalid', conflicts,
  })), options);
  assert.equal(result.rankedCandidates[0].validationStatus, 'invalid');
  assert.deepEqual(result.rankedCandidates[0].validationEvidence.conflicts, conflicts);
  assert.deepEqual(result.validatedCandidates, []);
});

test('reported stale status and mismatched consumed versions cannot yield valid recommendations', async () => {
  const { raw, clients } = await buildCase();
  for (const changes of [
    { validationStatus: 'stale' },
    { scenarioRevision: raw.scenarioRevision + 1 },
    { facilitiesVersion: 'fixture-v2' },
  ]) {
    const result = await validateCandidates(raw, clients,
      fixtureValidator((proposal) => responseFor(proposal, changes)), options);
    assert.equal(result.rankedCandidates[0].validationStatus, 'stale');
    assert.deepEqual(result.validatedCandidates, []);
  }
});

test('evidence freshness permits the boundary instants but rejects older or excessive future times', async () => {
  const { raw, clients } = await buildCase();
  for (const [offsetSeconds, status] of [[-60, 'pending'], [-61, 'stale'], [5, 'pending'], [6, 'stale']]) {
    const validatedAt = new Date(NOW + offsetSeconds * 1000).toISOString().replace('.000Z', 'Z');
    const result = await validateCandidates(raw, clients,
      fixtureValidator((proposal) => responseFor(proposal, { validatedAt })), options);
    assert.equal(result.rankedCandidates[0].validationStatus, status);
    assert.deepEqual(result.validatedCandidates, []);
  }
});

test('evidence that expires during the final source reread is stale when the result is returned', async () => {
  const { raw, clients } = await buildCase();
  let currentTime = NOW + 59000;
  let platformReads = 0;
  const tracked = {
    platformClient: { async getScenarioSnapshot(id) {
      platformReads += 1;
      if (platformReads === 2) currentTime = NOW + 61000;
      return clients.platformClient.getScenarioSnapshot(id);
    } },
    facilitiesClient: clients.facilitiesClient,
  };
  const result = await validateCandidates(raw, tracked, fixtureValidator(), {
    now: () => currentTime,
  });
  assert.equal(platformReads, 2);
  assert.equal(result.rankedCandidates[0].validationEvidence.validatedAt, VALIDATED_AT);
  assert.equal(result.rankedCandidates[0].validationStatus, 'stale');
  assert.equal(result.validationStatus, 'pending');
  assert.deepEqual(result.validatedCandidates, []);
});

test('malformed and contradictory platform evidence is a protocol failure', async () => {
  const { raw, clients } = await buildCase();
  const responses = [
    (proposal) => responseFor(proposal, { conflicts: [conflict()] }),
    (proposal) => responseFor(proposal, { validationStatus: 'invalid', conflicts: [] }),
    (proposal) => responseFor(proposal, { validationReference: undefined }),
    (proposal) => responseFor(proposal, { validatedAt: 'not-a-date' }),
    (proposal) => responseFor(proposal, { validationStatus: 'approved' }),
    (proposal) => responseFor(proposal, { source: 'platform' }),
    (proposal) => responseFor(proposal, { conflicts: Array.from({ length: 101 }, conflict) }),
  ];
  for (const respond of responses) {
    await assert.rejects(validateCandidates(raw, clients, fixtureValidator(respond), options), {
      status: 502, code: 'PLATFORM_INVALID_RESPONSE',
    });
  }
});

test('a response must identify the requested scenario, content ID and exact whole plan', async () => {
  const { raw, clients } = await buildCase();
  for (const changes of [
    { scenarioId: 'scenario-other' },
    { candidateId: `candidate-${'0'.repeat(24)}` },
    { moves: raw.candidates[0].moves.slice(0, 1) },
    { moves: raw.candidates[0].moves.map((move, index) => index === 0 ? { ...move, toRoomId: 'LAB_A' } : move) },
  ]) {
    await assert.rejects(validateCandidates(raw, clients,
      fixtureValidator((proposal) => responseFor(proposal, changes)), options), {
      status: 502, code: 'PLATFORM_INVALID_RESPONSE',
    });
  }
});

test('validation is explicitly unavailable when no validator is configured, including empty batches', async () => {
  const { raw, clients } = await buildCase();
  for (const candidates of [raw.candidates, []]) {
    await assert.rejects(validateCandidates({ ...raw, candidates }, clients, undefined, options), {
      status: 503, code: 'PLATFORM_VALIDATION_UNAVAILABLE',
    });
  }
});

test('a real platform adapter is never sent fictional scenario IDs', async () => {
  const { raw, clients } = await buildCase();
  let calls = 0;
  const validationClient = new PlatformValidationClient({
    baseUrl: 'http://localhost:8081', serviceToken: 'fictional-token',
    async fetchImpl() { calls += 1; throw new Error('No network request is allowed in this test.'); },
  });
  await assert.rejects(validateCandidates(raw, clients, validationClient, options), {
    status: 503, code: 'LIVE_INPUTS_REQUIRED',
  });
  assert.equal(calls, 0);
});

test('post-response revision or facilities changes invalidate the batch before returning evidence', async () => {
  for (const [field, value, code] of [
    ['scenarioRevision', 4, 'STALE_SCENARIO'],
    ['facilitiesVersion', 'fixture-v2', 'STALE_FACILITIES'],
  ]) {
    const { data, raw } = await buildCase();
    const clients = {
      platformClient: { async getScenarioSnapshot(id) {
        return createFixtureClients({ fixture: data }).platformClient.getScenarioSnapshot(id);
      } },
      facilitiesClient: { async getRoomSnapshot() {
        return createFixtureClients({ fixture: data }).facilitiesClient.getRoomSnapshot();
      } },
    };
    const validationClient = fixtureValidator((proposal) => {
      data[field] = value;
      return responseFor(proposal);
    });
    await assert.rejects(validateCandidates(raw, clients, validationClient, options), { status: 409, code });
  }
});

test('a new room restriction is rechecked after the platform response', async () => {
  const { data, raw } = await buildCase();
  const clients = {
    platformClient: { async getScenarioSnapshot(id) {
      return createFixtureClients({ fixture: data }).platformClient.getScenarioSnapshot(id);
    } },
    facilitiesClient: { async getRoomSnapshot() {
      return createFixtureClients({ fixture: data }).facilitiesClient.getRoomSnapshot();
    } },
  };
  const validationClient = fixtureValidator((proposal) => {
    data.restrictions.push({
      restrictionId: 'restriction-new', roomId: 'HALL_A', kind: 'closure',
      startAt: proposal.moves[1].startAt, endAt: proposal.moves[1].endAt,
      unavailableFacilities: [], usableComputers: null, reason: 'New fictional closure',
    });
    return responseFor(proposal);
  });
  await assert.rejects(validateCandidates(raw, clients, validationClient, options), {
    status: 422, code: 'INVALID_CANDIDATE',
  });
});

test('an empty fixture batch makes no validation calls but still rereads both input sources', async () => {
  const { raw, clients } = await buildCase();
  const reads = { platform: 0, facilities: 0 };
  let validationCalls = 0;
  const tracked = {
    platformClient: { async getScenarioSnapshot(id) {
      reads.platform += 1;
      return clients.platformClient.getScenarioSnapshot(id);
    } },
    facilitiesClient: { async getRoomSnapshot() {
      reads.facilities += 1;
      return clients.facilitiesClient.getRoomSnapshot();
    } },
  };
  const validationClient = fixtureValidator((proposal) => { validationCalls += 1; return responseFor(proposal); });
  const result = await validateCandidates({ ...raw, candidates: [] }, tracked, validationClient, options);
  assert.equal(validationCalls, 0);
  assert.deepEqual(reads, { platform: 2, facilities: 2 });
  assert.deepEqual(result.rankedCandidates, []);
  assert.deepEqual(result.validatedCandidates, []);
});

test('client evidence, URLs and oversized candidate batches are rejected before validation calls', async () => {
  const { raw, clients } = await buildCase();
  let calls = 0;
  const validationClient = fixtureValidator((proposal) => { calls += 1; return responseFor(proposal); });
  for (const value of [
    { ...raw, validationSource: 'platform' },
    { ...raw, url: 'http://untrusted.invalid/validate' },
    { ...raw, candidates: [{ ...raw.candidates[0], validationEvidence: { reportedStatus: 'valid' } }] },
    { ...raw, candidates: Array.from({ length: 11 }, (_, index) => ({ ...raw.candidates[0], candidateId: `candidate-${index}` })) },
  ]) {
    await assert.rejects(validateCandidates(value, clients, validationClient, options), {
      status: 422, code: 'INVALID_INPUT',
    });
  }
  assert.equal(calls, 0);
});

test('generic validator failures are sanitized while typed domain errors retain their status', async () => {
  const { raw, clients } = await buildCase();
  await assert.rejects(validateCandidates(raw, clients, fixtureValidator(() => {
    throw new Error('Private upstream credentials');
  }), options), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'PLATFORM_UNAVAILABLE');
    assert.ok(!error.message.includes('Private upstream credentials'));
    return true;
  });
  await assert.rejects(validateCandidates(raw, clients, fixtureValidator(() => {
    throw new AllocationInputError(409, 'STALE_SCENARIO', 'The scenario changed.');
  }), options), { status: 409, code: 'STALE_SCENARIO' });
});

test('a batch timeout rejects an incomplete validation run without returning its earlier evidence', async () => {
  const { raw, clients } = await buildCase('direct-room', ['ROOM_EXTRA']);
  let calls = 0;
  const validationClient = fixtureValidator((proposal) => {
    calls += 1;
    return calls === 1 ? responseFor(proposal) : new Promise(() => {});
  });
  await assert.rejects(validateCandidates(raw, clients, validationClient, { ...options, timeoutMs: 20 }), {
    status: 504, code: 'PLATFORM_VALIDATION_TIMEOUT',
  });
  assert.equal(calls, 2);
});

test('the HTTP route labels mock evidence as fixture and performs no booking writes', async () => {
  const { raw, clients } = await buildCase();
  let writes = 0;
  clients.platformClient.apply = async () => { writes += 1; };
  clients.platformClient.createTimetable = async () => { writes += 1; };
  const response = await request(createApp({ clients, validationClient: fixtureValidator(), validationOptions: options }))
    .post('/allocation/validate').send(raw).expect(200);
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.validationSource, 'fixture');
  assert.equal(response.body.validationStatus, 'pending');
  assert.equal(response.body.rankedCandidates[0].validationStatus, 'pending');
  assert.deepEqual(response.body.validatedCandidates, []);
  assert.equal(writes, 0);
});

test('HTTP unavailable and protocol failures remain errors with trace IDs rather than successful recommendations', async () => {
  const { raw, clients } = await buildCase();
  for (const [validationClient, status, code] of [
    [undefined, 503, 'PLATFORM_VALIDATION_UNAVAILABLE'],
    [fixtureValidator((proposal) => responseFor(proposal, { conflicts: [conflict()] })), 502, 'PLATFORM_INVALID_RESPONSE'],
  ]) {
    const response = await request(createApp({ clients, validationClient, validationOptions: options }))
      .post('/allocation/validate').send(raw).expect(status);
    assert.equal(response.body.code, code);
    assert.equal(response.body.traceId, response.headers['x-request-id']);
    assert.equal(response.body.rankedCandidates, undefined);
    assert.equal(response.body.stack, undefined);
  }
});
