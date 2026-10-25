/**
 * @file db.js
 * @description Automated MongoDB Atlas database connection module using Mongoose.
 * Implements connection pooling, lifecycle event logging, and graceful process shutdown.
 */

import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * Maps Mongoose readyState integer codes to human-readable status labels.
 */
const READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Configure Mongoose event listeners for transparent connection observability.
 */
function registerConnectionEvents() {
  mongoose.connection.on('connected', () => {
    const host = mongoose.connection.host;
    const dbName = mongoose.connection.name;
    console.log(`✅ [MongoDB Atlas] Connected successfully to host: "${host}" | Database: "${dbName}"`);
  });

  mongoose.connection.on('error', (err) => {
    console.error(`❌ [MongoDB Atlas] Connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ [MongoDB Atlas] Connection disconnected.');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('🔄 [MongoDB Atlas] Connection re-established.');
  });
}

/**
 * Connects to MongoDB Atlas using Mongoose with optimized connection pooling.
 *
 * @param {string} [customUri] - Optional override connection URI (useful for testing)
 * @returns {Promise<typeof mongoose>} Active Mongoose instance
 */
export async function connectDB(customUri) {
  const uri = customUri || env.MONGODB_URI;

  if (!uri) {
    throw new Error('MongoDB connection failed: MONGODB_URI environment variable is not defined.');
  }

  // Register event logging once
  registerConnectionEvents();

  // Connection options optimized for Atlas cloud clusters and low-latency API handling
  const options = {
    maxPoolSize: 10,              // Keep up to 10 concurrent connections in pool
    minPoolSize: 2,               // Keep minimum 2 warm connections ready
    serverSelectionTimeoutMS: 5000, // Timeout fast after 5s if cluster is unreachable
    socketTimeoutMS: 45000,       // Close idle sockets after 45 seconds
    heartbeatFrequencyMS: 10000,  // Periodic health ping to Atlas every 10s
  };

  try {
    console.log('⏳ [MongoDB Atlas] Initializing connection to cluster...');
    const conn = await mongoose.connect(uri, options);
    return conn;
  } catch (err) {
    console.error(`❌ [MongoDB Atlas] Fatal connection error: ${err.message}`);
    console.error('💡 Ensure that:');
    console.error('   1. Your current IP address is whitelisted in MongoDB Atlas Network Access.');
    console.error('   2. Your database username and password in MONGODB_URI are correct.');
    console.error('   3. The cluster is running and accessible.');
    throw err;
  }
}

/**
 * Gracefully disconnects Mongoose from the database.
 * Used during process shutdown and automated test cleanup.
 *
 * @returns {Promise<void>}
 */
export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    console.log('🔌 [MongoDB Atlas] Connection closed cleanly.');
  }
}

/**
 * Inspects and returns current database connection telemetry.
 * Used by the GET /api/health endpoint.
 *
 * @returns {object} Connection health metadata
 */
export function getDBStatus() {
  const stateCode = mongoose.connection.readyState;
  return {
    isConnected: stateCode === 1,
    readyState: stateCode,
    state: READY_STATES[stateCode] || 'unknown',
    host: mongoose.connection.host || null,
    databaseName: mongoose.connection.name || null,
  };
}

/**
 * Register process signal handlers for graceful shutdown on SIGINT and SIGTERM.
 */
let isShuttingDown = false;

async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Initiating graceful MongoDB shutdown...`);
  try {
    await disconnectDB();
    console.log('✅ MongoDB connection closed gracefully. Exiting process.');
    process.exit(0);
  } catch (err) {
    console.error(`❌ Error closing MongoDB connection: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

export default connectDB;
