/**
 * @file adaptiveFilterService.js
 * @description Dynamic MongoDB Atlas $vectorSearch pre-filter builder for SyncScholar.
 * Inspects student mastery scores per learning objective and automatically expands
 * search boundaries to foundational prerequisite grades when mastery drops below 0.50 (50%).
 * 
 * In accordance with AGENTS.md Architecture Guideline 6.C:
 * Always pre-filter before semantic search inside the $vectorSearch stage.
 */

import User from '../models/User.js';

/**
 * Normalizes subject names to match database collection metadata conventions.
 * Maps variants like 'science', 'sci' -> 'Science', and 'math', 'mathematics' -> 'Mathematics'.
 *
 * @param {string} subject - Raw incoming subject string
 * @returns {string} Normalized subject name
 */
export function normalizeSubject(subject = '') {
  const s = subject.trim().toLowerCase();
  if (s.startsWith('sci')) return 'Science';
  if (s.startsWith('mat')) return 'Mathematics';
  if (s.startsWith('eng')) return 'English';
  if (s.startsWith('soc') || s.startsWith('hist') || s.startsWith('geo')) return 'Social Science';
  // Capitalize first letter as fallback
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

/**
 * Builds the adaptive $vectorSearch pre-filter stage dynamically based on student mastery.
 *
 * @param {object} params
 * @param {string} params.studentId - Student user MongoDB _id
 * @param {string} params.subject - Subject name (e.g. 'Science' or 'Mathematics')
 * @param {string} [params.question] - Student question or homework query
 * @param {string} [params.learningObjectiveId] - Optional explicit learning objective ID
 * @param {object} [params.userDoc] - Optional pre-fetched user document to save DB call
 * @returns {Promise<{
 *   filter: object,
 *   remediationTriggered: boolean,
 *   studentGrade: number,
 *   masteryScore: number,
 *   learningObjectiveId: string|null,
 *   reason: string
 * }>}
 */
export async function buildAdaptiveFilter({
  studentId,
  subject,
  question = '',
  learningObjectiveId = null,
  userDoc = null,
}) {
  if (!studentId && !userDoc) {
    throw new Error('buildAdaptiveFilter requires either studentId or userDoc.');
  }

  // 1. Fetch student profile if not already supplied
  const student = userDoc || (await User.findById(studentId).lean());
  if (!student) {
    throw new Error(`Student not found with ID: ${studentId}`);
  }

  const currentGrade = Number(student.current_grade) || 7;
  const normalizedSubject = normalizeSubject(subject || 'Science');

  // 2. Locate relevant concept mastery score
  let targetMasteryRecord = null;
  const masteryList = student.concept_mastery || [];

  if (learningObjectiveId) {
    targetMasteryRecord = masteryList.find(
      (m) => m.learning_objective_id?.toUpperCase() === learningObjectiveId.toUpperCase()
    );
  }

  // If no explicit match by LO, search for any LO belonging to this subject
  if (!targetMasteryRecord && normalizedSubject) {
    const subjectMatches = masteryList.filter(
      (m) => m.subject?.toLowerCase() === normalizedSubject.toLowerCase()
    );
    if (subjectMatches.length > 0) {
      // Find lowest mastery topic to prioritize detecting struggle
      targetMasteryRecord = subjectMatches.reduce((lowest, curr) =>
        curr.mastery_score < lowest.mastery_score ? curr : lowest
      );
    }
  }

  const masteryScore = targetMasteryRecord ? targetMasteryRecord.mastery_score : 0.5;
  const matchedLoId = targetMasteryRecord ? targetMasteryRecord.learning_objective_id : learningObjectiveId;

  // 3. Evaluate Prerequisite Fallback Condition
  // When mastery score < 0.50 (50%), automatically expand retrieval to foundational grades (Grade - 1)
  const isStruggling = masteryScore < 0.5;

  if (isStruggling) {
    const prerequisiteGrade = Math.max(1, currentGrade - 1);
    const filter = {
      'metadata.subject': normalizedSubject,
      'metadata.grade_level': {
        $in: [prerequisiteGrade, currentGrade],
      },
    };

    return {
      filter,
      remediationTriggered: true,
      studentGrade: currentGrade,
      masteryScore,
      learningObjectiveId: matchedLoId || null,
      reason: `Prerequisite Fallback Mode: mastery score on ${matchedLoId || normalizedSubject} is ${(masteryScore * 100).toFixed(0)}% (< 50%). Expanding search to include Grade ${prerequisiteGrade} foundational concepts alongside Grade ${currentGrade}.`,
    };
  }

  // 4. Standard Mode (mastery >= 0.50 or new topic baseline)
  const filter = {
    'metadata.subject': normalizedSubject,
    'metadata.grade_level': currentGrade,
  };

  return {
    filter,
    remediationTriggered: false,
    studentGrade: currentGrade,
    masteryScore,
    learningObjectiveId: matchedLoId || null,
    reason: `Standard Mode: mastery score is ${(masteryScore * 100).toFixed(0)}% (>= 50%). Grounding strictly in Grade ${currentGrade} syllabus.`,
  };
}

export default {
  buildAdaptiveFilter,
  normalizeSubject,
};
