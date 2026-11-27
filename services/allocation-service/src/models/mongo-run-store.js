const { MongoClient, BSON } = require('mongodb');
const { AllocationInputError } = require('../validation/allocation-input');
const { parseRunId } = require('../validation/run-id');

function storageUnavailable() {
  return new AllocationInputError(503, 'RUN_STORAGE_UNAVAILABLE', 'Allocation result storage is unavailable.');
}

class MongoRunStore {
  constructor({ collection, close = async () => {}, maxDocumentBytes = 12 * 1024 * 1024 }) {
    this.collection = collection;
    this.close = close;
    this.maxDocumentBytes = maxDocumentBytes;
  }

  async save(record) {
    parseRunId(record.runId);
    const document = { ...structuredClone(record), _id: record.runId };
    if (BSON.calculateObjectSize(document) > this.maxDocumentBytes) {
      throw new AllocationInputError(503, 'RUN_STORAGE_LIMIT', 'The allocation result is too large to store.');
    }
    try {
      const result = await this.collection.insertOne(document);
      if (result.acknowledged !== true) throw storageUnavailable();
    } catch {
      // Includes duplicate IDs: immutable run history must never be overwritten.
      throw storageUnavailable();
    }
  }

  async findById(rawRunId) {
    const runId = parseRunId(rawRunId);
    try {
      const record = await this.collection.findOne({ _id: runId }, { projection: { _id: 0 } });
      if (record === null) return null;
      const { _id, ...publicRecord } = record;
      return structuredClone(publicRecord);
    } catch {
      throw storageUnavailable();
    }
  }
}

async function createRunStoreFromEnv(env = process.env) {
  const mode = env.ALLOCATION_PERSISTENCE ?? 'disabled';
  if (mode === 'disabled') return undefined;
  if (mode !== 'mongodb') throw new Error('ALLOCATION_PERSISTENCE must be disabled or mongodb.');
  const databaseName = env.ALLOCATION_DB ?? 'allocation_db';
  if (!/^allocation_[a-z0-9_]{1,60}$/.test(databaseName)) {
    throw new Error('ALLOCATION_DB must be an allocation-owned name starting with allocation_.');
  }
  const uri = env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  let client;
  try {
    if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Invalid MongoDB URI.');
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000,
      maxPoolSize: 5, writeConcern: { w: 'majority' },
    });
    await client.connect();
    // Select our database explicitly, regardless of a database path in the URI.
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    const collection = database.collection('optimization_runs');
    await collection.createIndex({ scenarioId: 1, createdAt: -1 });
    return new MongoRunStore({ collection, close: () => client.close() });
  } catch {
    if (client) await client.close().catch(() => {});
    throw new Error('Unable to initialize allocation result storage.');
  }
}

module.exports = { MongoRunStore, createRunStoreFromEnv, storageUnavailable };
