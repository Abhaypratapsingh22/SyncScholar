/**
 * @file studentRoutes.js
 * @description Student learning and profile endpoints for SyncScholar.
 * Enforces JWT authentication and student role authorization.
 */

import express from 'express';
import { getStudentProfile } from '../controllers/studentController.js';
import { protect, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/student/profile
 * @desc    Get authenticated student profile, mastery summary, and recent attempts
 * @access  Protected (Student, Admin)
 */
router.get('/profile', protect, authorizeRoles('student', 'admin'), getStudentProfile);

export default router;
