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

// Primary LLM model with configurable fallback model (defaults to active quota models)
const PRIMARY_LLM_MODEL = process.env.LLM_MODEL || 'gemini-flash-lite-latest';
const FALLBACK_LLM_MODEL = process.env.LLM_FALLBACK_MODEL || 'gemini-3.5-flash';

/**
 * Sanitizes raw LaTeX mathematics syntax into accessible, student-friendly textbook wording.
 * Converts confusing expressions like:
 *   "($v = \text{frequency} \times \text{wavelength}$)" -> "(v = Frequency × Wavelength)"
 *   "$T = \frac{1}{\nu}$" -> "T = 1 / Frequency"
 *   "$344\text{ m s}^{-1}$" -> "344 m/s"
 *   "$3.44\text{ m}$" -> "3.44 m"
 *
 * @param {string} text - Raw input text
 * @returns {string} Sanitized student-friendly text
 */
export function cleanStudentMath(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  // 1. Replace \text{...} with inside content
  cleaned = cleaned.replace(/\\text\s*\{([^}]*)\}/g, '$1');

  // 2. Replace \frac{a}{b} -> a / b
  cleaned = cleaned.replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1 / $2');

  // 3. Replace common LaTeX math symbols
  cleaned = cleaned.replace(/\\times/g, '×');
  cleaned = cleaned.replace(/\\cdot/g, '·');
  cleaned = cleaned.replace(/\\div/g, '÷');
  cleaned = cleaned.replace(/\\pm/g, '±');
  cleaned = cleaned.replace(/\\leq/g, '≤');
  cleaned = cleaned.replace(/\\geq/g, '≥');
  cleaned = cleaned.replace(/\\neq/g, '≠');
  cleaned = cleaned.replace(/\\approx/g, '≈');

  // 4. Replace Greek symbols with readable names or symbols
  cleaned = cleaned.replace(/\\nu\b/g, 'Frequency (ν)');
  cleaned = cleaned.replace(/\\lambda\b/g, 'Wavelength (λ)');
  cleaned = cleaned.replace(/\\mu\b/g, 'μ');
  cleaned = cleaned.replace(/\\theta\b/g, 'θ');
  cleaned = cleaned.replace(/\\pi\b/g, 'π');
  cleaned = cleaned.replace(/\\Delta\b/g, 'Δ');

  // 5. Clean up units notation: m s^{-1} -> m/s, m s^-1 -> m/s, etc.
  cleaned = cleaned.replace(/m\s*s\^\{-1\}/gi, 'm/s');
  cleaned = cleaned.replace(/m\s*s\^-1/gi, 'm/s');
  cleaned = cleaned.replace(/m\s*s\^\{-2\}/gi, 'm/s²');
  cleaned = cleaned.replace(/m\s*s\^-2/gi, 'm/s²');
  cleaned = cleaned.replace(/m\/s\^2/gi, 'm/s²');
  cleaned = cleaned.replace(/\^\{-1\}/g, '⁻¹');
  cleaned = cleaned.replace(/\^\{2\}/g, '²');
  cleaned = cleaned.replace(/\^\{3\}/g, '³');
  cleaned = cleaned.replace(/\^2/g, '²');
  cleaned = cleaned.replace(/\^3/g, '³');

  // 6. Scientific notation powers and chemical subscripts (Priority 7)
  cleaned = cleaned.replace(/10\^23/g, '10²³');
  cleaned = cleaned.replace(/10\^-11/g, '10⁻¹¹');
  cleaned = cleaned.replace(/10\^8/g, '10⁸');

  cleaned = cleaned.replace(/\bH2O\b/g, 'H₂O');
  cleaned = cleaned.replace(/\bCO2\b/g, 'CO₂');
  cleaned = cleaned.replace(/\bO2\b/g, 'O₂');
  cleaned = cleaned.replace(/\bN2\b/g, 'N₂');
  cleaned = cleaned.replace(/\bH2\b/g, 'H₂');
  cleaned = cleaned.replace(/\bHNO3\b/g, 'HNO₃');
  cleaned = cleaned.replace(/Ca\(OH\)2/g, 'Ca(OH)₂');
  cleaned = cleaned.replace(/Mg\(OH\)2/g, 'Mg(OH)₂');
  cleaned = cleaned.replace(/\bSO4\b/g, 'SO₄');
  cleaned = cleaned.replace(/\bNH3\b/g, 'NH₃');
  cleaned = cleaned.replace(/_2\b/g, '₂');
  cleaned = cleaned.replace(/_3\b/g, '₃');
  cleaned = cleaned.replace(/_4\b/g, '₄');

  // 7. Clean up remaining LaTeX commands
  cleaned = cleaned.replace(/\\left|\\right/g, '');
  cleaned = cleaned.replace(/\\[,;!]/g, ' ');

  // 8. Strip math delimiters $ and $$
  cleaned = cleaned.replace(/\$\$([^$]+)\$\$/g, '$1');
  cleaned = cleaned.replace(/\$([^$]+)\$/g, '$1');

  // 9. Simplify double parentheses and spaces
  cleaned = cleaned.replace(/\(\s*\(([^()]+)\)\s*\)/g, '($1)');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');

  return cleaned.trim();
}

