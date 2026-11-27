const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { loadFixture } = require('../src/clients/fixture-clients');

const LOCAL_URI = 'mongodb://127.0.0.1:27017';
const serviceDirectory = path.resolve(__dirname, '..');
const serverPath = path.join(serviceDirectory, 'src/server.js');

function deadline(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopChild(child, ownedChildren) {
  if (child.exitCode !== null || child.signalCode !== null) {
    ownedChildren.delete(child);
    return;
  }
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  try {
    await deadline(stopped, 5000, 'The owned allocation process did not stop.');
  } catch {
    child.kill('SIGKILL');
    await deadline(stopped, 2000, 'Unable to stop the owned allocation process.');
  }
  ownedChildren.delete(child);
}

async function startChild(databaseName, ownedChildren) {
  const port = await freePort();
  const missingEnvFile = path.join(__dirname, `.${databaseName}.env`);
  assert.equal(fs.existsSync(missingEnvFile), false, 'The isolated environment path must not exist.');
  const env = {
    ...process.env,
    ALLOCATION_PERSISTENCE: 'mongodb',
    ALLOCATION_DB: databaseName,
    MONGODB_URI: LOCAL_URI,
    ALLOCATION_PORT: String(port),
    PROJECT_TIMEZONE: 'Asia/Colombo',
  };
  // The check never uses an inherited upstream validator or external MongoDB URI.
  delete env.PLATFORM_VALIDATION_BASE_URL;
  delete env.PLATFORM_VALIDATION_TOKEN;
  delete env.PLATFORM_VALIDATION_TIMEOUT_MS;
  const entry = `require(${JSON.stringify(serverPath)}).startServer({ envFile: ${JSON.stringify(missingEnvFile)} })`
    + '.catch(() => { console.error("Allocation persistence test process failed to start."); process.exitCode = 1; });';
  const child = spawn(process.execPath, ['-e', entry], {
    cwd: serviceDirectory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);
  child.stderr.on('data', () => {});
  let output = '';
  await deadline(new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      if (output.includes(`Allocation service listening on port ${port}.`) && output.includes('Fixture data mode.')) {
        resolve();
      }
    });
    child.once('error', () => reject(new Error('Unable to launch the allocation test process.')));
    child.once('exit', (code) => reject(new Error(`The allocation test process exited before startup (code ${code}).`)));
  }), 10000, 'Allocation test startup exceeded 10 seconds. Check local MongoDB availability.');
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetchJson(baseUrl, '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', service: 'allocation-service' });
  return { child, baseUrl };
}

