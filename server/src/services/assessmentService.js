/**
 * @file assessmentService.js
 * @description Formative assessment and offline-first mastery engine for SyncScholar.
 * 
 * Core Capabilities:
 * 1. Structured Assessment Generator:
 *    - Retrieves curriculum-grounded textbook chunks for the student's grade and subject.
 *    - Synthesizes 3 Diagnostic MCQs (with chapter/page citations and misconception tags)
 *      and 3 Study Flashcards (concise definitions for offline PWA caching) using Gemini.
 * 2. Idempotent Quiz Submission:
 *    - Deduplicates submissions via client-generated UUID (`client_attempt_id`) to protect
 *      rural students against double-counting on intermittent network retries.
 * 3. Exponential Moving Average (EMA) Mastery Loop:
 *    - Updates student mastery score with alpha = 0.4:
 *      new_mastery = (alpha * attempt_accuracy) + ((1 - alpha) * previous_mastery)
 *    - Automatically transitions mastery status:
 *      * < 0.50  -> 'needs_prerequisite_remediation' (triggers prerequisite fallback in RAG)
 *      * 0.50 - 0.79 -> 'progressing'
 *      * >= 0.80 -> 'mastered'
 *    - Logs incorrect question tags for the Teacher Classroom Weak-Spot Heatmap.
 * 4. Resilient Batch Sync:
 *    - Atomically processes queued offline attempts with partial-failure tolerance.
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import CurriculumChunk from '../models/CurriculumChunk.js';
import QuizAttempt from '../models/QuizAttempt.js';
import User from '../models/User.js';
import { normalizeSubject } from './adaptiveFilterService.js';
import { retrieveRelevantChunks } from './vectorSearchService.js';

// Initialize singleton Google Gen AI client with validated API key
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Primary LLM model specified by prompt mandate, with robust fallback
const PRIMARY_ASSESSMENT_MODEL = 'gemini-2.5-flash';
const FALLBACK_ASSESSMENT_MODEL = process.env.LLM_MODEL || 'gemini-3.8-flash';

// EMA smoothing factor defined in the pedagogical specification
export const EMA_ALPHA = 0.4;
export const DEFAULT_BASELINE_MASTERY = 0.5;

/**
 * Builds the strict system prompt for diagnostic quiz & flashcard generation.
 *
 * @param {number} gradeLevel - Student grade level (e.g., 7)
 * @param {string} subject - Subject name (e.g., 'Science')
 * @returns {string} System instruction
 */
function buildAssessmentSystemInstruction(gradeLevel, subject) {
  return `You are SyncScholar's Formative Assessment Engine for K-12 education under SDG 4 (Quality Education).
Your task is to generate curriculum-grounded diagnostic micro-assessments and offline-cacheable study flashcards.

STRICT PEDAGOGICAL DIRECTIVES:
1. STRICT TEXTBOOK GROUNDING:
   - Every question, option, explanation, and flashcard definition MUST be derived strictly from the provided textbook passages.
   - Zero out-of-syllabus facts, trivia, or collegiate terminology.
   - For every question explanation, cite the textbook chapter and page number found in the passage metadata (e.g. "NCERT Class ${gradeLevel} ${subject}, Chapter X, Page Y").

2. 3 DIAGNOSTIC MCQS:
   - Generate exactly 3 multiple-choice questions.
   - Each question must have exactly 4 options.
   - "correct_index" must be an integer (0, 1, 2, or 3) indicating the single correct option.
   - "concept_tag" must be a clean, machine-readable snake_case identifier representing the specific concept or misconception tested (e.g., "thermal_conduction", "conductors_vs_insulators", "mercury_thermometer_range").
   - "textbook_explanation" must explain WHY the correct option is right and cite the textbook chapter and page number.

3. 3 STUDY FLASHCARDS:
   - Generate exactly 3 study flashcards designed to be cached in the student's browser/PWA (IndexedDB) for offline self-study.
   - "front": A concise term, key question, or concept prompt (e.g., "What is Conduction?", "Definition of Thermal Insulator").
   - "back": A clear, grade-${gradeLevel}-appropriate textbook definition or principle with brief chapter/page citation.
   - "learning_objective_id": The relevant curriculum objective identifier.

4. OUTPUT FORMAT (NON-NEGOTIABLE):
   You MUST return ONLY valid JSON matching this exact schema:
   {
     "diagnostic_mcqs": [
       {
         "question": "Question text here?",
         "options": ["Option A", "Option B", "Option C", "Option D"],
         "correct_index": 0,
         "concept_tag": "concept_identifier",
         "textbook_explanation": "Explanation grounded in textbook citing chapter and page."
       }
     ],
     "study_flashcards": [
       {
         "front": "Term or question",
         "back": "Grade-appropriate textbook definition citing chapter and page",
         "learning_objective_id": "OBJECTIVE_ID"
       }
     ]
   }`;
}

