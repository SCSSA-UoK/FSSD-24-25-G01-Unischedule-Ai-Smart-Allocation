const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const {
  PlatformValidationClient, createValidationClientFromEnv,
} = require('../clients/platform-validation-client');
const { AllocationInputError } = require('../validation/allocation-input');

const TOKEN = 'fixture-service-token-do-not-log';
const PRIVATE_VALUE = 'PRIVATE_PLATFORM_RESPONSE';

function proposal() {
  return {
    scenarioId: 'scenario-validation-001', scenarioRevision: 3, facilitiesVersion: 'facilities-v1',
    candidateId: 'candidate-0123456789abcdef01234567',
    moves: [
      {
        sessionId: 'S001', fromRoomId: 'HALL_A', toRoomId: 'ROOM_C',
        startAt: '2026-11-16T09:00:00+05:30', endAt: '2026-11-16T11:00:00+05:30',
      },
      {
        sessionId: 'S007', fromRoomId: null, toRoomId: 'HALL_A',
        startAt: '2026-11-16T09:00:00+05:30', endAt: '2026-11-16T11:00:00+05:30',
      },
    ],
  };
}

function evidence(input, overrides = {}) {
  return {
    ...structuredClone(input), validationStatus: 'valid', validationReference: 'validation-test-001',
    validatedAt: '2026-11-26T09:00:00+05:30', conflicts: [], ...overrides,
  };
}

function jsonResponse(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function fakePlatform(t, respond) {
  const requests = [];
  const server = http.createServer((incoming, outgoing) => {
    incoming.on('error', () => {});
    outgoing.on('error', () => {});
    let bodyText = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => { bodyText += chunk; });
    incoming.on('end', () => {
      let body;
      try { body = JSON.parse(bodyText); } catch { body = undefined; }
      const record = { method: incoming.method, path: incoming.url, headers: incoming.headers, body };
      requests.push(record);
      respond(incoming, outgoing, record);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { server, requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function clientFor(platform, options = {}) {
  return new PlatformValidationClient({ baseUrl: platform.baseUrl, serviceToken: TOKEN, ...options });
}

async function assertClientError(result, status, code) {
  await assert.rejects(result, (error) => {
    assert.ok(error instanceof AllocationInputError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    const visible = String(error) + JSON.stringify(error);
    assert.ok(!visible.includes(TOKEN));
    assert.ok(!visible.includes(PRIVATE_VALUE));
    return true;
  });
}

test('the transport posts both moves together with Bearer authentication and returns parsed stub evidence', async (t) => {
  const input = proposal();
  const before = structuredClone(input);
  const reply = evidence(input);
  const platform = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, reply));
  let requestOptions;
  const client = clientFor(platform, { fetchImpl: (url, options) => {
    requestOptions = options;
    return fetch(url, options);
  } });
  assert.equal(client.source, 'platform');
  assert.deepEqual(await client.validateProposal(input), reply);
  assert.equal(platform.requests.length, 1);
  const sent = platform.requests[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.path, '/api/scenarios/scenario-validation-001/validate');
  assert.equal(sent.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(sent.headers['content-type'], /^application\/json/);
  assert.deepEqual(sent.body, input);
  assert.equal(sent.body.serviceToken, undefined);
  assert.equal(requestOptions.redirect, 'error');
  assert.ok(requestOptions.signal instanceof AbortSignal);
  assert.deepEqual(input, before);
});

test('invalid and stale evidence plus changed snapshot versions are preserved for domain interpretation', async (t) => {
  const input = proposal();
  let reply;
  const platform = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, reply));
  const client = clientFor(platform);
  for (const overrides of [
    { validationStatus: 'invalid', conflicts: [{ code: 'ROOM_OCCUPIED', message: 'Room is occupied.', sessionIds: ['S001'] }] },
    { validationStatus: 'stale' },
    { scenarioRevision: 4, facilitiesVersion: 'facilities-v2' },
  ]) {
    reply = evidence(input, overrides);
    assert.deepEqual(await client.validateProposal(input), reply);
  }
});

test('canonical response moves can be reordered without changing their binding to the submitted plan', async (t) => {
  const input = proposal();
  const reply = evidence(input, { moves: [...structuredClone(input.moves)].reverse() });
  const platform = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, reply));
  const result = await clientFor(platform).validateProposal(input);
  assert.equal(result.validationReference, reply.validationReference);
  assert.deepEqual([...result.moves].sort((left, right) => left.sessionId.localeCompare(right.sessionId)), input.moves);
});

test('upstream authentication failures become sanitized dependency errors', async (t) => {
  let status;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    jsonResponse(outgoing, status, { message: `${PRIVATE_VALUE} ${TOKEN}` });
  });
  for (status of [401, 403]) {
    await assertClientError(clientFor(platform).validateProposal(proposal()), 503, 'PLATFORM_AUTH_FAILED');
  }
});