/**
 * Resolves conversational follow-ups and anaphoric references into a standalone search query
 * for Atlas Vector Search (BUG SS-004).
 * E.g., if previous discussion was about acceleration, and student asks "Explain its formula",
 * reformulates the retrieval query to "acceleration formula".
 *
 * @param {string} query - Current student question
 * @param {Array} history - Previous conversation messages
 * @returns {string} Standalone retrieval query
 */
export function condenseRetrievalQuery(query, history = []) {
  if (!query || typeof query !== 'string') return '';
  const trimmed = query.trim();
  if (!Array.isArray(history) || history.length === 0) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  // Check if query is anaphoric, short follow-up, or refers to previous turn
  const isAnaphoric =
    /\b(it|its|this|these|that|those|they|them|formula|equation|example|definition|summarize|summary|why|how)\b/i.test(lower) ||
    trimmed.length < 35;

  if (!isAnaphoric) {
    return trimmed;
  }

  // Find the most recent student question or tutor topic in history
  let priorTopic = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const content = msg.content || msg.text || '';
    if (!content) continue;

    // If it's a student query, extract key terms
    if (msg.role === 'student' || msg.role === 'user') {
      const cleaned = content.replace(/[?!.]/g, '').trim();
      if (cleaned.length > 5 && cleaned.length < 150) {
        priorTopic = cleaned;
        break;
      }
    } else if (msg.role === 'tutor' || msg.role === 'assistant') {
      // Look for bold terms in tutor message like **conduction** or **acceleration**
      const match = content.match(/\*\*([A-Za-z\s]{3,30})\*\*/);
      if (match && match[1]) {
        priorTopic = match[1];
        break;
      }
    }
  }

  if (priorTopic) {
    // If asking to summarize whole discussion
    if (/summarize|summary|whole discussion/i.test(lower)) {
      return `${priorTopic} summary concepts`;
    }
    // Return combined topic and query
    return `${priorTopic} ${trimmed}`;
  }

  return trimmed;
}

/**
 * Builds the strict system prompt for Socratic tutoring and curriculum grounding.
 *
 * @param {number} gradeLevel - Student's current grade (e.g. 7, 9)
 * @param {boolean} remediationActive - Whether prerequisite remediation mode is active
 * @returns {string} System prompt instruction
 */
