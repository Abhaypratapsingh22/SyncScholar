/**
 * @file tutorController.js
 * @description Controller for student doubt-clearing and Socratic tutoring requests.
 * Enforces input validation, delegates to ragTutorService, and provides compact,
 * structured JSON responses designed with low-bandwidth empathy for 2G/3G school networks.
 */

import { askTutor } from '../services/ragTutorService.js';

/**
 * POST /api/tutor/ask
 * Handles student question submissions, checks mastery, retrieves curriculum chunks
 * via Atlas Vector Search with adaptive pre-filtering, and returns a grounded Socratic answer.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleAskTutor(req, res) {
  try {
    const student = req.user;
    const { question, subject, learningObjectiveId, grade, grade_level, conversationHistory } = req.body;
    
    // Validate targetGrade if provided
    const rawGrade = grade !== undefined ? grade : grade_level;
    let targetGrade = student?.current_grade || 9;
    if (rawGrade !== undefined && rawGrade !== null && rawGrade !== '') {
      const numGrade = Number(rawGrade);
      if (!Number.isInteger(numGrade) || numGrade < 1 || numGrade > 12) {
        return res.status(400).json({
          success: false,
          message: 'The "grade" field must be an integer between 1 and 12 if provided.',
        });
      }
      targetGrade = numGrade;
    }

    // 1. Validation
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A question is required. Please provide a clear question or homework query.',
      });
    }

    if (question.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Question is too long (maximum 1000 characters). Please be more concise.',
      });
    }

    if (subject !== undefined && subject !== null && typeof subject !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'The "subject" field must be a string if provided.',
      });
    }

    if (learningObjectiveId !== undefined && learningObjectiveId !== null && typeof learningObjectiveId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'The "learningObjectiveId" field must be a string if provided.',
      });
    }

    if (conversationHistory !== undefined && conversationHistory !== null) {
      if (!Array.isArray(conversationHistory)) {
        return res.status(400).json({
          success: false,
          message: 'The "conversationHistory" field must be an array if provided.',
        });
      }

      if (conversationHistory.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'The "conversationHistory" array must not exceed 20 turns.',
        });
      }

      const validRoles = ['student', 'user', 'tutor', 'assistant'];
      for (const turn of conversationHistory) {
        if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
          return res.status(400).json({
            success: false,
            message: 'Each item in "conversationHistory" must be an object.',
          });
        }

        const role = turn.role;
        const content = turn.content !== undefined ? turn.content : turn.text;

        if (typeof role !== 'string' || !validRoles.includes(role.toLowerCase().trim())) {
          return res.status(400).json({
            success: false,
            message: 'Each turn in "conversationHistory" must have a valid role ("student", "user", "tutor", or "assistant").',
          });
        }

        if (typeof content !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'Each turn in "conversationHistory" must have a string content or text field.',
          });
        }
      }
    }

    // 2. Delegate to RAG Tutor Service
    const result = await askTutor({
      studentId: student._id,
      subject: subject || 'Science',
      question: question.trim(),
      learningObjectiveId: learningObjectiveId || null,
      userDoc: student,
      grade: Number(targetGrade),
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[tutorController] Error processing student question:', error);

    // Provide friendly error message
    const isRateLimit =
      error?.status === 429 ||
      error?.message?.includes('429') ||
      error?.message?.includes('RESOURCE_EXHAUSTED');

    if (isRateLimit) {
      return res.status(429).json({
        success: false,
        message: 'The AI tutor is currently experiencing high demand. Please try again in a few seconds.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to generate tutor response. Please try again shortly.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

export default {
  handleAskTutor,
};
