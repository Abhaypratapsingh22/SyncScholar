/**
 * @file ragTutorService.js
 * @description Socratic Pedagogical Synthesis service for SyncScholar Adaptive RAG.
 * Synthesizes grounded answers from retrieved textbook chunks using Gemini LLM.
 * 
 * Enforces core pedagogical pillars:
 * 1. Strict Curriculum Grounding: Zero ungrounded internet facts.
 * 2. Reading-Level Alignment: Calibrates vocabulary and syntax to student's current_grade.
 * 3. Socratic Anti-Cheating Rule: Detects homework/exercise problems, provides concept analogy
 *    and Step 1 walkthrough, and prompts with guiding follow-up instead of giving away answers.
 * 4. Deterministic Citation Linking: Produces exact chapter, grade, and page citations.
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { buildAdaptiveFilter } from './adaptiveFilterService.js';
import { retrieveRelevantChunks } from './vectorSearchService.js';

// Initialize singleton Google Gen AI client
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Primary LLM model with configurable fallback model (defaults to gemini-flash-latest)
const PRIMARY_LLM_MODEL = process.env.LLM_MODEL || 'gemini-3.8-flash';
const FALLBACK_LLM_MODEL = process.env.LLM_FALLBACK_MODEL || 'gemini-flash-latest';

/**
 * Builds the strict system prompt for Socratic tutoring and curriculum grounding.
 *
 * @param {number} gradeLevel - Student's current grade (e.g. 7)
 * @param {boolean} remediationActive - Whether prerequisite remediation mode is active
 * @returns {string} System prompt instruction
 */
function buildSystemInstruction(gradeLevel, remediationActive) {
  return `You are SyncScholar's AI Socratic Tutor, an expert pedagogical guide for K-12 students under SDG 4 (Quality Education).

YOUR CORE DIRECTIVES (NON-NEGOTIABLE):
1. ZERO-HALLUCINATION CURRICULUM GROUNDING:
   - Ground EVERY factual explanation exclusively in the provided textbook passages.
   - Do NOT introduce external internet facts, unverified trivia, or advanced collegiate jargon not present in the passages.
   - If the passages do not contain enough information to answer the question, state: "My approved textbook passages do not cover this specific detail yet. Let's focus on what we have in the chapter."

2. READING-LEVEL CALIBRATION (GRADE ${gradeLevel}):
   - Use vocabulary, sentence structures, and tone appropriate for a Grade ${gradeLevel} student.
   - Be warm, encouraging, respectful, and patient. Avoid condescension.
   ${
     remediationActive
       ? '- REMEDIATION ACTIVE: The student is struggling with this concept (mastery < 50%). Break concepts into simpler foundational building blocks from earlier grades before bridging to Grade ' +
         gradeLevel +
         '.'
       : ''
   }

3. SOCRATIC ANTI-CHEATING RULE:
   - Check if the student's query looks like a direct homework question, exercise problem, or test question (e.g., "Solve this", "What is the answer to question 3", "Why is X hotter than Y?").
   - IF IT IS A DIRECT HOMEWORK/EXERCISE PROBLEM:
     * NEVER give away the direct, final numerical or definitive answer.
     * Explain the underlying textbook principle using an everyday, relatable analogy (e.g., hot soup with a metal vs. wooden spoon, blankets on a chilly night).
     * Walk through Step 1 or the first clue only.
     * Formulate an engaging "socratic_follow_up" question asking the student to apply this first step or deduce the next clue.
   - IF IT IS A CONCEPTUAL EXPLORATION:
     * Explain clearly using textbook definitions and everyday examples.
     * End with a thought-provoking "socratic_follow_up" question to reinforce retention.

4. OUTPUT FORMAT:
   - You MUST output valid, parseable JSON strictly matching this structure:
   {
     "answer": "Your pedagogical explanation grounded strictly in the provided text.",
     "socratic_follow_up": "A guiding question inviting the student to think through the concept or next step.",
     "remediation_mode_active": ${remediationActive ? 'true' : 'false'},
     "detected_learning_objective_id": "Primary learning objective ID from passages (e.g. SCI-07-HEAT-04)",
     "citations": [
       {
         "chapter_title": "Chapter name",
         "grade_level": 7,
         "page_number": 40,
         "source_url": "URL or null"
       }
     ]
   }`;
}

