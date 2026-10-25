/**
 * @file offlineDb.js
 * @description Dexie.js IndexedDB schema and offline persistence store for SyncScholar.
 * 
 * Provides resilient, structured local storage for:
 * 1. `cached_flashcards`: Local curriculum flashcard decks indexed by subject and learning_objective_id.
 * 2. `cached_quizzes`: Pre-fetched 3-question diagnostic quizzes for offline formative practice.
 * 3. `cached_tutor_history`: Socratic tutor explanations, analogies, and textbook citations.
 * 4. `pending_quiz_submissions`: Queued offline quiz attempts with idempotent client_attempt_id UUIDs.
 * 5. `student_session`: Local student profile and JWT persistence for offline-ready auth.
 */

import Dexie from 'dexie';

export const db = new Dexie('SyncScholarOfflineDB');

// Database schema definition
db.version(1).stores({
  cached_flashcards: 'id, subject, learning_objective_id, grade_level, cached_at',
  cached_quizzes: 'id, subject, learning_objective_id, grade_level, cached_at',
  cached_tutor_history: 'id, subject, student_id, created_at',
  pending_quiz_submissions: 'client_attempt_id, learning_objective_id, sync_status, created_at',
  student_session: 'id, updated_at',
});

/**
 * Generates an RFC4122 v4 UUID for idempotent submission tracking.
 * Resilient against environments where crypto.randomUUID may be restricted.
 *
 * @returns {string} Unique client attempt UUID
 */
export function generateClientAttemptUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// 1. CACHED FLASHCARDS
// =============================================================================

/**
 * Caches a flashcard deck for offline study.
 *
 * @param {object} deck - { id, subject, learning_objective_id, grade_level, cards }
 */
export async function cacheFlashcardDeck(deck) {
  const recordId = deck.id || `${deck.subject || 'Science'}_${deck.learning_objective_id || 'GENERAL'}`;
  await db.cached_flashcards.put({
    id: recordId,
    subject: deck.subject || 'Science',
    learning_objective_id: deck.learning_objective_id || 'GENERAL',
    grade_level: deck.grade_level || 7,
    topic_query: deck.topic_query || '',
    cards: deck.cards || deck.flashcards || [],
    cached_at: new Date().toISOString(),
  });
  return recordId;
}

/**
 * Retrieves cached flashcards matching subject and learning objective.
 *
 * @param {string} subject
 * @param {string} learningObjectiveId
 * @returns {Promise<object|null>}
 */
export async function getCachedFlashcards(subject, learningObjectiveId) {
  if (!learningObjectiveId) return null;
  const match = await db.cached_flashcards
    .where('learning_objective_id')
    .equalsIgnoreCase(learningObjectiveId)
    .first();
  return match || null;
}

/**
 * Retrieves all locally cached flashcard decks.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getAllCachedFlashcardDecks() {
  return await db.cached_flashcards.toArray();
}

// =============================================================================
// 2. CACHED QUIZZES
// =============================================================================

/**
 * Caches a 3-question diagnostic micro-quiz for offline practice.
 *
 * @param {object} quiz - { id, subject, learning_objective_id, grade_level, questions }
 */
export async function cacheQuiz(quiz) {
  const recordId = quiz.id || `${quiz.subject || 'Science'}_${quiz.learning_objective_id || 'GENERAL'}`;
  await db.cached_quizzes.put({
    id: recordId,
    subject: quiz.subject || 'Science',
    learning_objective_id: quiz.learning_objective_id || 'GENERAL',
    grade_level: quiz.grade_level || 7,
    topic_query: quiz.topic_query || '',
    questions: quiz.questions || [],
    cached_at: new Date().toISOString(),
  });
  return recordId;
}

/**
 * Retrieves a cached diagnostic quiz by subject and learning objective.
 *
 * @param {string} subject
 * @param {string} learningObjectiveId
 * @returns {Promise<object|null>}
 */