/**
 * Builds user prompt supplying retrieved textbook chunks and learning target.
 */
function buildAssessmentUserPrompt({ chunks, gradeLevel, subject, learningObjectiveId, topicQuery }) {
  const passagesText = chunks
    .map((chunk, idx) => {
      const meta = chunk.metadata || {};
      return `--- PASSAGE [${idx + 1}] ---
Curriculum: ${meta.source_curriculum || 'NCERT'}
Grade: ${meta.grade_level || gradeLevel}
Subject: ${meta.subject || subject}
Chapter ${meta.chapter_number || '?'}: "${meta.chapter_title || 'General'}"
Learning Objective: ${meta.learning_objective_id || learningObjectiveId || 'N/A'}
Page Number: ${meta.page_number || 'N/A'}
Source URL: ${meta.source_url || 'N/A'}
Content:
${chunk.text}`;
    })
    .join('\n\n');

  return `TARGET CURRICULUM CONTEXT:
- Student Grade: Class ${gradeLevel}
- Subject: ${subject}
- Learning Objective ID: ${learningObjectiveId || 'Auto-detect from passages'}
- Topic Query: ${topicQuery || 'Standard Curriculum Chapter Passage'}

VERIFIED TEXTBOOK PASSAGES:
${passagesText}

Generate 3 Diagnostic MCQs and 3 Study Flashcards grounded STRICTLY in these passages. Return ONLY valid JSON.`;
}

/**
 * Calls Gemini with structured JSON output and model fallback.
 */
