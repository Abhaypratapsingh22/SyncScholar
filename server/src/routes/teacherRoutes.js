/**
 * @file teacherRoutes.js
 * @description Teacher classroom and analytics endpoints for SyncScholar.
 * Enforces JWT authentication and teacher role authorization.
 */

import express from 'express';
import { protect, authorizeRoles } from '../middlewares/authMiddleware.js';
import User from '../models/User.js';

const router = express.Router();

/**
 * @route   GET /api/teacher/overview
 * @desc    Get teacher profile, assigned grades, and school student count
 * @access  Protected (Teacher, Admin)
 */
router.get('/overview', protect, authorizeRoles('teacher', 'admin'), async (req, res) => {
  try {
    const teacher = req.user;

    // Get count of registered students in the teacher's school and assigned grades
    const studentCount = await User.countDocuments({
      school_id: teacher.school_id,
      role: 'student',
      current_grade: { $in: teacher.assigned_grades || [] },
    });

    return res.status(200).json({
      success: true,
      teacher: {
        id: teacher._id,
        name: teacher.name,
        school_id: teacher.school_id,
        email: teacher.email,
        assigned_grades: teacher.assigned_grades,
      },
      classroom_summary: {
        enrolled_students: studentCount,
      },
    });
  } catch (error) {
    console.error('Teacher Overview Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve teacher overview.',
    });
  }
});

export default router;
