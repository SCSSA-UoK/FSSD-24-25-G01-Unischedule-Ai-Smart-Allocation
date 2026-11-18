const mongoose = require('mongoose');

async function connectDb(config) {
  const uri = config.mongoUri;
  const dbName = config.operationsDb;

  try {
    await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 5000
    });
    console.log(`Connected to MongoDB database: ${dbName}`);
  } catch (error) {
    console.warn(`MongoDB connection warning: ${error.message}. Running in memory fallback.`);
  }
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDb, disconnectDb };
