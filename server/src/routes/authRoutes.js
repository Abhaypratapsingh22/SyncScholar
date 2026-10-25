/**
 * @file authRoutes.js
 * @description Authentication routing endpoints for SyncScholar.
 * Exposes registration, login, and token-verification endpoints.
 */

import express from 'express';
import { register, login, getMe } from '../controllers/authController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new Student or Teacher account
 * @access  Public
 */
router.post('/register', register);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user via email or roll number + password
 * @access  Public
 */
router.post('/login', login);

/**
 * @route   GET /api/auth/me
 * @desc    Get currently logged in user profile
 * @access  Protected (Requires Bearer JWT)
 */
router.get('/me', protect, getMe);

export default router;