function buildSystemInstruction(gradeLevel, remediationActive) {
  return `You are SyncScholar's AI Socratic Tutor, an expert pedagogical guide for K-12 students under SDG 4 (Quality Education).

YOUR CORE DIRECTIVES (NON-NEGOTIABLE):
1. CURRICULUM GROUNDING & SCIENTIFIC APPLICATION (ZERO HALLUCINATION):
   - Ground all scientific definitions, laws, principles, and concepts strictly in the provided textbook passages.
   - SCIENTIFIC DEDUCTION & NUMERICAL APPLICATION AUTHORIZED (CRITICAL):
     * You ARE authorized and expected to apply physical laws, equations of motion, mathematical formulas, and definitions from the passages to solve numerical problems, calculations, unit conversions, and real-world scenarios posed by the student (e.g. cars, trains, objects in motion, forces, work, energy, sound waves, or chemical formulas), even if the student's specific numerical values (e.g. 0.2 m/s², 120 m, 5 minutes) or specific scenarios are not verbatim in the textbook passages!
     * As long as the underlying scientific topic/formula is covered in the passages or syllabus, perform the calculation accurately step-by-step.
   - ADVANCED OUT-OF-SYLLABUS REFUSALS:
     * If the student asks about advanced university/collegiate level physics, chemistry, or biology concepts (such as quantum entanglement, faster-than-light communication, general relativity, quantum electrodynamics, etc.) that are fundamentally outside the secondary school curriculum (Grade ${gradeLevel} Science), DO NOT force an answer using incidental keyword matches (e.g. cell membranes). Instead, state clearly: "This question involves advanced concepts (like quantum entanglement) that fall outside your Class ${gradeLevel} Science curriculum. SyncScholar is strictly grounded in official NCERT textbooks to keep you focused on your coursework. Try asking a question related to your chapters!" In this case, return citations as an empty array [].
     * Only trigger the refusal: "My approved textbook passages do not cover this specific detail yet. Let's focus on what we have in the chapter." if the student is asking about concepts completely absent from the curriculum passages.

2. READING-LEVEL CALIBRATION (GRADE ${gradeLevel}):
   - Use vocabulary, sentence structures, and tone appropriate for a Grade ${gradeLevel} student.
   - Be warm, encouraging, respectful, and patient. Avoid condescension.
   ${remediationActive
      ? '- REMEDIATION ACTIVE: The student is struggling with this concept (mastery < 50%). Break concepts into simpler foundational building blocks from earlier grades before bridging to Grade ' +
      gradeLevel +
      '.'
      : ''
    }

3. SOCRATIC GUIDANCE, NUMERICAL SOLUTIONS & FORMULAS:
   - IF IT IS A NUMERICAL PROBLEM OR CALCULATION (e.g. "Calculate speed", "Find final velocity", "Convert 72 km/h into m/s", "Find work done", "Calculate kinetic energy", "Calculate momentum", "Calculate molecular mass", "How many moles"):
     * The tutor MUST provide the complete, step-by-step worked numerical calculation:
       1. Given Quantities: List each given variable with its symbol and units (e.g., Distance d = 120 m, Time t = 10 s).
       2. Formula: State the textbook formula clearly in readable words/symbols (e.g., Speed = Distance / Time).
       3. Step-by-Step Substitution: Show the substitution of values clearly.
       4. Final Answer: Compute and state the final numerical value with correct units (e.g., Speed = 12 m/s).
     * In "socratic_follow_up": Formulate an engaging practice problem or conceptual extension with varied numbers to verify understanding (e.g., "Now try this: If the car travels 240 metres in 15 seconds, what would its speed be?").
   - IF IT IS A CHEMICAL FORMULA OR RECALL QUESTION (e.g. "Write the chemical formula for water, carbon dioxide, sodium chloride, and calcium hydroxide"):
     * Provide the correct chemical formulas directly (H₂O, CO₂, NaCl, Ca(OH)₂), and explain the combining capacities / valencies (the criss-cross method) clearly.
     * In "socratic_follow_up": Ask the student to apply the criss-cross method to another pair of ions (e.g., combining aluminium Al³⁺ and oxygen O²⁻).
   - IF IT IS A PURE HOMEWORK COPYING REQUEST ("Give me the answers to exercise 3a without explanation"):
     * Explain the textbook principle using an everyday analogy, walk through the first clue, and ask a guiding question in "socratic_follow_up".
   - IF IT IS A CONCEPTUAL EXPLORATION:
     * Explain clearly using textbook definitions, physical mechanisms, and everyday examples.
     * End with a thought-provoking "socratic_follow_up" question to reinforce retention.

4. STUDENT-FRIENDLY ACCESSIBLE FORMULAS & UNITS (CRITICAL):
   - NEVER output raw LaTeX math commands or code (do NOT write \\text{...}, \\frac{...}{...}, \\times, \\nu, \\lambda, \\cdot, or surrounding dollar signs $...$). K-12 students cannot understand raw LaTeX code!
   - Write all equations and formulas in simple, natural, student-friendly textbook words:
     * Write: Speed = Frequency × Wavelength (or v = Frequency × Wavelength)
     * Write: Time Period (T) = 1 / Frequency
     * Write: Speed = 344 m/s (or 344 m s⁻¹), Wavelength = 3.44 m
     * NEVER write: $v = \\text{frequency} \\times \\text{wavelength}$, $T = \\frac{1}{\\nu}$, $344\\text{ m s}^{-1}$
   - Keep units in standard textbook notation (m, s, m/s, m/s², kg, J, N) without LaTeX backslashes or dollar signs.

5. OUTPUT FORMAT:
   - You MUST output valid, parseable JSON strictly matching this structure:
   {
     "answer": "Your pedagogical explanation grounded strictly in the provided text.",
     "socratic_follow_up": "A guiding question inviting the student to think through the concept or next step.",
     "remediation_mode_active": ${remediationActive ? 'true' : 'false'},
     "detected_learning_objective_id": "Primary learning objective ID from passages (e.g. SCI-09-MOTI-01)",
     "citations": [
       {
         "chapter_title": "Chapter name",
         "grade_level": ${gradeLevel},
         "page_number": 40,
         "source_url": "URL or null"
       }
     ]
   }`;
}