test('an absent or unimplemented validation endpoint is reported as unavailable', async (t) => {
  let status;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    jsonResponse(outgoing, status, { message: `${PRIVATE_VALUE} ${TOKEN}` });
  });
  for (status of [404, 501]) {
    await assertClientError(clientFor(platform).validateProposal(proposal()), 503, 'PLATFORM_VALIDATION_UNAVAILABLE');
  }
});

test('upstream 409 remains stale while other non-success statuses become dependency failures', async (t) => {
  let status;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    jsonResponse(outgoing, status, { message: `${PRIVATE_VALUE} ${TOKEN}` });
  });
  status = 409;
  await assertClientError(clientFor(platform).validateProposal(proposal()), 409, 'STALE_SCENARIO');
  for (status of [202, 204, 400, 429, 500]) {
    await assertClientError(clientFor(platform).validateProposal(proposal()), 503, 'PLATFORM_UNAVAILABLE');
  }
});

test('a reset connection returns a sanitized transport error', async (t) => {
  const platform = await fakePlatform(t, (incoming) => incoming.socket.destroy());
  await assertClientError(clientFor(platform).validateProposal(proposal()), 503, 'PLATFORM_UNAVAILABLE');
});

test('redirect responses are rejected without forwarding the plan or token to another server', async (t) => {
  const destination = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, evidence(proposal())));
  let status;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    outgoing.writeHead(status, { Location: destination.baseUrl + '/collect' });
    outgoing.end();
  });
  for (status of [302, 307]) {
    await assertClientError(clientFor(platform).validateProposal(proposal()), 503, 'PLATFORM_UNAVAILABLE');
  }
  assert.equal(destination.requests.length, 0);
});

test('the timeout covers waiting for headers and waiting for a JSON body after headers arrive', { timeout: 3000 }, async (t) => {
  let writeHeaders = false;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    if (writeHeaders) {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.write('{"scenarioId":');
    }
  });
  await assertClientError(clientFor(platform, { timeoutMs: 100 }).validateProposal(proposal()), 504, 'PLATFORM_VALIDATION_TIMEOUT');
  writeHeaders = true;
  await assertClientError(clientFor(platform, { timeoutMs: 100 }).validateProposal(proposal()), 504, 'PLATFORM_VALIDATION_TIMEOUT');
  assert.equal(platform.requests.length, 2);
});

test('a non-cooperative injected fetch is still bounded by the client deadline', { timeout: 2000 }, async () => {
  const client = new PlatformValidationClient({
    baseUrl: 'https://platform.example.test', serviceToken: TOKEN, timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });
  await assertClientError(client.validateProposal(proposal()), 504, 'PLATFORM_VALIDATION_TIMEOUT');
});

test('caller cancellation produces the controlled timeout result', { timeout: 2000 }, async (t) => {
  const platform = await fakePlatform(t, () => {});
  const controller = new AbortController();
  const observed = once(platform.server, 'request');
  const pending = clientFor(platform, { timeoutMs: 1000 }).validateProposal(proposal(), { signal: controller.signal });
  await observed;
  controller.abort();
  await assertClientError(pending, 504, 'PLATFORM_VALIDATION_TIMEOUT');
});

test('successful HTTP responses must contain JSON evidence rather than raw or mislabeled content', async (t) => {
  let contentType = 'application/json';
  let body = `${PRIVATE_VALUE} ${TOKEN}`;
  const platform = await fakePlatform(t, (incoming, outgoing) => {
    outgoing.writeHead(200, contentType ? { 'Content-Type': contentType } : {});
    outgoing.end(body);
  });
  await assertClientError(clientFor(platform).validateProposal(proposal()), 502, 'PLATFORM_INVALID_RESPONSE');
  body = JSON.stringify(evidence(proposal()));
  for (contentType of ['text/plain', null]) {
    await assertClientError(clientFor(platform).validateProposal(proposal()), 502, 'PLATFORM_INVALID_RESPONSE');
  }
});

test('missing, malformed or contradictory validation evidence is rejected without exposing its contents', async (t) => {
  const input = proposal();
  let reply;
  const platform = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, reply));
  const conflict = { code: 'ROOM_OCCUPIED', message: 'Room is occupied.', sessionIds: ['S001'] };
  const cases = [
    {},
    evidence(input, { validationReference: '' }),
    evidence(input, { validatedAt: '2026-11-26T09:00:00' }),
    evidence(input, { validationStatus: 'approved' }),
    evidence(input, { conflicts: [conflict] }),
    evidence(input, { validationStatus: 'invalid', conflicts: [] }),
    evidence(input, { privateBody: `${PRIVATE_VALUE} ${TOKEN}` }),
    evidence(input, { validationStatus: 'invalid', conflicts: Array.from({ length: 101 }, () => conflict) }),
    evidence(input, { validationStatus: 'invalid', conflicts: [{ ...conflict, sessionIds: Array.from({ length: 21 }, (_, index) => `S${index}`) }] }),
  ];
  for (reply of cases) {
    await assertClientError(clientFor(platform).validateProposal(input), 502, 'PLATFORM_INVALID_RESPONSE');
  }
});

