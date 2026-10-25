/**
 * @file indexedDb.js
 * @description Dexie.js IndexedDB schema and offline persistence layer for SyncScholar.
 * 
 * Provides offline-first storage for:
 * 1. `quizAttempts`: Queues student micro-quiz submissions locally when offline with idempotent UUIDs.
 * 2. `cachedAssessments`: Caches pre-generated diagnostic MCQs & flashcards for offline review.
 * 3. `cachedTutorThreads`: Stores recent Socratic tutor discussions and textbook citations.
 * 4. `studentSession`: Retains student profile & tokens for seamless offline authentication.
 */

import Dexie from 'dexie';

export const db = new Dexie('SyncScholarStudentDB');

// Define database schema versions
db.version(1).stores({
  quizAttempts: 'client_attempt_id, student_id, learning_objective_id, sync_status, created_at',
  cachedAssessments: 'id, subject, grade_level, learning_objective_id, cached_at',
  cachedTutorThreads: 'id, subject, student_id, created_at',
  studentSession: 'id, updated_at',
});

/**
 * Generates an RFC4122-compliant v4 UUID for idempotent submission tracking.
 * Uses crypto.randomUUID() when available, with a resilient fallback.
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

/**
 * Queues a quiz attempt into IndexedDB with 'pending' sync status.
 *
 * @param {object} attemptData
 * @returns {Promise<string>} The client_attempt_id
 */
export async function queueOfflineQuizAttempt(attemptData) {
  const record = {
    client_attempt_id: attemptData.client_attempt_id || generateClientAttemptUuid(),
    student_id: attemptData.student_id || 'offline_student',
    learning_objective_id: attemptData.learning_objective_id,
    subject: attemptData.subject,
    grade_level: attemptData.grade_level || 7,
    questions: attemptData.questions || [],
    score: attemptData.score ?? 0,
    max_score: attemptData.max_score ?? 3,
    synced_from_offline: true,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    retry_count: 0,
  };

  await db.quizAttempts.put(record);
  return record.client_attempt_id;
}

/**
 * Retrieves all pending quiz attempts awaiting synchronization.
 *
 * @returns {Promise<Array<object>>} Pending attempt records
 */
export async function getPendingQuizAttempts() {
  return await db.quizAttempts.where('sync_status').equals('pending').toArray();
}

/**
 * Marks a queued attempt as successfully synchronized.
 *
 * @param {string} clientAttemptId
 */
export async function markQuizAttemptSynced(clientAttemptId) {
  await db.quizAttempts.update(clientAttemptId, {
    sync_status: 'synced',
    synced_at: new Date().toISOString(),
  });
}

/**
 * Marks a queued attempt as failed with an error message.
 *
 * @param {string} clientAttemptId
 * @param {string} errorMessage
 */
export async function markQuizAttemptFailed(clientAttemptId, errorMessage) {
  const existing = await db.quizAttempts.get(clientAttemptId);
  await db.quizAttempts.update(clientAttemptId, {
    sync_status: 'failed',
    error_message: errorMessage,
    retry_count: (existing?.retry_count || 0) + 1,
  });
}

/**
 * Caches an assessment (MCQs + flashcards) for offline practice.
 *
 * @param {string} key - Cache identifier
 * @param {object} assessmentData - Generated assessment payload
 */
export async function cacheAssessment(key, assessmentData) {
  await db.cachedAssessments.put({
    id: key,
    subject: assessmentData.subject,
    grade_level: assessmentData.grade_level,
    learning_objective_id: assessmentData.learning_objective_id,
    topic_query: assessmentData.topic_query,
    questions: assessmentData.questions || [],
    flashcards: assessmentData.flashcards || [],
    cached_at: new Date().toISOString(),
  });
}

/**
 * Retrieves a cached assessment by key.
 *
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getCachedAssessment(key) {
  return (await db.cachedAssessments.get(key)) || null;
}

/**
 * Retrieves all cached flashcard decks for offline study.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getAllCachedFlashcardDecks() {
  return await db.cachedAssessments.toArray();
}

/**
 * Caches a student doubt query and Socratic response.
 *
 * @param {object} threadData
 */
export async function cacheTutorThread(threadData) {
  await db.cachedTutorThreads.put({
    id: threadData.id || generateClientAttemptUuid(),
    student_id: threadData.student_id || 'student',
    subject: threadData.subject,
    question: threadData.question,
    answer: threadData.answer,
    socratic_follow_up: threadData.socratic_follow_up,
    remediation_mode_active: Boolean(threadData.remediation_mode_active),
    citations: threadData.citations || [],
    created_at: new Date().toISOString(),
  });
}

/**
 * Retrieves recent cached tutor threads for offline reading.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getCachedTutorThreads() {
  return await db.cachedTutorThreads.orderBy('created_at').reverse().limit(10).toArray();
}

/**
 * Saves current student session locally.
 *
 * @param {object} session
 */
export async function saveLocalStudentSession(session) {
  await db.studentSession.put({
    id: 'current_student',
    profile: session.profile,
    token: session.token,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Retrieves saved local student session.
 *
 * @returns {Promise<object|null>}
 */
export async function getLocalStudentSession() {
  return (await db.studentSession.get('current_student')) || null;
}

export default db;