/**
 * Constructs user prompt containing retrieved textbook passages, multi-turn history, and student query.
 */
function buildUserPrompt({ query, chunks, remediationActive, studentGrade, conversationHistory = [] }) {
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

  let historyBlock = '';
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recentTurns = conversationHistory.slice(-6);
    const formatted = recentTurns
      .map((m) => {
        const isStudent = m.role === 'student' || m.role === 'user';
        const roleLabel = isStudent ? 'Student' : 'SyncScholar AI Tutor';
        const text = m.content || m.text || '';
        return `${roleLabel}: ${text.slice(0, 300)}`;
      })
      .join('\n');
    historyBlock = `RECENT CONVERSATION HISTORY (Previous turns in this session):\n${formatted}\n\n`;
  }

  return `STUDENT GRADE LEVEL: ${studentGrade}
REMEDIATION MODE: ${remediationActive ? 'ACTIVE (Foundational Prerequisite Chunks Included)' : 'STANDARD'}

RELEVANT TEXTBOOK PASSAGES:
${passagesText}

${historyBlock}CURRENT STUDENT QUESTION:
"${query}"

Synthesize a Socratic, grounded response following your system instructions. Respond ONLY in structured JSON.`;
}

/**
 * Synthesizes a grounded Socratic response via Gemini LLM with robust multi-model fallback cascade.
 */
async function callGeminiTutor(systemInstruction, userPrompt) {
  const modelsToTry = [
    PRIMARY_LLM_MODEL,
    FALLBACK_LLM_MODEL,
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let primaryError = null;
  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let attempt = 0;
    const maxRetries = 2;
    let delay = 800;

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
          !parsed.answer.trim() ||
          typeof parsed.socratic_follow_up !== 'string' ||
          !parsed.socratic_follow_up.trim()
        ) {
          throw new Error('LLM response JSON is missing a non-empty string "answer" or "socratic_follow_up" field.');
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
          console.warn(`[ragTutorService] Model "${model}" failed: ${err.message}. Trying next model in cascade...`);
          break;
        }
      }
    }
  }

  throw lastError || primaryError || new Error('All Gemini LLM models failed to synthesize tutor response.');
}

/**
 * Synthesizes a grounded, deterministic Socratic fallback directly from verified retrieved textbook chunks
 * when external LLM APIs are unavailable, rate-limited, or offline.
 * Dynamically parameterized by studentGrade and retrieved chunks (BUG SS-008).
 */
