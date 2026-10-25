/**
 * @file env.js
 * @description Centralized environment configuration and startup validation.
 * Ensures the server fails fast with clear, human-friendly guidance if any
 * critical secrets or configuration variables are missing or unconfigured.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve current directory path in ES Module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env file from the server root directory (two levels up from src/config)
const serverRootDir = path.resolve(__dirname, '../../');
dotenv.config({ path: path.join(serverRootDir, '.env') });

/**
 * Validates critical environment variables required for SyncScholar backend operation.
 * Fails fast with actionable terminal instructions if any variable is missing or placeholder.
 *
 * @returns {object} Validated environment variables object
 */
export function validateEnv() {
  const errors = [];
  const warnings = [];

  // 1. MONGODB_URI validation
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    errors.push({
      variable: 'MONGODB_URI',
      reason: 'MongoDB Atlas connection string is missing.',
      solution: 'Copy server/.env.example to server/.env and provide your MongoDB Atlas cluster URI (e.g., mongodb+srv://<user>:<password>@cluster.mongodb.net/syncscholar?retryWrites=true&w=majority).'
    });
  } else if (mongoUri.includes('<username>') || mongoUri.includes('<password>')) {
    errors.push({
      variable: 'MONGODB_URI',
      reason: 'MONGODB_URI still contains placeholder credentials ("<username>" or "<password>").',
      solution: 'Update server/.env with your real MongoDB Atlas database username and password.'
    });
  }

  // 2. PORT validation
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  if (isNaN(port) || port <= 0 || port > 65535) {
    errors.push({
      variable: 'PORT',
      reason: `Configured PORT "${process.env.PORT}" is not a valid network port number.`,
      solution: 'Set PORT in server/.env to an integer between 1024 and 65535 (default: 5000).'
    });
  }

  // 3. GEMINI_API_KEY validation
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    errors.push({
      variable: 'GEMINI_API_KEY',
      reason: 'Google Gemini API Key is missing.',
      solution: 'Obtain a free API key at https://aistudio.google.com/ and set GEMINI_API_KEY in server/.env.'
    });
  } else if (geminiKey === 'your_gemini_api_key_here') {
    errors.push({
      variable: 'GEMINI_API_KEY',
      reason: 'GEMINI_API_KEY contains the default template placeholder value.',
      solution: 'Replace "your_gemini_api_key_here" in server/.env with your active Google Gemini API key.'
    });
  }

  // 4. JWT_SECRET validation
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    errors.push({
      variable: 'JWT_SECRET',
      reason: 'JWT Secret key for student/teacher session tokens is missing.',
      solution: 'Generate a secure 32+ character random string (e.g., `openssl rand -hex 32`) and set JWT_SECRET in server/.env.'
    });
  } else if (jwtSecret.includes('your_jwt_super_secret') || jwtSecret.length < 16) {
    warnings.push({
      variable: 'JWT_SECRET',
      warning: 'JWT_SECRET appears to be a placeholder or shorter than 16 characters. Use a secure 32-byte secret for production security.'
    });
  }

  // If any fatal validation errors exist, display friendly formatted diagnostic and terminate process
  if (errors.length > 0) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ SYNCSCHOLAR PRE-FLIGHT ENVIRONMENT VALIDATION FAILED');
    console.error('='.repeat(80));
    console.error(`\nThe server cannot start safely because ${errors.length} required environment variable(s) are missing or invalid:\n`);

    errors.forEach((err, idx) => {
      console.error(`  [${idx + 1}] Missing or Invalid: ${err.variable}`);
      console.error(`      Reason:   ${err.reason}`);
      console.error(`      Solution: ${err.solution}\n`);
    });

    console.error('📋 Quick Fix Instructions:');
    console.error('  1. Navigate to /server directory:');
    console.error('     cd server');
    console.error('  2. Copy template file:');
    console.error('     cp .env.example .env   (or copy .env.example .env in PowerShell)');
    console.error('  3. Open server/.env and fill in MONGODB_URI, GEMINI_API_KEY, and JWT_SECRET.');
    console.error('='.repeat(80) + '\n');

    process.exit(1);
  }

  // Print non-fatal warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️ SYNCSCHOLAR ENVIRONMENT CONFIGURATION WARNINGS:');
    warnings.forEach((warn, idx) => {
      console.warn(`  [${idx + 1}] ${warn.variable}: ${warn.warning}`);
    });
    console.warn('');
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port,
    MONGODB_URI: mongoUri,
    GEMINI_API_KEY: geminiKey,
    JWT_SECRET: jwtSecret,
    CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  };
}

// Export validated configuration singleton
export const env = {
  get NODE_ENV() { return process.env.NODE_ENV || 'development'; },
  get PORT() { return process.env.PORT ? parseInt(process.env.PORT, 10) : 5000; },
  get MONGODB_URI() { return process.env.MONGODB_URI; },
  get GEMINI_API_KEY() { return process.env.GEMINI_API_KEY; },
  get JWT_SECRET() { return process.env.JWT_SECRET; },
  get CLIENT_URL() { return process.env.CLIENT_URL || 'http://localhost:5173'; },
};