async function fetchJson(baseUrl, route, body) {
  const options = { redirect: 'error', signal: AbortSignal.timeout(10000) };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(new URL(route, baseUrl), options);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function trackedId(result, expectedStatus) {
  assert.equal(result.status, expectedStatus);
  assert.equal(result.headers.get('x-allocation-persistence'), 'enabled');
  const runId = result.headers.get('x-allocation-run-id');
  assert.match(runId, /^run-[0-9a-f-]{36}$/);
  if (expectedStatus === 200) assert.equal(runId, result.body.runId);
  const location = result.headers.get('location');
  if (expectedStatus === 200) assert.ok(location, 'Successful tracked responses need a Location header.');
  if (location !== null) {
    assert.equal(new URL(location, 'http://127.0.0.1').pathname, `/allocation/results/${runId}`);
  }
  return runId;
}

async function readRecord(baseUrl, runId) {
  const result = await fetchJson(baseUrl, `/allocation/results/${runId}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.runId, runId);
  assert.equal(result.body.historical, true);
  return result.body;
}

function checkRecord(record, operation, request, original) {
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.operation, operation);
  assert.equal(record.status, original.status === 200 ? (original.body.truncated ? 'truncated' : 'completed') : 'error');
  assert.equal(record.historical, true);
  assert.deepEqual(record.request, request);
  assert.equal(record.scenarioId, request.scenarioId);
  assert.equal(record.scenarioRevision, request.scenarioRevision);
  assert.ok(Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0);
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  assert.ok(Number.isFinite(Date.parse(record.completedAt)));
  assert.equal(record._id, undefined);
  if (original.status === 200) {
    assert.deepEqual(record.response, original.body);
    assert.equal(record.mode, 'fixture');
    assert.equal(record.facilitiesVersion, original.body.facilitiesVersion);
    assert.equal(record.scoringVersion, original.body.scoringPolicy?.version ?? null);
    assert.equal(record.candidateCount, (original.body.candidates ?? original.body.rankedCandidates ?? []).length);
    assert.equal(record.validatedCount, (original.body.validatedCandidates ?? []).length);
    assert.equal(record.error, null);
    assert.equal(record.response.validationStatus, 'pending');
  } else {
    assert.equal(record.response, null);
    assert.equal(record.error.status, original.status);
    assert.equal(record.error.code, original.body.code);
    assert.equal(record.error.message, original.body.message);
    assert.equal(record.error.traceId, original.body.traceId);
    assert.equal(record.candidateCount, 0);
  }
}

function scoreRequest(fixture, candidates) {
  return {
    scenarioId: fixture.scenarioId, scenarioRevision: fixture.scenarioRevision,
    facilitiesVersion: fixture.facilitiesVersion,
    affectedSessionId: fixture.request.affectedSessionId, allowedMoveCount: fixture.request.allowedMoveCount,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId, moves: structuredClone(candidate.moves),
    })),
  };
}

async function checkPersistence() {
  const databaseName = `allocation_test_${randomBytes(16).toString('hex')}`;
  const ownedName = /^allocation_test_[a-f0-9]{32}$/;
  assert.match(databaseName, ownedName);
  const mongo = new MongoClient(LOCAL_URI, { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000 });
  const ownedChildren = new Set();
  let connected = false;
  let failure;

  try {
    try {
      await mongo.connect();
      await mongo.db(databaseName).command({ ping: 1 });
      connected = true;
    } catch {
      throw new Error('Local MongoDB is unavailable at 127.0.0.1:27017. Start MongoDB and retry; this check does not skip.');
    }
    const first = await startChild(databaseName, ownedChildren);
    const records = new Map();
    const directFixture = loadFixture('direct-room');
    const direct = await fetchJson(first.baseUrl, '/allocation/candidates', directFixture.request);
    const directId = trackedId(direct, 200);
    assert.equal(direct.body.candidates.length, 1);
    assert.equal(direct.body.candidates[0].moves[0].toRoomId, 'HALL_A');
    const directRecord = await readRecord(first.baseUrl, directId);
    checkRecord(directRecord, 'direct', directFixture.request, direct);
    records.set(directId, directRecord);

    const swapFixture = loadFixture('single-swap');
    const swap = await fetchJson(first.baseUrl, '/allocation/room-swaps', swapFixture.request);
    const swapId = trackedId(swap, 200);
    assert.equal(swap.body.candidates.length, 1);
    assert.deepEqual(swap.body.candidates[0].moves.map((move) => move.sessionId), ['S001', 'S007']);
    const swapRecord = await readRecord(first.baseUrl, swapId);
    checkRecord(swapRecord, 'single-displacement', swapFixture.request, swap);
    records.set(swapId, swapRecord);

    const submitted = scoreRequest(directFixture, direct.body.candidates);
    const scored = await fetchJson(first.baseUrl, '/allocation/score', submitted);
    const scoreId = trackedId(scored, 200);
    assert.equal(scored.body.rankedCandidates[0].cost, 2);
    const scoreRecord = await readRecord(first.baseUrl, scoreId);
    checkRecord(scoreRecord, 'score', submitted, scored);
    records.set(scoreId, scoreRecord);

    const unavailable = await fetchJson(first.baseUrl, '/allocation/validate', submitted);
    const unavailableId = trackedId(unavailable, 503);
    assert.equal(unavailable.body.code, 'PLATFORM_VALIDATION_UNAVAILABLE');
    const errorRecord = await readRecord(first.baseUrl, unavailableId);
    checkRecord(errorRecord, 'validate', submitted, unavailable);
    records.set(unavailableId, errorRecord);
    console.log('PASS: direct, swap, scoring and validation-error runs were stored in local MongoDB.');

    await stopChild(first.child, ownedChildren);
    const restarted = await startChild(databaseName, ownedChildren);
    assert.notEqual(first.child.pid, restarted.child.pid, 'Durability must be checked using a new Node process.');
    for (const [runId, original] of records) {
      assert.deepEqual(await readRecord(restarted.baseUrl, runId), original,
        `Stored history changed across restart for operation ${original.operation}.`);
    }
    console.log('PASS: a new allocation process retrieved identical historical responses, costs, moves and error metadata.');

    const missing = await fetchJson(restarted.baseUrl, `/allocation/results/run-${randomUUID()}`);
    assert.equal(missing.status, 404);
    const repeated = await fetchJson(restarted.baseUrl, '/allocation/candidates', directFixture.request);
    const repeatedId = trackedId(repeated, 200);
    assert.notEqual(repeatedId, directId);
    assert.deepEqual(repeated.body.candidates, direct.body.candidates);
    assert.deepEqual(await readRecord(restarted.baseUrl, directId), directRecord);
    const repeatedRecord = await readRecord(restarted.baseUrl, repeatedId);
    checkRecord(repeatedRecord, 'direct', directFixture.request, repeated);
    assert.equal(await mongo.db(databaseName).collection('optimization_runs').countDocuments(), 5);
    console.log('PASS: unknown runs return 404 and a repeated search creates a new immutable run with the same candidate ID.');
  } catch (error) {
    failure = error;
  } finally {
    for (const child of [...ownedChildren]) {
      try { await stopChild(child, ownedChildren); } catch {
        failure ??= new Error('Could not stop an owned allocation test process; database cleanup was withheld.');
      }
    }
    if (connected && ownedChildren.size === 0) {
      try {
        // The database name is generated here, never read from user configuration.
        assert.match(databaseName, ownedName);
        await mongo.db(databaseName).dropDatabase();
        console.log('Removed the isolated local allocation test database.');
      } catch {
        failure ??= new Error('Unable to remove the isolated local allocation test database.');
      }
    }
    await mongo.close().catch(() => { failure ??= new Error('Unable to close the local test MongoDB connection.'); });
  }
  if (failure) throw failure;
  console.log('Persistence restart check passed.');
}

checkPersistence().catch((error) => {
  console.error(`Persistence restart check failed: ${error.message}`);
  process.exitCode = 1;
});