export async function getCachedQuiz(subject, learningObjectiveId) {
  if (!learningObjectiveId) return null;
  const match = await db.cached_quizzes
    .where('learning_objective_id')
    .equalsIgnoreCase(learningObjectiveId)
    .first();
  return match || null;
}

/**
 * Retrieves all cached diagnostic quizzes.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getAllCachedQuizzes() {
  return await db.cached_quizzes.toArray();
}

// =============================================================================
// 3. CACHED TUTOR HISTORY
// =============================================================================

/**
 * Caches a student question, socratic explanation, and textbook citations.
 *
 * @param {object} threadData
 */
export async function cacheTutorHistory(threadData) {
  const record = {
    id: threadData.id || generateClientAttemptUuid(),
    student_id: threadData.student_id || 'offline_student',
    subject: threadData.subject || 'Science',
    learning_objective_id: threadData.learning_objective_id || null,
    question: threadData.question,
    answer: threadData.answer,
    socratic_follow_up: threadData.socratic_follow_up,
    remediation_mode_active: Boolean(threadData.remediation_mode_active),
    citations: threadData.citations || [],
    created_at: new Date().toISOString(),
  };
  await db.cached_tutor_history.put(record);
  return record.id;
}

/**
 * Retrieves recent cached tutor exchanges for offline revision.
 *
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
export async function getCachedTutorHistory(studentId = null, limit = 15) {
  if (studentId) {
    const list = await db.cached_tutor_history
      .where('student_id')
      .equals(studentId)
      .toArray();
    return list
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
  return await db.cached_tutor_history
    .orderBy('created_at')
    .reverse()
    .limit(limit)
    .toArray();
}

// =============================================================================
// 4. PENDING QUIZ SUBMISSIONS (IDEMPOTENT OFFLINE QUEUE)
// =============================================================================

/**
 * Queues a quiz submission into pending_quiz_submissions with 'pending' sync status.
 *
 * @param {object} submissionPayload - Quiz attempt details
 * @returns {Promise<string>} The client_attempt_id
 */
export async function queuePendingQuizSubmission(submissionPayload) {
  const clientAttemptId = submissionPayload.client_attempt_id || generateClientAttemptUuid();
  const record = {
    client_attempt_id: clientAttemptId,
    learning_objective_id: submissionPayload.learning_objective_id,
    subject: submissionPayload.subject || 'Science',
    grade_level: submissionPayload.grade_level || 7,
    student_id: submissionPayload.student_id || 'offline_student',
    payload: {
      client_attempt_id: clientAttemptId,
      learning_objective_id: submissionPayload.learning_objective_id,
      subject: submissionPayload.subject || 'Science',
      grade_level: submissionPayload.grade_level || 7,
      questions: submissionPayload.questions || [],
      score: submissionPayload.score ?? 0,
      max_score: submissionPayload.max_score ?? 3,
      synced_from_offline: true,
    },
    score: submissionPayload.score ?? 0,
    max_score: submissionPayload.max_score ?? 3,
    sync_status: 'pending',
    retry_count: 0,
    created_at: new Date().toISOString(),
  };

  await db.pending_quiz_submissions.put(record);
  return clientAttemptId;
}

/**
 * Retrieves all pending quiz submissions waiting to sync.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getPendingQuizSubmissions() {
  return await db.pending_quiz_submissions
    .where('sync_status')
    .equals('pending')
    .toArray();
}

/**
 * Marks a queued quiz submission as synced.
 *
 * @param {string} clientAttemptId
 */
export async function markQuizSubmissionSynced(clientAttemptId) {
  await db.pending_quiz_submissions.update(clientAttemptId, {
    sync_status: 'synced',
    synced_at: new Date().toISOString(),
  });
}

/**
 * Marks a queued quiz submission as failed.
 *
 * @param {string} clientAttemptId
 * @param {string} errorMessage
 */