function synthesizeCurriculumFallback({ query, chunks, studentGrade, remediationActive }) {
  const topChunk = chunks[0] || {};
  const meta = topChunk.metadata || {};
  const loId = meta.learning_objective_id || '';
  const chapterTitle = meta.chapter_title || (Number(studentGrade) === 9 ? 'Science' : 'Heat');
  const lowerQuery = (query || '').toLowerCase();

  // Curated Socratic explanations for standard Grade 7 textbook dilemmas (strictly guarded by Grade 7)
  if (Number(studentGrade) === 7) {
    if (
      (lowerQuery.includes('metal') && lowerQuery.includes('spoon')) ||
      (lowerQuery.includes('conduction') && lowerQuery.includes('heat'))
    ) {
      return {
        answer:
          "Great observation! In your science curriculum, heat always flows from a hotter object to a colder object through a process called **conduction**.\n\nOn a cold winter morning, your hand is warmer than both spoons. Metal is a **good conductor of heat**, meaning it rapidly conducts heat away from your fingertips, making your skin register cold almost instantly. In contrast, wood is an **insulator (poor conductor)**, which transfers heat much more slowly.",
        socratic_follow_up:
          "Since wood is an insulator that slows down heat transfer, what do you think would happen to the warmth in your hand if you held a wooden spoon compared to a plastic or silver one?",
        remediation_mode_active: Boolean(remediationActive),
        detected_learning_objective_id: loId || 'SCI-07-HEAT-04',
        citations: [
          {
            chapter_title: meta.chapter_title || 'Heat',
            grade_level: 7,
            page_number: meta.page_number || 41,
            source_url: meta.source_url || 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
            source_curriculum: meta.source_curriculum || 'NCERT',
            subject: meta.subject || 'Science',
            text_excerpt:
              'The materials which allow heat to pass through them easily are conductors of heat, for example, aluminium, iron and copper. The materials which do not allow heat to pass through them easily are poor conductors of heat such as plastic and wood. Poor conductors are known as insulators.',
          },
        ],
      };
    }

    if (
      lowerQuery.includes('photosynthesis') ||
      lowerQuery.includes('raw material') ||
      loId === 'SCI-07-NUTR-01'
    ) {
      return {
        answer:
          "In green plants, photosynthesis is the process used to prepare food. Green plants require four primary inputs: **chlorophyll** (the green pigment in leaves), **sunlight** (energy source), **carbon dioxide** (absorbed through microscopic leaf pores called stomata), and **water along with minerals** (absorbed from soil through roots).\n\nDuring this reaction, solar energy is converted into chemical energy (carbohydrates) while releasing vital oxygen.",
        socratic_follow_up:
          "If a green plant is placed in a dark room with plenty of water and fresh air, can it still synthesize food? Which key raw material is missing?",
        remediation_mode_active: Boolean(remediationActive),
        detected_learning_objective_id: loId || 'SCI-07-NUTR-01',
        citations: [
          {
            chapter_title: meta.chapter_title || 'Nutrition in Plants',
            grade_level: 7,
            page_number: meta.page_number || 2,
            source_url: meta.source_url || 'https://ncert.nic.in/textbook/pdf/gesc101.pdf',
            source_curriculum: meta.source_curriculum || 'NCERT',
            subject: meta.subject || 'Science',
            text_excerpt:
              'Water, chlorophyll, carbon dioxide and sunlight are necessary to carry out the process of Photosynthesis. The solar energy is captured by the leaves and stored in the plant in the form of food.',
          },
        ],
      };
    }
  }

  // Dynamic fallback grounded directly in the top retrieved textbook chunk for Grade 9 or any grade
  const chunkText = topChunk.text ? topChunk.text.trim().slice(0, 400) : '';
  const cleanedExcerpt = chunkText.replace(/\s+/g, ' ');

  return {
    answer: `According to your Class ${studentGrade} curriculum textbook (${chapterTitle}):\n\n"${cleanedExcerpt}..."\n\nTo understand this concept, look at how the principle applies to everyday situations. The textbook highlights the underlying rule that explains how and why this phenomenon occurs.`,
    socratic_follow_up: `Based on this passage from Chapter "${chapterTitle}", how would you explain the first step of this phenomenon in your own words?`,
    remediation_mode_active: Boolean(remediationActive),
    detected_learning_objective_id: loId || null,
    citations: topChunk.text
      ? [
          {
            chapter_title: meta.chapter_title || chapterTitle,
            grade_level: meta.grade_level || studentGrade,
            page_number: meta.page_number || null,
            source_url: meta.source_url || null,
            source_curriculum: meta.source_curriculum || 'NCERT',
            subject: meta.subject || 'Science',
            text_excerpt: cleanedExcerpt.slice(0, 200),
          },
        ]
      : [],
  };
}

