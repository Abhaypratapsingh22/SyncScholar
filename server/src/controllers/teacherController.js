/**
 * @file teacherController.js
 * @description Controller for teacher dashboard analytics in SyncScholar.
 * Handles the Classroom Weak-Spot Heatmap and struggling students drill-down endpoints.
 */

import teacherAnalyticsService from '../services/teacherAnalyticsService.js';

/**
 * GET /api/teacher/overview
 * Returns teacher profile, assigned grades, and total enrolled student count.
 * Access: Protected (Teacher, Admin)
 */
export async function getTeacherOverview(req, res) {
  try {
    const overview = await teacherAnalyticsService.getTeacherOverviewSummary({
      teacher: req.user,
    });

    return res.status(200).json({
      success: true,
      ...overview,
    });
  } catch (error) {
    console.error('[teacherController] Overview Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve teacher classroom overview.',
    });
  }
}

/**
 * GET /api/teacher/heatmap
 * Generates the Classroom Weak-Spot Heatmap aggregating student mastery and quiz error tags.
 * Query params:
 * - grade_level: optional number (must be in teacher's assigned_grades if defined)
 * - subject: optional string (e.g. 'science')
 * Access: Protected (Teacher, Admin)
 */
export async function getWeakSpotHeatmap(req, res) {
  try {
    const teacher = req.user;
    const { grade_level, subject } = req.query;

    let parsedGrade = null;
    if (grade_level !== undefined && grade_level !== '') {
      parsedGrade = Number(grade_level);
      if (isNaN(parsedGrade) || parsedGrade < 1 || parsedGrade > 12) {
        return res.status(400).json({
          success: false,
          message: 'Invalid grade_level. Must be an integer between 1 and 12.',
        });
      }

      // Check teacher's assigned grades authorization
      if (
        Array.isArray(teacher.assigned_grades) &&
        teacher.assigned_grades.length > 0 &&
        !teacher.assigned_grades.includes(parsedGrade)
      ) {
        return res.status(403).json({
          success: false,
          message: `Access denied. You are not assigned to Grade ${parsedGrade}. Assigned grades: ${teacher.assigned_grades.join(', ')}.`,
        });
      }
    }

    const heatmap = await teacherAnalyticsService.getClassroomWeakSpotHeatmap({
      schoolId: teacher.school_id,
      assignedGrades: teacher.assigned_grades || [],
      gradeLevel: parsedGrade,
      subject: subject || null,
    });

    return res.status(200).json({
      success: true,
      count: heatmap.length,
      data: heatmap,
    });
  } catch (error) {
    console.error('[teacherController] Heatmap Aggregation Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate classroom weak-spot heatmap.',
    });
  }
}

/**
 * GET /api/teacher/objectives/:objectiveId/students
 * Returns the list of students in the teacher's school needing prerequisite remediation
 * on a specific learning objective, along with their last quiz attempt score and timestamp.
 * Access: Protected (Teacher, Admin)
 */
export async function getStrugglingStudents(req, res) {
  try {
    const teacher = req.user;
    const { objectiveId } = req.params;
    const { grade_level } = req.query;

    if (!objectiveId || typeof objectiveId !== 'string' || !objectiveId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A valid objectiveId URL parameter is required.',
      });
    }

    let parsedGrade = null;
    if (grade_level !== undefined && grade_level !== '') {
      parsedGrade = Number(grade_level);
      if (isNaN(parsedGrade) || parsedGrade < 1 || parsedGrade > 12) {
        return res.status(400).json({
          success: false,
          message: 'Invalid grade_level. Must be an integer between 1 and 12.',
        });
      }

      if (
        Array.isArray(teacher.assigned_grades) &&
        teacher.assigned_grades.length > 0 &&
        !teacher.assigned_grades.includes(parsedGrade)
      ) {
        return res.status(403).json({
          success: false,
          message: `Access denied. You are not assigned to Grade ${parsedGrade}. Assigned grades: ${teacher.assigned_grades.join(', ')}.`,
        });
      }
    }

    const students = await teacherAnalyticsService.getStrugglingStudentsForObjective({
      schoolId: teacher.school_id,
      objectiveId: objectiveId.trim(),
      assignedGrades: teacher.assigned_grades || [],
      gradeLevel: parsedGrade,
    });

    return res.status(200).json({
      success: true,
      learning_objective_id: objectiveId.trim(),
      struggling_count: students.length,
      data: students,
    });
  } catch (error) {
    console.error('[teacherController] Struggling Students Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve struggling students for objective.',
    });
  }
}

export default {
  getTeacherOverview,
  getWeakSpotHeatmap,
  getStrugglingStudents,
};