/**
 * Constructs user prompt containing retrieved textbook passages and student query.
 */
function buildUserPrompt({ query, chunks, remediationActive, studentGrade }) {
  const passagesText = chunks
    .map((c, i) => {
      const meta = c.metadata || {};
      return `--- PASSAGE [${i + 1}] ---
Curriculum: ${meta.source_curriculum || 'NCERT'}
Grade: ${meta.grade_level || studentGrade}
Subject: ${meta.subject || 'Science'}
Chapter ${meta.chapter_number || '?'}: "${meta.chapter_title || 'General'}"
Learning Objective: ${meta.learning_objective_id || 'UNKNOWN'}
Page: ${meta.page_number || 'N/A'}
Source URL: ${meta.source_url || 'N/A'}
Text:
${c.text}`;
    })
    .join('\n\n');

  return `STUDENT GRADE LEVEL: ${studentGrade}
REMEDIATION MODE: ${remediationActive ? 'ACTIVE (Foundational Prerequisite Chunks Included)' : 'STANDARD'}

RELEVANT TEXTBOOK PASSAGES:
${passagesText}

STUDENT QUESTION:
"${query}"

Synthesize a Socratic, grounded response following your system instructions. Respond ONLY in structured JSON.`;
}

/**
 * Synthesizes a grounded Socratic response via Gemini LLM with model fallback.
 */
async function callGeminiTutor(systemInstruction, userPrompt) {
  const modelsToTry = [PRIMARY_LLM_MODEL, FALLBACK_LLM_MODEL];
  let primaryError = null;
  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let attempt = 0;
    const maxRetries = 3;
    let delay = 1000;

    while (attempt < maxRetries) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: userPrompt,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.2, // Low temperature for factual curriculum grounding
          },
        });

        const responseText = response.text?.trim();
        if (!responseText) {
          throw new Error('Received empty response text from Gemini LLM.');
        }

        // Sanitize potential markdown fences
        const cleanedJson = responseText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```$/i, '')
          .trim();

        const parsed = JSON.parse(cleanedJson);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          typeof parsed.answer !== 'string' ||
          !parsed.answer.trim()
        ) {
          throw new Error('LLM response JSON is missing a non-empty string "answer" field.');
        }

        return parsed;
      } catch (err) {
        attempt++;
        if (i === 0) {
          primaryError = err;
        }
        lastError = err;
        const isTransient =
          err?.status === 429 ||
          err?.status === 503 ||
          err?.message?.includes('429') ||
          err?.message?.includes('503') ||
          err?.message?.includes('fetch failed') ||
          err?.message?.includes('RESOURCE_EXHAUSTED') ||
          err?.message?.includes('UNAVAILABLE') ||
          err?.message?.includes('high demand') ||
          err?.message?.includes('ENOTFOUND') ||
          err?.message?.includes('ETIMEDOUT');

        if (isTransient && attempt < maxRetries) {
          console.warn(
            `[ragTutorService] Transient error calling "${model}": ${err.message}. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          console.warn(`[ragTutorService] Model "${model}" failed: ${err.message}.`);
          break;
        }
      }
    }
  }

  throw primaryError || lastError || new Error('All Gemini LLM models failed to synthesize tutor response.');
}

/**
 * Deduplicates and extracts unique citations from retrieved chunks.
 */