/**
 * Matches selected model citations against verified retrieved chunk metadata.
 * If model answer is an out-of-syllabus refusal, suppresses irrelevant citations (BUG SS-005, BUG SS-007).
 *
 * @param {Array} chunks - Retrieved textbook chunks with metadata
 * @param {Array} [selectedCitations] - Model-selected citations array
 * @param {string} [modelAnswer] - Generated tutor answer text
 * @returns {Array} Deduplicated verified citations
 */
function extractCitationsFromChunks(chunks, selectedCitations = [], modelAnswer = '') {
  // If the model answer is a refusal, do not attach irrelevant citations (BUG SS-005, BUG SS-007)
  const isRefusal =
    /do not cover this specific detail/i.test(modelAnswer) ||
    /outside your Class/i.test(modelAnswer) ||
    /outside the Class/i.test(modelAnswer) ||
    /falls outside/i.test(modelAnswer) ||
    /advanced concepts.*fall outside/i.test(modelAnswer);

  if (isRefusal) {
    return [];
  }

  const seen = new Set();
  const matched = [];

  if (Array.isArray(selectedCitations) && selectedCitations.length > 0) {
    for (const sel of selectedCitations) {
      if (!sel || typeof sel !== 'object') continue;

      const foundChunk = chunks.find((c) => {
        const meta = c.metadata || {};
        if (sel.page_number && Number(sel.page_number) === Number(meta.page_number)) {
          return true;
        }
        if (
          sel.chapter_title &&
          meta.chapter_title &&
          (meta.chapter_title.toLowerCase() === String(sel.chapter_title).toLowerCase() ||
            meta.chapter_title.toLowerCase().includes(String(sel.chapter_title).toLowerCase()))
        ) {
          return true;
        }
        return false;
      });

      if (foundChunk) {
        const meta = foundChunk.metadata || {};
        const key = `${meta.grade_level}-${meta.chapter_number}-${meta.page_number}`;
        if (!seen.has(key)) {
          seen.add(key);
          matched.push({
            chapter_title: meta.chapter_title || 'General',
            grade_level: meta.grade_level || null,
            page_number: meta.page_number || null,
            source_url: meta.source_url || null,
            source_curriculum: meta.source_curriculum || 'NCERT',
            subject: meta.subject || 'Science',
            text_excerpt: foundChunk.text ? foundChunk.text.slice(0, 200) : '',
          });
        }
      }
    }
  }

  // If matching selected citations against retrieved chunks produced verified entries, return them
  if (matched.length > 0) {
    return matched;
  }

  // Verified fallback when the model selects none or no matches are found
  for (const c of chunks) {
    const meta = c.metadata || {};
    const key = `${meta.grade_level}-${meta.chapter_number}-${meta.page_number}`;
    if (!seen.has(key)) {
      seen.add(key);
      matched.push({
        chapter_title: meta.chapter_title || 'General',
        grade_level: meta.grade_level || null,
        page_number: meta.page_number || null,
        source_url: meta.source_url || null,
        source_curriculum: meta.source_curriculum || 'NCERT',
        subject: meta.subject || 'Science',
        text_excerpt: c.text ? c.text.slice(0, 200) : '',
      });
      if (matched.length >= 2) break;
    }
  }

  return matched;
}

/**
 * Main Adaptive RAG Tutor Pipeline entry point.
 * Coordinates:
 * 1. Adaptive Filter building (Mastery check & Prerequisite expansion)
 * 2. Conversational query condensation for Atlas Vector Search
 * 3. 768-dim Vector retrieval against MongoDB Atlas with pre-filters
 * 4. Out-of-syllabus refusal gating (Zero internet hallucination)
 * 5. Socratic synthesis via Gemini LLM with structured JSON output and grounded fallback
 *
 * @param {object} params
 * @param {string} params.studentId - Authenticated student user _id
 * @param {string} params.subject - Subject (e.g. 'Science' or 'Mathematics')
 * @param {string} params.question - Student question/homework query
 * @param {string} [params.learningObjectiveId] - Optional specific LO ID
 * @param {object} [params.userDoc] - Optional pre-loaded student document
 * @param {number} [params.grade] - Target student grade
 * @param {Array} [params.conversationHistory] - Multi-turn conversational history
 * @returns {Promise<object>} Structured tutor response
 */
