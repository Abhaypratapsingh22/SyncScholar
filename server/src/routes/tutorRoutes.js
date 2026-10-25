/**
 * @file tutorRoutes.js
 * @description API routes for SyncScholar Adaptive RAG Tutor.
 * Protects endpoints with JWT authentication and student role authorization.
 */

import express from 'express';
import { handleAskTutor } from '../controllers/tutorController.js';
import { protect, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/tutor/ask
 * @desc    Submit a question to the curriculum-grounded Socratic RAG tutor
 * @access  Protected (Student, Admin)
 */
router.post('/ask', protect, authorizeRoles('student', 'admin'), handleAskTutor);

export default router;
