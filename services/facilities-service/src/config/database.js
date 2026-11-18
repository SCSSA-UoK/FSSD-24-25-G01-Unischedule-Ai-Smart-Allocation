const mongoose = require('mongoose');

async function connectDatabase({ uri, dbName }) {
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  });
  await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 10000 });
  console.log(`MongoDB connection and ping succeeded for database "${dbName}".`);
}

// Driver messages can contain connection strings. Emit only fixed descriptions.
function databaseErrorMessage(error) {
  const errors = [error, error?.cause, error?.reason];
  if (error?.reason?.servers instanceof Map) {
    for (const server of error.reason.servers.values()) {
      errors.push(server.error, server.error?.cause);
    }
  }
  if (errors.some((item) => item?.code === 18 || item?.codeName === 'AuthenticationFailed')) {
    return 'MongoDB authentication failed. Check the Atlas database user and MONGODB_URI credentials.';
  }
  if (errors.some((item) => item?.code === 13 || item?.codeName === 'Unauthorized')) {
    return 'MongoDB authorization failed. Check the database user permissions for FACILITIES_DB.';
  }
  if (errors.some((item) => ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'ECONNREFUSED'].includes(item?.code)
      && ['querySrv', 'queryTxt', 'getaddrinfo'].includes(item?.syscall))) {
    return 'MongoDB DNS resolution failed. Check your DNS/network access and the Atlas cluster hostname.';
  }
  if (errors.some((item) => /TLS|SSL|CERT/.test(String(item?.code ?? '')))) {
    return 'MongoDB TLS negotiation failed. Check trusted certificates and network TLS settings.';
  }
  if (error?.name === 'MongoServerSelectionError' || error?.name === 'MongooseServerSelectionError') {
    return 'MongoDB server selection failed: no reachable server within 10 seconds. Check network access, Atlas IP access list and cluster availability.';
  }
  if (error?.name === 'MongoParseError' || error?.name === 'MongoInvalidArgumentError') {
    return 'MongoDB connection configuration is invalid. Check MONGODB_URI options.';
  }
  return 'MongoDB connection or ping failed. Check Atlas availability, network access and database configuration.';
}

module.exports = { connectDatabase, databaseErrorMessage };