test('evidence must identify the exact scenario, candidate and complete moves submitted for validation', async (t) => {
  const input = proposal();
  let reply;
  const platform = await fakePlatform(t, (incoming, outgoing) => jsonResponse(outgoing, 200, reply));
  const cases = [
    evidence(input, { scenarioId: 'scenario-other' }),
    evidence(input, { candidateId: 'candidate-000000000000000000000000' }),
    evidence(input, { moves: [input.moves[0]] }),
    evidence(input, { moves: [{ ...input.moves[0], toRoomId: 'ROOM_OTHER' }, input.moves[1]] }),
    evidence(input, { moves: [{ ...input.moves[0], startAt: '2026-11-16T09:01:00+05:30' }, input.moves[1]] }),
  ];
  for (reply of cases) {
    await assertClientError(clientFor(platform).validateProposal(input), 502, 'PLATFORM_INVALID_RESPONSE');
  }
});

test('constructor accepts HTTPS and loopback HTTP only and rejects unsafe configuration without values in errors', () => {
  for (const baseUrl of [
    'https://platform.example.test', 'http://localhost:8081/',
    'http://127.0.0.1:8081', 'http://[::1]:8081',
  ]) {
    assert.equal(new PlatformValidationClient({ baseUrl, serviceToken: TOKEN }).source, 'platform');
  }
  const invalidOptions = [
    { baseUrl: 'http://platform.example.test' },
    { baseUrl: 'https://user:PRIVATE_PLATFORM_RESPONSE@platform.example.test' },
    { baseUrl: 'https://platform.example.test/api' },
    { baseUrl: 'https://platform.example.test/?token=PRIVATE_PLATFORM_RESPONSE' },
    { baseUrl: 'https://platform.example.test/#PRIVATE_PLATFORM_RESPONSE' },
    { baseUrl: 'PRIVATE_PLATFORM_RESPONSE' },
    { baseUrl: 'file:///PRIVATE_PLATFORM_RESPONSE' },
    { serviceToken: '' }, { serviceToken: ' ' }, { serviceToken: 'token with spaces' },
    { serviceToken: 'token\r\nPRIVATE_PLATFORM_RESPONSE' },
    { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: 10001 },
  ];
  for (const options of invalidOptions) {
    assert.throws(() => new PlatformValidationClient({
      baseUrl: 'https://platform.example.test', serviceToken: TOKEN, ...options,
    }), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!(String(error) + JSON.stringify(error)).includes(TOKEN));
      assert.ok(!(String(error) + JSON.stringify(error)).includes(PRIVATE_VALUE));
      return true;
    });
  }
  for (const timeoutMs of [1, 10000]) {
    assert.equal(new PlatformValidationClient({ baseUrl: 'https://platform.example.test', serviceToken: TOKEN, timeoutMs }).source, 'platform');
  }
});

test('the environment factory is disabled without an origin and validates enabled credentials and deadline settings', () => {
  assert.equal(createValidationClientFromEnv({}), undefined);
  assert.equal(createValidationClientFromEnv({ PLATFORM_VALIDATION_TOKEN: TOKEN }), undefined);
  const enabled = { PLATFORM_VALIDATION_BASE_URL: 'https://platform.example.test', PLATFORM_VALIDATION_TOKEN: TOKEN };
  assert.ok(createValidationClientFromEnv(enabled) instanceof PlatformValidationClient);
  for (const value of ['1', '250', '10000']) {
    assert.ok(createValidationClientFromEnv({ ...enabled, PLATFORM_VALIDATION_TIMEOUT_MS: value }) instanceof PlatformValidationClient);
  }
  for (const changes of [
    { PLATFORM_VALIDATION_TOKEN: undefined }, { PLATFORM_VALIDATION_TOKEN: ' ' },
    ...['', ' ', 'invalid', '1.5', '-1', '0', '10001'].map((value) => ({ PLATFORM_VALIDATION_TIMEOUT_MS: value })),
  ]) {
    assert.throws(() => createValidationClientFromEnv({ ...enabled, ...changes }), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!(String(error) + JSON.stringify(error)).includes(TOKEN));
      return true;
    });
  }
});
