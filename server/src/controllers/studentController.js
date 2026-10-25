/**
 * @file studentController.js
 * @description Controllers for student learning profile and mastery metrics.
 * Designed with low-bandwidth empathy: produces compact, high-signal JSON payloads
 * optimized for 2G/3G classroom connectivity.
 */

import QuizAttempt from '../models/QuizAttempt.js';

/**
 * GET /api/student/profile
 * Returns the authenticated student's grade level, concept mastery summary,
 * granular learning objectives status, and recent formative micro-quiz attempts.
 */
export async function getStudentProfile(req, res) {
  try {
    const student = req.user;

    // 1. Calculate aggregated concept mastery metrics
    const masteryList = student.concept_mastery || [];
    const totalConcepts = masteryList.length;

    let masteredCount = 0;
    let remediationNeededCount = 0;
    let progressingCount = 0;
    let totalScoreSum = 0;

    for (const item of masteryList) {
      totalScoreSum += item.mastery_score;
      if (item.status === 'mastered') {
        masteredCount += 1;
      } else if (item.status === 'needs_prerequisite_remediation') {
        remediationNeededCount += 1;
      } else {
        progressingCount += 1;
      }
    }

    const averageMastery =
      totalConcepts > 0 ? Number((totalScoreSum / totalConcepts).toFixed(2)) : 0.5; // Baseline 50%

    // 2. Retrieve recent micro-quiz activity (max 5 records)
    const recentActivity = await QuizAttempt.find({ student_id: student._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('client_attempt_id learning_objective_id subject grade_level score max_score synced_from_offline createdAt')
      .lean();

    // 3. Compact payload suitable for low-bandwidth 2G/3G caching
    return res.status(200).json({
      success: true,
      profile: {
        id: student._id,
        name: student.name,
        school_id: student.school_id,
        roll_number: student.roll_number || null,
        email: student.email || null,
        current_grade: student.current_grade,
        preferred_language: student.preferred_language,
        mastery_summary: {
          total_concepts: totalConcepts,
          mastered_count: masteredCount,
          remediation_needed_count: remediationNeededCount,
          progressing_count: progressingCount,
          average_mastery: averageMastery,
        },
        concept_mastery: masteryList,
        recent_activity: recentActivity,
      },
    });
  } catch (error) {
    console.error('Student Profile Retrieval Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve student profile.',
    });
  }
}

export default {
  getStudentProfile,
};
