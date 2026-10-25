### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` in full before starting. Follow all architectural, clean-code, and library permission rules strictly.

### OBJECTIVE
Build the formative assessment engine that generates curriculum-grounded 3-question diagnostic quizzes and offline-cacheable flashcards from retrieved textbook chunks, processes idempotent quiz submissions, and updates student mastery using an Exponential Moving Average (EMA).

### STEP-BY-STEP INSTRUCTIONS
1. Structured Assessment Generator (`POST /api/assessments/generate`):
   - Accept `subject`, `learning_objective_id` (or topic query), and fetch the top matching `curriculum_chunks` for the student's grade.
   - Use structured JSON schema output with `gemini-2.5-flash` to generate:
     - **3 Diagnostic MCQs:** Each with `question`, 4 `options`, `correct_index`, `concept_tag` (e.g., `"thermal_conductors"`), and a `textbook_explanation` citing the exact chapter and page.
     - **3 Study Flashcards:** Concise `front` (question/term), `back` (grade-appropriate textbook definition), and `learning_objective_id` designed to be cached offline on the client PWA.
2. Idempotent Quiz Submission & EMA Mastery Loop (`POST /api/assessments/submit` and batch sync `POST /api/assessments/sync-batch`):
   - Check `client_attempt_id` in `QuizAttempt` first: if already recorded, return the existing result (idempotency prevents duplicate scoring when fluctuating rural internet retries requests).
   - Compute `attempt_accuracy = score / max_score`.
   - Update `User.concept_mastery` for that `learning_objective_id` using Exponential Moving Average (`alpha = 0.4`):
     `new_mastery = (alpha * attempt_accuracy) + ((1 - alpha) * previous_mastery)`
   - Update `status`: below `0.50` -> `'needs_prerequisite_remediation'`, `0.50` to `0.79` -> `'progressing'`, `0.80` and above -> `'mastered'`.
   - Log `incorrect_question_tags` so the Teacher Heatmap knows exact misconceptions.

### CONSTRAINTS
- Guarantee valid JSON schema parsing with safe fallback error handling if the LLM output is malformed.
- Keep batch sync atomic and resilient to partial failures.

### VERIFICATION / DEFINITION OF DONE
- Walk through how 2 failed quiz attempts drop a student's EMA mastery below `0.50`, automatically flipping their status to `needs_prerequisite_remediation` for their next RAG doubt query.