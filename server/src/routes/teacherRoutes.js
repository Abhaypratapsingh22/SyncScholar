/**
 * @file teacherRoutes.js
 * @description Teacher classroom and analytics endpoints for SyncScholar.
 * Enforces JWT authentication and teacher role authorization.
 */

import express from 'express';
import { protect, authorizeRoles } from '../middlewares/authMiddleware.js';
import {
  getTeacherOverview,
  getWeakSpotHeatmap,
  getStrugglingStudents,
} from '../controllers/teacherController.js';

const router = express.Router();

/**
 * @route   GET /api/teacher/overview
 * @desc    Get teacher profile, assigned grades, and school student count
 * @access  Protected (Teacher, Admin)
 */
router.get('/overview', protect, authorizeRoles('teacher', 'admin'), getTeacherOverview);

/**
 * @route   GET /api/teacher/heatmap
 * @desc    Get Classroom Weak-Spot Heatmap aggregating quiz attempt errors by learning_objective_id
 *          and highlighting frequent misconception tags for blackboard review.
 * @access  Protected (Teacher, Admin)
 */
router.get('/heatmap', protect, authorizeRoles('teacher', 'admin'), getWeakSpotHeatmap);

/**
 * @route   GET /api/teacher/objectives/:objectiveId/students
 * @desc    Get struggling students in school needing prerequisite remediation on a specific learning objective
 * @access  Protected (Teacher, Admin)
 */
router.get(
  '/objectives/:objectiveId/students',
  protect,
  authorizeRoles('teacher', 'admin'),
  getStrugglingStudents
);

export default router;
