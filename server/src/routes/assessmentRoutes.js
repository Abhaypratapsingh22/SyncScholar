/**
 * @file assessmentRoutes.js
 * @description Express routing for SyncScholar formative assessment engine.
 * Protects endpoints with JWT authentication and student role authorization.
 */

import express from 'express';
import {
  generateAssessment,
  submitQuizAttempt,
  syncBatchAttempts,
  getStudentQuizHistory,
} from '../controllers/assessmentController.js';
import { protect, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All assessment endpoints are protected for authenticated students and admins
router.use(protect);
router.use(authorizeRoles('student', 'admin'));

/**
 * @route   POST /api/assessments/generate
 * @desc    Generate 3 diagnostic MCQs and 3 offline study flashcards from textbook chunks
 * @access  Protected (Student, Admin)
 */
router.post('/generate', generateAssessment);

/**
 * @route   POST /api/assessments/submit
 * @desc    Idempotently submit a quiz attempt and update EMA student mastery
 * @access  Protected (Student, Admin)
 */
router.post('/submit', submitQuizAttempt);

/**
 * @route   POST /api/assessments/sync-batch
 * @desc    Resilient batch sync for offline attempts queued in client Dexie.js
 * @access  Protected (Student, Admin)
 */
router.post('/sync-batch', syncBatchAttempts);

/**
 * @route   GET /api/assessments/history
 * @desc    Retrieve student quiz attempt history and error tags
 * @access  Protected (Student, Admin)
 */
router.get('/history', getStudentQuizHistory);

export default router;
