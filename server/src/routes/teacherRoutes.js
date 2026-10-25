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

/**
 * @route   GET /api/teacher/heatmap
 * @desc    Get Classroom Weak-Spot Heatmap aggregating quiz attempt errors by learning_objective_id
 *          and highlighting frequent misconception tags for blackboard review.
 * @access  Protected (Teacher, Admin)
 */
router.get('/heatmap', protect, authorizeRoles('teacher', 'admin'), async (req, res) => {
  try {
    const teacher = req.user;
    const { grade_level, subject } = req.query;

    const matchStage = {};
    if (grade_level) {
      matchStage.grade_level = Number(grade_level);
    } else if (teacher.assigned_grades?.length > 0) {
      matchStage.grade_level = { $in: teacher.assigned_grades };
    }

    if (subject) {
      matchStage.subject = subject.toLowerCase().trim();
    }

    // 1. Aggregate Quiz Attempts by learning_objective_id
    const heatmapPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: '$learning_objective_id',
          subject: { $first: '$subject' },
          grade_level: { $first: '$grade_level' },
          total_attempts: { $sum: 1 },
          total_score: { $sum: '$score' },
          total_max_score: { $sum: '$max_score' },
          all_incorrect_tags: { $push: '$incorrect_question_tags' },
        },
      },
      {
        $project: {
          learning_objective_id: '$_id',
          subject: 1,
          grade_level: 1,
          total_attempts: 1,
          average_score: { $divide: ['$total_score', '$total_attempts'] },
          average_accuracy: {
            $cond: [
              { $gt: ['$total_max_score', 0] },
              { $divide: ['$total_score', '$total_max_score'] },
              0,
            ],
          },
          all_incorrect_tags: 1,
        },
      },
      { $sort: { average_accuracy: 1 } }, // Lowest accuracy first (weakest concepts)
    ];

    const attemptsSummary = await (await import('../models/QuizAttempt.js')).default.aggregate(heatmapPipeline);

    // Format results with tag frequency distribution
    const heatmap = attemptsSummary.map((item) => {
      const flattenedTags = item.all_incorrect_tags.flat().filter(Boolean);
      const tagCounts = {};
      flattenedTags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });

      const sortedMisconceptions = Object.entries(tagCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);

      const avgAccuracy = Number(item.average_accuracy.toFixed(3));
      let recommendation = 'Blackboard Review Recommended';
      if (avgAccuracy >= 0.8) recommendation = 'Mastery Achieved';
      else if (avgAccuracy >= 0.5) recommendation = 'Moderate Reinforcement Needed';

      return {
        learning_objective_id: item.learning_objective_id,
        subject: item.subject,
        grade_level: item.grade_level,
        total_attempts: item.total_attempts,
        average_accuracy: avgAccuracy,
        accuracy_percentage: `${(avgAccuracy * 100).toFixed(1)}%`,
        recommendation,
        top_misconceptions: sortedMisconceptions,
      };
    });

    return res.status(200).json({
      success: true,
      count: heatmap.length,
      data: heatmap,
    });
  } catch (error) {
    console.error('Teacher Heatmap Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate classroom weak-spot heatmap.',
    });
  }
});

export default router;
