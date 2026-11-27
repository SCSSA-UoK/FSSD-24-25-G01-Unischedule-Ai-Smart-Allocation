const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoRunStore, createRunStoreFromEnv } = require('../models/mongo-run-store');

const runId = () => `run-${randomUUID()}`;

function assertStorageError(error) {
  assert.equal(error.status, 503);
  assert.equal(error.code, 'RUN_STORAGE_UNAVAILABLE');
  assert.doesNotMatch(error.message, /private-db-secret|credential-secret/);
  return true;
}

test('one acknowledged insert embeds the complete run without mutating the supplied record', async () => {
  const calls = [];
  const store = new MongoRunStore({ collection: {
    async insertOne(document) { calls.push(structuredClone(document)); document.response.moves[0].toRoomId = 'changed'; return { acknowledged: true }; },
  } });
  const record = { runId: runId(), response: { moves: [{ sessionId: 'S007', toRoomId: 'HALL_A' }] } };
  const original = structuredClone(record);
  await store.save(record);
  assert.deepEqual(record, original);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { ...original, _id: record.runId });
});

test('unacknowledged, failed and duplicate writes cannot report successful storage or overwrite a run', async () => {
  for (const insertOne of [
    async () => ({ acknowledged: false }),
    async () => { throw new Error('private-db-secret'); },
    async () => { const error = new Error('private-db-secret duplicate'); error.code = 11000; throw error; },
  ]) {
    const store = new MongoRunStore({ collection: { insertOne } });
    await assert.rejects(store.save({ runId: runId(), response: {} }), assertStorageError);
  }
});

test('the document size guard rejects before attempting a Mongo write', async () => {
  let called = false;
  const store = new MongoRunStore({ maxDocumentBytes: 128, collection: {
    async insertOne() { called = true; return { acknowledged: true }; },
  } });
  await assert.rejects(store.save({ runId: runId(), response: { data: 'x'.repeat(256) } }), {
    status: 503, code: 'RUN_STORAGE_LIMIT',
  });
  assert.equal(called, false);
});

test('lookup uses one scalar ID filter and excludes Mongo internals from an isolated public copy', async () => {
  const id = runId();
  const stored = { _id: id, runId: id, historical: true, response: { candidates: [{ validationStatus: 'pending' }] } };
  const queries = [];
  const store = new MongoRunStore({ collection: {
    async findOne(filter, options) { queries.push({ filter, options }); return stored; },
  } });
  const result = await store.findById(id);
  assert.deepEqual(queries, [{ filter: { _id: id }, options: { projection: { _id: 0 } } }]);
  assert.equal(result._id, undefined);
  result.response.candidates[0].validationStatus = 'invalid';
  assert.equal(stored.response.candidates[0].validationStatus, 'pending');
});

test('missing IDs and read failures remain distinct, while malformed IDs never reach Mongo', async () => {
  let calls = 0;
  const store = new MongoRunStore({ collection: {
    async findOne() { calls++; return null; },
  } });
  assert.equal(await store.findById(runId()), null);
  for (const invalid of ['run-not-a-uuid', { $ne: null }, '$where', null]) {
    await assert.rejects(store.findById(invalid), { status: 422, code: 'INVALID_INPUT' });
  }
  assert.equal(calls, 1);
  const failing = new MongoRunStore({ collection: { async findOne() { throw Error('private-db-secret'); } } });
  await assert.rejects(failing.findById(runId()), assertStorageError);
});

test('storage stays disabled without explicit opt-in even when a shared URI is present', async () => {
  assert.equal(await createRunStoreFromEnv({ MONGODB_URI: 'credential-secret' }), undefined);
  assert.equal(await createRunStoreFromEnv({ ALLOCATION_PERSISTENCE: 'disabled', MONGODB_URI: 'credential-secret' }), undefined);
});

test('invalid mode, database ownership and URI fail with value-free configuration errors', async () => {
  for (const env of [
    { ALLOCATION_PERSISTENCE: 'credential-secret' },
    { ALLOCATION_PERSISTENCE: 'mongodb', ALLOCATION_DB: 'platform_db' },
    { ALLOCATION_PERSISTENCE: 'mongodb', ALLOCATION_DB: 'facilities_db' },
    { ALLOCATION_PERSISTENCE: 'mongodb', ALLOCATION_DB: 'allocation_bad/name' },
    { ALLOCATION_PERSISTENCE: 'mongodb', MONGODB_URI: 'credential-secret' },
  ]) {
    await assert.rejects(createRunStoreFromEnv(env), (error) => {
      assert.doesNotMatch(error.message, /credential-secret|platform_db|facilities_db/);
      return true;
    });
  }
});