function extractCitationsFromChunks(chunks) {
  const seen = new Set();
  const citations = [];

  for (const c of chunks) {
    const meta = c.metadata || {};
    const key = `${meta.grade_level}-${meta.chapter_number}-${meta.page_number}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        chapter_title: meta.chapter_title || 'General',
        grade_level: meta.grade_level || null,
        page_number: meta.page_number || null,
        source_url: meta.source_url || null,
      });
    }
  }

  return citations;
}

/**
 * Main Adaptive RAG Tutor Pipeline entry point.
 * Coordinates:
 * 1. Adaptive Filter building (Mastery check & Prerequisite expansion)
 * 2. 768-dim Vector retrieval against MongoDB Atlas with pre-filters
 * 3. Out-of-syllabus refusal gating (Zero internet hallucination)
 * 4. Socratic synthesis via Gemini LLM with structured JSON output
 *
 * @param {object} params
 * @param {string} params.studentId - Authenticated student user _id
 * @param {string} params.subject - Subject (e.g. 'Science' or 'Mathematics')
 * @param {string} params.question - Student question/homework query
 * @param {string} [params.learningObjectiveId] - Optional specific LO ID
 * @param {object} [params.userDoc] - Optional pre-loaded student document
 * @returns {Promise<object>} Structured tutor response
 */
export async function askTutor({
  studentId,
  subject,
  question,
  learningObjectiveId = null,
  userDoc = null,
}) {
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('A valid question string is required.');
  }

  // 1. Build Adaptive Pre-filter based on student mastery
  const filterContext = await buildAdaptiveFilter({
    studentId,
    subject,
    question,
    learningObjectiveId,
    userDoc,
  });

  const { filter, remediationTriggered, studentGrade, masteryScore, reason } = filterContext;

  // 2. Vector Retrieval via MongoDB Atlas $vectorSearch
  const retrievalResult = await retrieveRelevantChunks({
    query: question,
    filter: filter,
  });

  // 3. Out-of-Syllabus Refusal Gate (Prevent LLM hallucination)
  if (retrievalResult.isOutOfSyllabus || retrievalResult.chunks.length === 0) {
    return {
      success: true,
      data: {
        answer:
          "This question falls outside your current grade syllabus or verified textbooks. SyncScholar is strictly grounded in official curriculum textbooks to keep you focused on your coursework. Try asking a question related to your chapters!",
        socratic_follow_up:
          "Would you like to explore topics currently in your syllabus, such as Heat, Conduction, or Temperature Measurement?",
        remediation_mode_active: false,
        detected_learning_objective_id: null,
        citations: [],
        metadata: {
          out_of_syllabus: true,
          student_grade: studentGrade,
          mastery_score: masteryScore,
          top_retrieval_score: retrievalResult.topScore,
          remediation_triggered: false,
          retrieval_filter: filter,
        },
      },
    };
  }

  // 4. Socratic Pedagogical Synthesis via Gemini LLM
  const systemInstruction = buildSystemInstruction(studentGrade, remediationTriggered);
  const userPrompt = buildUserPrompt({
    query: question,
    chunks: retrievalResult.chunks,
    remediationActive: remediationTriggered,
    studentGrade,
  });

  const synthesis = await callGeminiTutor(systemInstruction, userPrompt);

  // Guarantee citations are derived strictly from verified retrieved chunk metadata
  const finalCitations = extractCitationsFromChunks(retrievalResult.chunks);

  const primaryLoId =
    synthesis.detected_learning_objective_id ||
    retrievalResult.chunks[0]?.metadata?.learning_objective_id ||
    learningObjectiveId;

  return {
    success: true,
    data: {
      answer: synthesis.answer,
      socratic_follow_up: synthesis.socratic_follow_up,
      remediation_mode_active: Boolean(remediationTriggered),
      detected_learning_objective_id: primaryLoId,
      citations: finalCitations,
      metadata: {
        out_of_syllabus: false,
        student_grade: studentGrade,
        mastery_score: masteryScore,
        remediation_triggered: remediationTriggered,
        filter_reason: reason,
        retrieved_chunks_count: retrievalResult.chunks.length,
        top_vector_score: retrievalResult.chunks[0]?.vectorSearchScore,
        retrieved_grades: [...new Set(retrievalResult.chunks.map((c) => c.metadata?.grade_level))],
      },
    },
  };
}

export default {
  askTutor,
};
