### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` first and adhere strictly to its Architecture Guidelines, Development Philosophy, and Library Permission Gate. Build clean, simple, heavily commented, teachable code.

### OBJECTIVE
Implement the automated MongoDB Atlas database connection module, core Mongoose data models on the unified data plane, and the exact Atlas Vector Search index configuration.

### STEP-BY-STEP INSTRUCTIONS
1. Dependency Check: Verify whether `mongoose`, `dotenv`, `express`, and `cors` are approved and installed in `/server`. If any library is missing, explain why it is useful and ask my permission before installing.
2. Environment Validator (`server/src/config/env.js`): Write a clean startup check that validates `MONGODB_URI`, `PORT`, `GEMINI_API_KEY`, and `JWT_SECRET`, failing fast with human-friendly instructions if any variable is missing.
3. Database Connection (`server/src/config/db.js`): Implement an async Mongoose connection helper with connection pooling, graceful `SIGINT` shutdown handling, and clear console status logging. Wire it into `server/src/server.js` alongside a `GET /api/health` endpoint reporting server and database state.
4. Implement three clean Mongoose schemas in `server/src/models/`:
   - `CurriculumChunk.js` (`curriculum_chunks` collection): `text` (String), `embedding` ([Number] of length 768), and structured `metadata` (`source_curriculum`, `grade_level` Number 1–12, `subject`, `chapter_number`, `chapter_title`, `learning_objective_id`, `difficulty_tier` enum `['foundational', 'standard', 'advanced']`, `page_number`, `source_url`). Add compound indexes for standard queries.
   - `User.js` (`users` collection): Supports both `student` and `teacher` roles (`name`, `email` or `roll_number`, `password_hash`, `role`, `school_id`, `current_grade`, `preferred_language`, `concept_mastery` array containing `learning_objective_id`, `subject`, `mastery_score` default `0.5`, `attempts_count`, `status` enum `['mastered', 'progressing', 'needs_prerequisite_remediation']`, `last_reviewed`).
   - `QuizAttempt.js` (`quiz_attempts` collection): Includes `client_attempt_id` (unique UUID for idempotent offline PWA sync), `student_id`, `learning_objective_id`, `subject`, `grade_level`, `questions` array, `score`, `max_score`, `incorrect_question_tags`, and `synced_from_offline` boolean.
5. Vector Index Spec (`docs/atlas_vector_index.json`): Generate the exact JSON definition for the MongoDB Atlas Vector Search index named `vector_index` on `edubridge.curriculum_chunks` (`numDimensions: 768`, `similarity: "cosine"`, plus `filter` fields for `metadata.grade_level`, `metadata.subject`, and `metadata.learning_objective_id`), along with brief instructions on verifying `READY` status in Atlas UI.

### CONSTRAINTS
- Keep schema validations explicit and readable for learners.
- Do not add unapproved packages.

### VERIFICATION / DEFINITION OF DONE
- Show how to run `GET /api/health` to confirm live MongoDB Atlas connectivity and validate schema imports without errors.