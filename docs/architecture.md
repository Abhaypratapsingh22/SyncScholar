# SyncScholar — Architecture & System Design Notes

## 1. System Mission: SDG 4 (Quality Education)
SyncScholar provides curriculum-aligned, adaptive Socratic tutoring and formative micro-assessments for students in low-connectivity, multi-grade rural or underserved classrooms.

---

## 2. Monorepo Architecture Overview

```
SyncScholar/
├── client/                     # Offline-first React + Vite PWA
│   ├── public/                 # Static assets & Web Manifest
│   ├── src/
│   │   ├── components/         # Modular student & teacher UI components
│   │   ├── pages/              # Student & Teacher dashboard views
│   │   ├── hooks/              # Custom hooks (connectivity, offline sync, mastery)
│   │   ├── db/                 # Dexie.js (IndexedDB) offline store
│   │   ├── services/           # Backend API clients
│   │   └── utils/              # Client-side formatters & metrics
│   ├── .env.example
│   └── package.json
├── server/                     # Node.js + Express REST API & AI Orchestration
│   ├── src/
│   │   ├── config/             # DB & environment configuration
│   │   ├── models/             # Mongoose schemas & MongoDB collections
│   │   ├── controllers/        # Request handlers (auth, tutor, quiz, teacher)
│   │   ├── services/           # Core logic: RAG, Socratic tutor, EMA mastery, sync
│   │   ├── middlewares/        # JWT auth, role validation, error handling
│   │   ├── routes/             # Express API route endpoints
│   │   └── utils/              # Readability scores & math utilities
│   ├── .env.example
│   └── package.json
├── ingestion/                  # Offline textbook PDF parser & vector indexer
│   ├── raw_pdfs/               # (Git-ignored) Local NCERT / OpenStax PDFs
│   ├── sample_metadata/        # Example curriculum chunk JSON structures
│   ├── scripts/                # Python scripts (PyMuPDF -> Vector Embeddings -> MongoDB)
│   └── .env.example
├── docs/                       # Architecture specs & Atlas Vector Search definitions
│   ├── architecture.md
│   └── mongodb_vector_index.json
├── Prompt/                     # Prompt workflow templates
├── .gitignore                  # Strict Git exclusion rules
├── Agents.md                   # Core project guidelines & role definitions
└── README.md                   # Project overview & workspace setup
```

---

## 3. Data Plane & Schema Boundaries

### Collection: `curriculum_chunks`
- Primary repository for vetted syllabus content (NCERT, OpenStax).
- Indexed using Atlas Vector Search (`vector_index`) on the `embedding` field with pre-filter fields:
  - `metadata.grade_level` (Number)
  - `metadata.subject` (String)
  - `metadata.learning_objective_id` (String)
  - `metadata.difficulty_tier` (String: 'foundational' | 'intermediate' | 'advanced')

### Collection: `student_profiles`
- Stores individual student mastery records:
  - `current_grade`
  - `concept_mastery`: Array of `{ learning_objective_id, mastery_score, attempts_count, status, last_reviewed }`
  - `recent_quiz_attempts`: Array of quiz submission records with idempotent UUIDs.

---

## 4. Key Architectural Mechanisms

### A. Prerequisite Fallback Mechanism
When a student asks a question on a topic where their mastery score is $< 0.50$ ($50\%$), the retrieval pipeline:
1. Queries the prerequisite graph for the topic's prerequisite `learning_objective_id`s from earlier grades.
2. Expands the `$vectorSearch` filter to include foundational prerequisite chunks alongside the current grade chunk.
3. Guides the student through foundational concepts first before tackling the higher-grade question.

### B. Socratic Anti-Cheating & Readability Guardrails
- LLM prompts instruct the model never to output direct homework answers.
- Answers are framed with step-by-step Socratic questions and real-world analogies.
- Reading level is checked against the student's target grade level via Flesch-Kincaid readability scoring.

### C. Exponential Moving Average (EMA) Mastery Tracking
Each student's topic mastery score $M_t$ is updated after each micro-quiz attempt via:
$$M_t = \alpha \cdot S_t + (1 - \alpha) \cdot M_{t-1}$$
where:
- $\alpha = 0.3$ (smoothing factor giving weight to recent attempts without volatility)
- $S_t$ is the normalized quiz score ($0.0$ to $1.0$)
- $M_{t-1}$ is the previous mastery score (defaults to $0.5$ on first attempt)

### D. Offline-First PWA Synchronization
1. When offline (`navigator.onLine === false`), student quiz attempts are stored in **Dexie.js (IndexedDB)** with `sync_status: 'pending'` and a unique client-generated UUID.
2. Textbook chapter summaries and study flashcards are precached locally.
3. When network connectivity is re-established, an auto-sync worker pushes pending attempts in batches to `/api/quiz/sync`.
4. The server uses the `uuid` to deduplicate retried sync payloads, guaranteeing idempotency.

---

## 5. Teacher Heatmap Aggregation
Teachers view real-time class diagnostics grouped by `learning_objective_id`. Concepts with the highest error rates and lowest average mastery scores are flagged as "Blackboard Review Needed" to optimize multi-grade classroom instructional time.
