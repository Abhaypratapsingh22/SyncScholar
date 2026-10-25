/**
 * @file assessmentController.js
 * @description Controller for formative assessment generation, idempotent quiz submissions,
 * offline batch sync, and student flashcard retrieval in SyncScholar.
 */

import assessmentService from '../services/assessmentService.js';
import QuizAttempt from '../models/QuizAttempt.js';

/**
 * POST /api/assessments/generate
 * Generates 3 diagnostic MCQs and 3 offline study flashcards grounded in verified curriculum chunks.
 */
export async function generateAssessment(req, res) {
  try {
    const { subject, learning_objective_id, learningObjectiveId, topic_query, topicQuery, grade_level } = req.body;

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: 'The "subject" field is required (e.g., "Science" or "Mathematics").',
      });
    }

    const studentGrade = grade_level || req.user?.current_grade || 7;
    const targetLoId = learning_objective_id || learningObjectiveId || null;
    const targetTopic = topic_query || topicQuery || '';

    const assessment = await assessmentService.generateDiagnosticAssessment({
      studentGrade,
      subject,
      learningObjectiveId: targetLoId,
      topicQuery: targetTopic,
    });

    return res.status(200).json({
      success: true,
      data: assessment,
    });
  } catch (error) {
    console.error('[assessmentController] Generation Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate diagnostic assessment.',
    });
  }
}

/**
 * POST /api/assessments/submit
 * Idempotently evaluates a 3-question diagnostic quiz submission and updates student EMA mastery.
 */
export async function submitQuizAttempt(req, res) {
  try {
    const {
      client_attempt_id,
      clientAttemptId,
      learning_objective_id,
      learningObjectiveId,
      subject,
      grade_level,
      questions,
      synced_from_offline,
    } = req.body;

    const attemptUuid = client_attempt_id || clientAttemptId;
    const targetLoId = learning_objective_id || learningObjectiveId;

    if (!attemptUuid) {
      return res.status(400).json({
        success: false,
        message: 'client_attempt_id UUID is required for idempotent submission.',
      });
    }

    if (!targetLoId || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Both learning_objective_id and subject are required.',
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'questions array is required and must contain at least one question.',
      });
    }

    const result = await assessmentService.recordQuizAttempt({
      studentId: req.user._id,
      clientAttemptId: attemptUuid,
      learningObjectiveId: targetLoId,
      subject,
      gradeLevel: grade_level || req.user.current_grade,
      questions,
      syncedFromOffline: Boolean(synced_from_offline),
    });

    const statusCode = result.idempotent ? 200 : 201;
    return res.status(statusCode).json({
      success: true,
      idempotent: result.idempotent,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error('[assessmentController] Submission Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record quiz submission.',
    });
  }
}

/**
 * POST /api/assessments/sync-batch
 * Resilient batch sync for offline attempts queued in Dexie.js (IndexedDB).
 * Resilient to partial failures: processes each attempt atomically.
 */
export async function syncBatchAttempts(req, res) {
  try {
    const { attempts } = req.body;

    if (!Array.isArray(attempts)) {
      return res.status(400).json({
        success: false,
        message: 'Payload must include an "attempts" array.',
      });
    }

    const batchReport = await assessmentService.syncBatchQuizAttempts({
      studentId: req.user._id,
      attempts,
    });

    return res.status(200).json({
      success: true,
      message: `Batch sync complete: ${batchReport.synced_count} synced, ${batchReport.already_synced_count} already recorded, ${batchReport.failed_count} failed.`,
      data: batchReport,
    });
  } catch (error) {
    console.error('[assessmentController] Batch Sync Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to process batch sync.',
    });
  }
}

/**
 * GET /api/assessments/history
 * Retrieves quiz history and misconception tags for the authenticated student.
 */
export async function getStudentQuizHistory(req, res) {
  try {
    const { learning_objective_id, limit = 10 } = req.query;
    const query = { student_id: req.user._id };

    if (learning_objective_id) {
      query.learning_objective_id = new RegExp(`^${learning_objective_id}$`, 'i');
    }

    const attempts = await QuizAttempt.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.status(200).json({
      success: true,
      count: attempts.length,
      data: attempts,
    });
  } catch (error) {
    console.error('[assessmentController] History Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve assessment history.',
    });
  }
}

export default {
  generateAssessment,
  submitQuizAttempt,
  syncBatchAttempts,
  getStudentQuizHistory,
};
