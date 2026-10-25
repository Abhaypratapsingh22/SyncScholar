/**
 * @file server.js
 * @description Primary Express application definition for SyncScholar.
 * Configures middleware, security headers, model registrations, and the /api/health endpoint.
 */

import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { getDBStatus } from './config/db.js';

// Pre-load Mongoose models so they register on the unified data plane
import './models/CurriculumChunk.js';
import './models/User.js';
import './models/QuizAttempt.js';

const app = express();

// ============================================================================
// Core Middleware Configuration
// ============================================================================

// Enable Cross-Origin Resource Sharing for the Vite React frontend
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);

// Low-Bandwidth Empathy: Parse JSON payloads with reasonable size boundaries (1MB max)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging in development
if (env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// ============================================================================
// Diagnostic & Health Endpoints
// ============================================================================

/**
 * Root endpoint - Service overview
 */
app.get('/', (req, res) => {
  res.json({
    service: 'SyncScholar Backend API',
    description: 'Curriculum-grounded Socratic tutoring & formative micro-assessments for SDG 4',
    version: '0.1.0',
    documentation: '/docs',
    healthCheck: '/api/health',
  });
});

/**
 * GET /api/health
 * Observability endpoint reporting live server telemetry and MongoDB Atlas connection status.
 */
app.get('/api/health', (req, res) => {
  const dbStatus = getDBStatus();
  const isHealthy = dbStatus.isConnected;

  const responsePayload = {
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'syncscholar-backend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    database: {
      status: dbStatus.state,
      readyState: dbStatus.readyState,
      host: dbStatus.host,
      name: dbStatus.databaseName,
    },
    models: {
      CurriculumChunk: 'registered',
      User: 'registered',
      QuizAttempt: 'registered',
    },
  };

  const httpStatus = isHealthy ? 200 : 503;
  return res.status(httpStatus).json(responsePayload);
});

// ============================================================================
// Fallback 404 & Global Error Handling
// ============================================================================

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Centralized Error Handler Middleware
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

export default app;
