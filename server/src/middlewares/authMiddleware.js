/**
 * @file authMiddleware.js
 * @description Authentication and Role-Based Access Control (RBAC) middleware for SyncScholar.
 * Validates JWT bearer tokens, attaches authenticated user data to requests, and
 * enforces role-based restrictions (e.g., student-only learning routes vs. teacher analytics).
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';

/**
 * Protect middleware: Verifies JWT token and attaches sanitized user object to req.user.
 * 
 * Flow:
 * 1. Checks Authorization header for standard 'Bearer <token>' pattern.
 * 2. Decodes and verifies token signature using the server JWT secret.
 * 3. Retrieves the current user from MongoDB Atlas (excluding password hash).
 * 4. Halts request with 401 Unauthorized if token is absent, expired, or invalid.
 */
export async function protect(req, res, next) {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please provide a valid Bearer token in the Authorization header.',
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    // Retrieve active user record, omitting sensitive password hash
    const user = await User.findById(decoded.id).select('-password_hash');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed. The user belonging to this token no longer exists.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication session expired. Please log in again.',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Authentication failed. Invalid or malformed token.',
    });
  }
}

/**
 * Role authorization middleware factory: Restricts endpoint access to specific user roles.
 * 
 * @param {...string} roles - Permitted user roles (e.g. 'teacher', 'student', 'admin')
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Restrict route to teachers and administrators only:
 * router.get('/analytics', protect, authorizeRoles('teacher', 'admin'), getAnalytics);
 */
export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before verifying role permissions.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized to access this resource. Required role: ${roles.join(' or ')}.`,
      });
    }

    next();
  };
}

export default {
  protect,
  authorizeRoles,
};