async function callGeminiAssessment(systemInstruction, userPrompt) {
  const modelsToTry = [PRIMARY_ASSESSMENT_MODEL, FALLBACK_ASSESSMENT_MODEL];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: userPrompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.2, // Low temperature for high factual adherence
        },
      });

      const responseText = response.text?.trim();
      if (!responseText) {
        throw new Error(`Received empty response text from model "${model}".`);
      }

      // Sanitize markdown fences if present
      const cleanedJson = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanedJson);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[assessmentService] Model "${model}" failed assessment generation: ${err.message}. Trying next candidate...`);
    }
  }

  throw lastError || new Error('All candidate models failed to generate structured assessment.');
}

/**
 * Validates and sanitizes LLM-generated assessment data to guarantee contract adherence.
 */
function validateAndSanitizeAssessment(raw, defaultLoId) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Assessment payload is not a valid JSON object.');
  }

  // 1. Validate & Sanitize MCQs
  const rawMcqs = Array.isArray(raw.diagnostic_mcqs) ? raw.diagnostic_mcqs : [];
  if (rawMcqs.length === 0) {
    throw new Error('LLM did not generate any diagnostic MCQs.');
  }

  const sanitizedMcqs = rawMcqs.slice(0, 3).map((item, idx) => {
    const question = String(item.question || `Diagnostic Question ${idx + 1}`).trim();
    let options = Array.isArray(item.options) ? item.options.map(String) : [];

    // Ensure exactly 4 options
    if (options.length < 4) {
      while (options.length < 4) {
        options.push(`Option ${options.length + 1}`);
      }
    } else if (options.length > 4) {
      options = options.slice(0, 4);
    }

    let correctIndex = Number(item.correct_index);
    if (isNaN(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      correctIndex = 0;
    }

    const conceptTag = String(
      item.concept_tag || item.tag || `concept_question_${idx + 1}`
    )
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    const explanation = String(
      item.textbook_explanation || item.explanation || 'Refer to the textbook passage for details.'
    ).trim();

    return {
      question,
      options,
      correct_index: correctIndex,
      concept_tag: conceptTag,
      textbook_explanation: explanation,
    };
  });

  // 2. Validate & Sanitize Flashcards
  const rawCards = Array.isArray(raw.study_flashcards) ? raw.study_flashcards : [];
  const sanitizedCards = rawCards.slice(0, 3).map((card, idx) => {
    return {
      front: String(card.front || `Flashcard Prompt ${idx + 1}`).trim(),
      back: String(card.back || 'Textbook concept summary.').trim(),
      learning_objective_id: String(
        card.learning_objective_id || defaultLoId || 'CURRICULUM-CORE'
      ).trim(),
    };
  });

  return {
    diagnostic_mcqs: sanitizedMcqs,
    study_flashcards: sanitizedCards,
  };
}

/**
 * Fetches textbook chunks matching the requested learning target.
 * Priority order:
 * 1. Exact match by learning_objective_id and student's grade.
 * 2. Vector search via topic query / LO ID pre-filtered by grade and subject.
 * 3. Fallback to grade syllabus chunks.
 */
export async function fetchAssessmentChunks({
  studentGrade,
  subject,
  learningObjectiveId = null,
  topicQuery = '',
}) {
  const normalizedSubject = normalizeSubject(subject || 'Science');
  let chunks = [];

  // 1. Direct match on learning_objective_id
  if (learningObjectiveId) {
    chunks = await CurriculumChunk.find({
      'metadata.grade_level': studentGrade,
      'metadata.subject': normalizedSubject,
      'metadata.learning_objective_id': new RegExp(`^${learningObjectiveId}$`, 'i'),
    })
      .limit(4)
      .lean();
  }

  // 2. If not found or topic query specified, run Vector Search with pre-filter
  if ((!chunks || chunks.length === 0) && (topicQuery || learningObjectiveId)) {
    try {
      const searchResult = await retrieveRelevantChunks({
        query: topicQuery || learningObjectiveId,
        filter: {
          'metadata.grade_level': studentGrade,
          'metadata.subject': normalizedSubject,
        },
        minRelevanceScore: 0.50, // Slightly more lenient threshold for assessment generation
      });

      if (searchResult && searchResult.chunks.length > 0) {
        chunks = searchResult.chunks;
      }
    } catch (vErr) {
      console.warn(`[assessmentService] Vector retrieval fallback warning: ${vErr.message}`);
    }
  }

  // 3. Fallback to any chunks for this subject and grade
  if (!chunks || chunks.length === 0) {
    chunks = await CurriculumChunk.find({
      'metadata.grade_level': studentGrade,
      'metadata.subject': normalizedSubject,
    })
      .limit(4)
      .lean();
  }

  return {
    chunks,
    normalizedSubject,
  };
}

/**
 * Generates 3 diagnostic MCQs and 3 offline study flashcards.
 *
 * @param {object} params
 * @param {number} params.studentGrade - Grade level (e.g. 7)
 * @param {string} params.subject - Subject (e.g. 'Science')
 * @param {string} [params.learningObjectiveId] - Curriculum objective ID
 * @param {string} [params.topicQuery] - Optional topic search string
 * @returns {Promise<object>} Structured assessment payload
 */
export async function generateDiagnosticAssessment({
  studentGrade,
  subject,
  learningObjectiveId = null,
  topicQuery = '',
}) {
  const { chunks, normalizedSubject } = await fetchAssessmentChunks({
    studentGrade,
    subject,
    learningObjectiveId,
    topicQuery,
  });

  if (!chunks || chunks.length === 0) {
    throw new Error(
      `No verified curriculum textbook chunks found for Class ${studentGrade} ${normalizedSubject}. Please verify curriculum ingestion.`
    );
  }

  const primaryLoId =
    learningObjectiveId ||
    chunks[0]?.metadata?.learning_objective_id ||
    'SCI-07-HEAT-04';

  const systemInstruction = buildAssessmentSystemInstruction(studentGrade, normalizedSubject);
  const userPrompt = buildAssessmentUserPrompt({
    chunks,
    gradeLevel: studentGrade,
    subject: normalizedSubject,
    learningObjectiveId: primaryLoId,
    topicQuery,
  });

  const rawAssessment = await callGeminiAssessment(systemInstruction, userPrompt);
  const validated = validateAndSanitizeAssessment(rawAssessment, primaryLoId);

  // Extract textbook citation references from chunks
  const citations = chunks.map((c) => ({
    chapter_number: c.metadata?.chapter_number || null,
    chapter_title: c.metadata?.chapter_title || 'Curriculum Chapter',
    page_number: c.metadata?.page_number || null,
    source_curriculum: c.metadata?.source_curriculum || 'NCERT',
    source_url: c.metadata?.source_url || null,
  }));

  return {
    learning_objective_id: primaryLoId,
    subject: normalizedSubject,
    grade_level: studentGrade,
    diagnostic_mcqs: validated.diagnostic_mcqs,
    study_flashcards: validated.study_flashcards,
    citations: citations,
    source_chunks_count: chunks.length,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Computes updated Exponential Moving Average (EMA) mastery and state transition.
 * 
 * Formula:
 * new_mastery = (alpha * attempt_accuracy) + ((1 - alpha) * previous_mastery)
 * 
 * Thresholds:
 * - below 0.50     -> 'needs_prerequisite_remediation'
 * - 0.50 to 0.79   -> 'progressing'
 * - 0.80 and above -> 'mastered'
 *
 * @param {object} params
 * @param {number} params.previousMastery - Baseline or prior mastery (0.0 to 1.0)
 * @param {number} params.score - Number of correct questions
 * @param {number} params.maxScore - Total possible score
 * @param {number} [params.alpha=EMA_ALPHA] - Smoothing factor (default 0.4)
 * @returns {object} Calculated EMA mastery result
 */
export function calculateEmaMastery({
  previousMastery = DEFAULT_BASELINE_MASTERY,
  score,
  maxScore = 3,
  alpha = EMA_ALPHA,
}) {
  const safeMaxScore = maxScore > 0 ? maxScore : 1;
  const safeScore = Math.max(0, Math.min(score, safeMaxScore));
  const attemptAccuracy = Number((safeScore / safeMaxScore).toFixed(4));

  const safePrevious = typeof previousMastery === 'number' && !isNaN(previousMastery)
    ? Math.max(0, Math.min(1, previousMastery))
    : DEFAULT_BASELINE_MASTERY;

  const rawNewMastery = (alpha * attemptAccuracy) + ((1 - alpha) * safePrevious);
  const newMastery = Number(Math.max(0, Math.min(1, rawNewMastery)).toFixed(4));

  let status = 'progressing';
  if (newMastery < 0.50) {
    status = 'needs_prerequisite_remediation';
  } else if (newMastery >= 0.80) {
    status = 'mastered';
  } else {
    status = 'progressing';
  }

  return {
    attemptAccuracy,
    previousMastery: safePrevious,
    newMastery,
    status,
    alpha,
  };
}

/**
 * Evaluates, records, and updates student mastery for a single quiz submission idempotently.
 * 
 * @param {object} params
 * @param {string} params.studentId - Student user _id
 * @param {string} params.clientAttemptId - Client UUID (v4) from IndexedDB
 * @param {string} params.learningObjectiveId - Curriculum LO ID
 * @param {string} params.subject - Subject name
 * @param {number} [params.gradeLevel] - Student grade level
 * @param {Array} params.questions - Array of question items with student choices
 * @param {boolean} [params.syncedFromOffline=false] - Whether synced from offline queue
 * @returns {Promise<object>} Evaluation and mastery loop result
 */
export async function recordQuizAttempt({
  studentId,
  clientAttemptId,
  learningObjectiveId,
  subject,
  gradeLevel,
  questions,
  syncedFromOffline = false,
}) {
  if (!clientAttemptId || typeof clientAttemptId !== 'string') {
    throw new Error('client_attempt_id UUID is required for idempotent submission.');
  }

  if (!learningObjectiveId || !subject) {
    throw new Error('learning_objective_id and subject are required.');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions array must contain at least 1 question item.');
  }

  // 1. IDEMPOTENCY CHECK: Return existing record if already processed
  const existingAttempt = await QuizAttempt.findOne({ client_attempt_id: clientAttemptId });
  if (existingAttempt) {
    const student = await User.findById(studentId).lean();
    const existingMastery = student?.concept_mastery?.find(
      (m) => m.learning_objective_id?.toUpperCase() === learningObjectiveId.toUpperCase()
    );

    return {
      idempotent: true,
      message: 'Quiz attempt was already recorded. Returning previous result without re-scoring.',
      attempt: existingAttempt,
      concept_mastery: existingMastery || null,
    };
  }

  // 2. Fetch student user document
  const student = await User.findById(studentId);
  if (!student) {
    throw new Error(`Student not found with ID: ${studentId}`);
  }

  const effectiveGrade = gradeLevel || student.current_grade || 7;
  const normalizedSubject = subject.toLowerCase().trim();

  // 3. Evaluate Questions & Collect Misconception Tags
  let score = 0;
  const evaluatedQuestions = [];
  const incorrectTags = [];

  for (const q of questions) {
    const questionText = q.question_text || q.question || 'Diagnostic question';
    const options = Array.isArray(q.options) ? q.options : ['A', 'B', 'C', 'D'];
    const selectedIdx = Number(q.selected_option_index ?? q.selected_index ?? -1);
    const correctIdx = Number(q.correct_option_index ?? q.correct_index ?? 0);
    const isCorrect = selectedIdx === correctIdx;

    if (isCorrect) {
      score += 1;
    } else {
      const tag = (q.concept_tag || q.tag || 'general_misconception').trim();
      if (tag && !incorrectTags.includes(tag)) {
        incorrectTags.push(tag);
      }
    }

    evaluatedQuestions.push({
      question_text: questionText,
      options: options,
      selected_option_index: Math.max(0, selectedIdx),
      correct_option_index: correctIdx,
      is_correct: isCorrect,
      explanation: q.explanation || q.textbook_explanation || '',
      tag: q.concept_tag || q.tag || null,
    });
  }

  const maxScore = evaluatedQuestions.length;

  // 4. Locate Previous Mastery or initialize at baseline 0.50
  const normalizedLoId = learningObjectiveId.trim().toUpperCase();
  const masteryIndex = student.concept_mastery.findIndex(
    (m) => m.learning_objective_id?.toUpperCase() === normalizedLoId
  );

  let previousMastery = DEFAULT_BASELINE_MASTERY;
  let attemptsCount = 0;

  if (masteryIndex >= 0) {
    previousMastery = student.concept_mastery[masteryIndex].mastery_score;
    attemptsCount = student.concept_mastery[masteryIndex].attempts_count || 0;
  }

  // 5. Compute Exponential Moving Average (alpha = 0.4)
  const emaResult = calculateEmaMastery({
    previousMastery,
    score,
    maxScore,
    alpha: EMA_ALPHA,
  });

  const updatedMasteryRecord = {
    learning_objective_id: learningObjectiveId.trim(),
    subject: normalizedSubject,
    mastery_score: emaResult.newMastery,
    attempts_count: attemptsCount + 1,
    status: emaResult.status,
    last_reviewed: new Date(),
  };

  if (masteryIndex >= 0) {
    student.concept_mastery[masteryIndex] = updatedMasteryRecord;
  } else {
    student.concept_mastery.push(updatedMasteryRecord);
  }

  await student.save();

  // 6. Persist QuizAttempt with Client UUID for Idempotency
  const quizAttemptDoc = await QuizAttempt.create({
    client_attempt_id: clientAttemptId,
    student_id: student._id,
    learning_objective_id: learningObjectiveId.trim(),
    subject: normalizedSubject,
    grade_level: effectiveGrade,
    questions: evaluatedQuestions,
    score: score,
    max_score: maxScore,
    incorrect_question_tags: incorrectTags,
    synced_from_offline: Boolean(syncedFromOffline),
  });

  return {
    idempotent: false,
    message: 'Quiz attempt processed and mastery updated successfully.',
    attempt: quizAttemptDoc,
    ema_update: {
      attempt_accuracy: emaResult.attemptAccuracy,
      previous_mastery: emaResult.previousMastery,
      new_mastery: emaResult.newMastery,
      status: emaResult.status,
      alpha: emaResult.alpha,
      status_flipped: emaResult.status !== (masteryIndex >= 0 ? student.concept_mastery[masteryIndex]?.status : 'progressing'),
    },
    concept_mastery: updatedMasteryRecord,
    incorrect_question_tags: incorrectTags,
  };
}

/**
 * Resilient batch synchronization endpoint handler for Dexie.js offline queue.
 * Processes an array of attempts atomically per-attempt, tolerating partial failures.
 *
 * @param {object} params
 * @param {string} params.studentId - Authenticated student user _id
 * @param {Array} params.attempts - Array of quiz attempt payloads queued offline
 * @returns {Promise<object>} Batch sync report
 */
export async function syncBatchQuizAttempts({ studentId, attempts }) {
  if (!Array.isArray(attempts)) {
    throw new Error('attempts must be an array of quiz submissions.');
  }

  const results = [];
  let syncedCount = 0;
  let alreadySyncedCount = 0;
  let failedCount = 0;

  for (const item of attempts) {
    try {
      const outcome = await recordQuizAttempt({
        studentId,
        clientAttemptId: item.client_attempt_id || item.clientAttemptId,
        learningObjectiveId: item.learning_objective_id || item.learningObjectiveId,
        subject: item.subject,
        gradeLevel: item.grade_level || item.gradeLevel,
        questions: item.questions,
        syncedFromOffline: true,
      });

      if (outcome.idempotent) {
        alreadySyncedCount += 1;
        results.push({
          client_attempt_id: item.client_attempt_id,
          status: 'already_synced',
          message: outcome.message,
          attempt_id: outcome.attempt?._id,
        });
      } else {
        syncedCount += 1;
        results.push({
          client_attempt_id: item.client_attempt_id,
          status: 'synced',
          score: outcome.attempt?.score,
          max_score: outcome.attempt?.max_score,
          new_mastery: outcome.ema_update?.new_mastery,
          mastery_status: outcome.ema_update?.status,
        });
      }
    } catch (err) {
      failedCount += 1;
      results.push({
        client_attempt_id: item.client_attempt_id || 'unknown',
        status: 'failed',
        error: err.message,
      });
    }
  }

  return {
    total: attempts.length,
    synced_count: syncedCount,
    already_synced_count: alreadySyncedCount,
    failed_count: failedCount,
    results,
  };
}

export default {
  fetchAssessmentChunks,
  generateDiagnosticAssessment,
  calculateEmaMastery,
  recordQuizAttempt,
  syncBatchQuizAttempts,
  EMA_ALPHA,
  DEFAULT_BASELINE_MASTERY,
};