export async function askTutor({
  studentId,
  subject,
  question,
  learningObjectiveId = null,
  userDoc = null,
  grade = null,
  conversationHistory = [],
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
    grade,
  });

  const { filter, remediationTriggered, studentGrade, masteryScore, reason } = filterContext;

  // 2. Contextual query condensation for vector retrieval (BUG SS-004)
  // Reformulate anaphoric follow-up queries (e.g. "Explain its formula" -> "acceleration Explain its formula")
  const retrievalQuery = condenseRetrievalQuery(question, conversationHistory);

  // 3. Vector Retrieval via MongoDB Atlas $vectorSearch
  const retrievalResult = await retrieveRelevantChunks({
    query: retrievalQuery,
    filter: filter,
  });

  // 4. Out-of-Syllabus Refusal Gate (Prevent LLM hallucination)
  if (retrievalResult.isOutOfSyllabus || retrievalResult.chunks.length === 0) {
    const gradeSuggestions = {
      9: {
        Science: 'Cell Structure, Tissues, Motion, Forces, Sound Waves, or Work and Energy',
        Mathematics: 'Coordinates, Polynomials, Number Systems, or Algebraic Identities',
      },
      7: {
        Science: 'Heat, Conduction, Temperature Measurement, or Nutrition in Plants',
        Mathematics: 'Integers, Fractions, Decimals, or Simple Equations',
      },
      8: {
        Science: 'Crop Production, Microorganisms, Combustion, or Force and Pressure',
        Mathematics: 'Rational Numbers, Linear Equations, or Quadrilaterals',
      },
      6: {
        Science: 'Components of Food, Sorting Materials, or Getting to Know Plants',
        Mathematics: 'Knowing Our Numbers, Whole Numbers, or Integers',
      },
      10: {
        Science: 'Chemical Reactions, Acids and Bases, Light, or Electricity',
        Mathematics: 'Real Numbers, Polynomials, or Quadratic Equations',
      },
    };

    const suggestedTopics =
      gradeSuggestions[studentGrade]?.[subject] ||
      gradeSuggestions[studentGrade]?.Science ||
      'topics currently in your chapters';

    return {
      success: true,
      data: {
        answer:
          `This question falls outside your Class ${studentGrade} ${subject} syllabus or verified curriculum textbooks. SyncScholar is strictly grounded in official NCERT textbooks to keep you focused on your coursework. Try asking a question related to your chapters!`,
        socratic_follow_up:
          `Would you like to explore topics currently in your Class ${studentGrade} syllabus, such as ${suggestedTopics}?`,
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

  // 5. Socratic Pedagogical Synthesis via Gemini LLM with grounded curriculum fallback
  const systemInstruction = buildSystemInstruction(studentGrade, remediationTriggered);
  const userPrompt = buildUserPrompt({
    query: question,
    chunks: retrievalResult.chunks,
    remediationActive: remediationTriggered,
    studentGrade,
    conversationHistory,
  });

  let synthesis;
  let isRateLimitedFallback = false;

  try {
    synthesis = await callGeminiTutor(systemInstruction, userPrompt);
  } catch (llmError) {
    console.warn(
      `[ragTutorService] LLM synthesis failed (${llmError.message}). Synthesizing grounded Socratic response from retrieved curriculum chunks...`
    );
    synthesis = synthesizeCurriculumFallback({
      query: question,
      chunks: retrievalResult.chunks,
      studentGrade,
      remediationActive: remediationTriggered,
    });
    isRateLimitedFallback = true;
  }

  // Derive citations from retrieved passages the model selected, with verified fallback
  const finalCitations = extractCitationsFromChunks(
    retrievalResult.chunks,
    synthesis.citations,
    synthesis.answer
  );

  const primaryLoId =
    synthesis.detected_learning_objective_id ||
    retrievalResult.chunks[0]?.metadata?.learning_objective_id ||
    learningObjectiveId;

  return {
    success: true,
    data: {
      answer: cleanStudentMath(synthesis.answer),
      socratic_follow_up: cleanStudentMath(synthesis.socratic_follow_up),
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
        rate_limited_fallback: isRateLimitedFallback,
      },
    },
  };
}

export default {
  askTutor,
  cleanStudentMath,
  condenseRetrievalQuery,
};
