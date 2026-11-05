/**
 * @file index.js
 * @description Main entry point for the SyncScholar backend application.
 * Performs environment validation, boots the MongoDB Atlas connection pool,
 * and launches the Express HTTP server.
 */

import { validateEnv, env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './server.js';

async function bootstrap() {
  console.log('🚀 Starting SyncScholar Backend Services...');

  // Step 1: Pre-flight environment check (fails fast if secrets or configs are missing)
  validateEnv();

  // Step 2: Establish connection pool to MongoDB Atlas
  try {
    await connectDB();
  } catch (err) {
    console.error(`💥 Failed to establish database connection during startup: ${err.message}`);
    console.error('Exiting process to prevent degraded operation.');
    process.exit(1);
  }

  // Step 3: Launch Express HTTP Server
  const server = app.listen(env.PORT, () => {
    console.log('\n================================================================');
    console.log(`🎉 SyncScholar Server running on http://localhost:${env.PORT}`);
    console.log(`📡 Environment:    ${env.NODE_ENV}`);
    console.log(`🩺 Health Check:   http://localhost:${env.PORT}/api/health`);
    console.log('================================================================\n');
  });

  // Graceful shutdown on unexpected errors
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception thrown:', error);
    const forceExitTimeout = setTimeout(() => {
      console.error('Forced shutdown due to delayed server.close.');
      process.exit(1);
    }, 5000);
    forceExitTimeout.unref();
    server.close(() => process.exit(1));
  });
}

bootstrap();