export async function markQuizSubmissionFailed(clientAttemptId, errorMessage) {
  const existing = await db.pending_quiz_submissions.get(clientAttemptId);
  await db.pending_quiz_submissions.update(clientAttemptId, {
    sync_status: 'pending',
    error_message: errorMessage,
    retry_count: (existing?.retry_count || 0) + 1,
    last_attempted_at: new Date().toISOString(),
  });
}

/**
 * Clears or deletes synced quiz submissions to maintain a clean local store.
 *
 * @param {Array<string>} clientAttemptIds - Optional list of IDs to remove; if omitted, removes all synced
 */
export async function clearSyncedQuizSubmissions(clientAttemptIds = null) {
  if (Array.isArray(clientAttemptIds) && clientAttemptIds.length > 0) {
    await db.pending_quiz_submissions.bulkDelete(clientAttemptIds);
    return;
  }
  const synced = await db.pending_quiz_submissions
    .where('sync_status')
    .equals('synced')
    .toArray();
  const ids = synced.map((item) => item.client_attempt_id);
  if (ids.length > 0) {
    await db.pending_quiz_submissions.bulkDelete(ids);
  }
}

// =============================================================================
// 5. LOCAL STUDENT SESSION
// =============================================================================

/**
 * Stores student session info locally for offline resilience.
 *
 * @param {object} session
 */
export async function saveLocalStudentSession(session) {
  await db.student_session.put({
    id: 'current_student',
    profile: session.profile,
    token: session.token,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Retrieves local student session info.
 *
 * @returns {Promise<object|null>}
 */
export async function getLocalStudentSession() {
  return (await db.student_session.get('current_student')) || null;
}

/**
 * Clears saved local student session upon logout.
 */
export async function clearLocalStudentSession() {
  await db.student_session.delete('current_student');
}

// =============================================================================
// 6. BACKWARD COMPATIBILITY BRIDGES FOR EXISTING CODE
// =============================================================================

export const queueOfflineQuizAttempt = queuePendingQuizSubmission;
export const getPendingQuizAttempts = getPendingQuizSubmissions;
export const markQuizAttemptSynced = markQuizSubmissionSynced;
export const markQuizAttemptFailed = markQuizSubmissionFailed;

export async function cacheAssessment(key, assessmentData) {
  if (assessmentData.flashcards && assessmentData.flashcards.length > 0) {
    await cacheFlashcardDeck({
      id: `${key}_flashcards`,
      subject: assessmentData.subject,
      learning_objective_id: assessmentData.learning_objective_id,
      grade_level: assessmentData.grade_level,
      topic_query: assessmentData.topic_query,
      cards: assessmentData.flashcards,
    });
  }
  if (assessmentData.questions && assessmentData.questions.length > 0) {
    await cacheQuiz({
      id: `${key}_quiz`,
      subject: assessmentData.subject,
      learning_objective_id: assessmentData.learning_objective_id,
      grade_level: assessmentData.grade_level,
      topic_query: assessmentData.topic_query,
      questions: assessmentData.questions,
    });
  }
}

export async function getCachedAssessment(key) {
  const flashcardDeck = await db.cached_flashcards.get(`${key}_flashcards`) || await db.cached_flashcards.get(key);
  const quizDeck = await db.cached_quizzes.get(`${key}_quiz`) || await db.cached_quizzes.get(key);

  if (!flashcardDeck && !quizDeck) return null;

  return {
    id: key,
    subject: flashcardDeck?.subject || quizDeck?.subject || 'Science',
    grade_level: flashcardDeck?.grade_level || quizDeck?.grade_level || 7,
    learning_objective_id: flashcardDeck?.learning_objective_id || quizDeck?.learning_objective_id || 'SCI-07-HEAT-04',
    topic_query: flashcardDeck?.topic_query || quizDeck?.topic_query || '',
    questions: quizDeck?.questions || [],
    flashcards: flashcardDeck?.cards || [],
  };
}

export const cacheTutorThread = cacheTutorHistory;
export const getCachedTutorThreads = getCachedTutorHistory;

export default db;
