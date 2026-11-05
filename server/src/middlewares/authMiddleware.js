/**
 * @file authMiddleware.js
 * @description Authentication and Role-Based Access Control (RBAC) middleware for SyncScholar.
 * Supports Clerk authentication session tokens (primary), local JWT bearer tokens,
 * and seamless classroom guest mode for low-resource environments (SDG 4).
 */

import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { verifyToken } from '@clerk/express';
import { env } from '../config/env.js';
import User from '../models/User.js';

/**
 * Protect middleware:
 * 1. Checks Clerk authentication (verifyToken via JWKS).
 * 2. Checks local JWT signature via JWT_SECRET.
 * 3. Supports Classroom Guest / Offline Student mode if no credentials are provided or on learning routes.
 * 4. Validates user existence and attaches sanitized user object to req.user.
 */
export async function protect(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.__session) {
    token = req.cookies.__session;
  }

  // 1. If Token is provided, attempt Clerk verification first
  const clerkPubKey = env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (token && (clerkPubKey || env.CLERK_SECRET_KEY)) {
    try {
      const payload = await verifyToken(token, {
        publishableKey: clerkPubKey,
        secretKey: env.CLERK_SECRET_KEY || undefined,
      });

      if (payload && payload.sub) {
        let user = await User.findOne({ clerk_id: payload.sub });

        if (!user) {
          // Auto-provision user record in MongoDB Atlas linked to Clerk
          user = await User.create({
            clerk_id: payload.sub,
            name: payload.name || payload.email || 'Student',
            email: payload.email || undefined,
            role: 'student',
            school_id: 'SCH-MAIN-01',
            current_grade: 9,
            concept_mastery: [],
          });
        }

        req.user = user;
        req.auth = { userId: payload.sub, claims: payload };
        return next();
      }
    } catch {
      // Not a valid Clerk token or signature mismatch; proceed to local JWT verification
    }
  }

  // 2. Attempt Local JWT Verification
  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password_hash');

      if (user) {
        req.user = user;
        return next();
      }
    } catch {
      // If token is invalid or expired, continue to check if route allows classroom fallback
    }
  }

  // 3. Low-Resource Classroom Guest Fallback (AGENTS.md SDG 4 Requirement)
  // For student tutoring and formative learning endpoints, gracefully fall back to a classroom student
  // rather than showing an error banner or blocking the student from learning
  const isTutorOrLearningRoute =
    req.baseUrl.includes('tutor') ||
    req.path.includes('ask') ||
    req.headers['x-classroom-mode'] === 'true';

  if (!token || isTutorOrLearningRoute) {
    req.user = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Classroom Student',
      role: 'student',
      school_id: 'SCH-MAIN-01',
      current_grade: 9,
      concept_mastery: [],
      isClassroomGuest: true,
    };
    return next();
  }

  // 4. For strictly protected administrative / teacher routes, require valid auth
  return res.status(401).json({
    success: false,
    message: 'Authentication session expired. Please log in again.',
  });
}

/**
 * Role authorization middleware factory: Restricts endpoint access to specific user roles.
 * 
 * @param {...string} roles - Permitted user roles (e.g. 'teacher', 'student', 'admin')
 * @returns {Function} Express middleware function
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
