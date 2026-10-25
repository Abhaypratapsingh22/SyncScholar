### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` first and adhere strictly to its Architecture Guidelines, Development Philosophy, and Library Permission Gate. Do not install `@google/genai` or `llamaindex` packages until you explain them and receive my approval.

### OBJECTIVE
Build the core curriculum-grounded Adaptive RAG engine in `/server` that checks student mastery, dynamically expands MongoDB Atlas `$vectorSearch` pre-filters for struggling learners, enforces Socratic anti-cheating and reading-level guardrails, and cites exact textbook sources.

### STEP-BY-STEP INSTRUCTIONS
1. Library Gate: Propose the official `@google/genai` SDK (and LlamaIndex integration if beneficial vs. direct MongoDB `$vectorSearch` aggregation pipeline). Explain why direct `$vectorSearch` aggregation vs. LlamaIndex wrapper is better for teachability and bundle size, and ask my permission before installing.
2. Mastery Inspection & Adaptive Pre-Filter Builder (`server/src/services/adaptiveFilterService.js`):
   - Accept `studentId`, `subject`, `question`, and optional `learningObjectiveId`.
   - Look up the student's `current_grade` and relevant `concept_mastery` score in MongoDB.
   - **Standard Mode (`mastery_score >= 0.50` or new topic):** Set `$vectorSearch` filter to `{ "metadata.subject": subject, "metadata.grade_level": current_grade }`.
   - **Prerequisite Fallback Mode (`mastery_score < 0.50`):** Automatically expand the filter to `{ "metadata.subject": subject, "metadata.grade_level": { "$in": [Math.max(1, current_grade - 1), current_grade] } }` and set flag `remediationTriggered = true`.
3. Vector Retrieval Service (`server/src/services/vectorSearchService.js`):
   - Embed the student's query at `outputDimensionality: 768` using `gemini-embedding-001`.
   - Execute MongoDB `$vectorSearch` against `vector_index` (`numCandidates: 40`, `limit: 4`) with the adaptive pre-filter, projecting `text`, `metadata`, and `vectorSearchScore`.
   - If zero chunks exceed a minimum relevance threshold, return a safe out-of-syllabus refusal without calling the LLM to prevent hallucination.
4. Socratic Pedagogical Synthesis (`server/src/services/ragTutorService.js`):
   - Prompt `gemini-2.5-flash` with strict system guardrails:
     a) Ground every factual statement exclusively in the retrieved NCERT/OpenStax passages.
     b) Match vocabulary and sentence length to the student's `current_grade`.
     c) **Socratic Anti-Cheating Rule:** Detect if the query looks like a direct homework/exercise problem; if so, explain the underlying textbook concept using an everyday analogy and walk through Step 1, asking a guiding question rather than giving away the final answer.
     d) Return structured JSON containing `answer`, `socratic_follow_up`, `remediation_mode_active`, `detected_learning_objective_id`, and `citations` (`chapter_title`, `grade_level`, `page_number`, `source_url`).
5. Expose `POST /api/tutor/ask` protected by student authentication.

### CONSTRAINTS
- Zero ungrounded internet facts allowed in tutor answers.
- Modularize retrieval, filtering, and prompt construction into separate, readable files.

### VERIFICATION / DEFINITION OF DONE
- Demonstrate testing `POST /api/tutor/ask` for both a high-mastery student (Grade 7 chunks only) and a low-mastery student (`mastery_score: 0.35`, triggering Grade 6 + Grade 7 retrieval).