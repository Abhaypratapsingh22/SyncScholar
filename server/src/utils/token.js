/**
 * @file token.js
 * @description JWT signing and utility helpers for SyncScholar authentication.
 * Generates compact token payloads containing essential student/teacher context
 * so Progressive Web Apps (PWA) can cache role and grade offline.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates a signed JSON Web Token for an authenticated user.
 * 
 * @param {object} user - Mongoose user document or sanitized user object
 * @param {string} [expiresIn='7d'] - Token expiration duration (default: 7 days)
 * @returns {string} Signed JWT token string
 */
export function generateToken(user, expiresIn = '7d') {
  const payload = {
    id: user._id || user.id,
    role: user.role,
    school_id: user.school_id,
    current_grade: user.current_grade ?? null,
    assigned_grades: user.assigned_grades || [],
  };

  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

/**
 * Synchronously or asynchronously verifies a JWT token against the server secret.
 * 
 * @param {string} token - The raw JWT token string
 * @returns {object} Decoded token payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} If token is invalid or expired
 */
export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

export default {
  generateToken,
  verifyToken,
};
