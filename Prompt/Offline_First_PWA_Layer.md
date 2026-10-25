### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` in full before writing any code. Strictly follow the Library Permission Gate, UI Implementation Rules, and Architecture Guidelines.

### OBJECTIVE
Transform `/client` into a resilient Offline-First Progressive Web App (PWA) so students in schools with intermittent internet can study cached flashcards, review past tutor explanations, complete queued quizzes offline, and auto-sync seamlessly when internet connectivity returns.

### STEP-BY-STEP INSTRUCTIONS
1. Library Gate: Recommend `dexie` (lightweight IndexedDB wrapper) and `vite-plugin-pwa` (Workbox service worker integration), clearly explain how they simplify IndexedDB schema versioning and asset caching, and wait for my explicit permission before installing.
2. Local IndexedDB Store (`client/src/db/offlineDb.js`):
   - Define clean stores for:
     - `cached_flashcards` (indexed by `subject`, `learning_objective_id`)
     - `cached_quizzes` (pre-fetched diagnostic quizzes ready for offline practice)
     - `cached_tutor_history` (recent curriculum Q&A + textbook citations for offline revision)
     - `pending_quiz_submissions` (`client_attempt_id`, payload, `created_at`, `sync_status`)
3. Offline Sync Hook & Background Manager (`client/src/hooks/useOfflineSync.js`):
   - Listen to `navigator.onLine`, `online`/`offline` window events, and periodic lightweight `/api/health` reachability checks.
   - When offline: intercept quiz submissions, save them to `pending_quiz_submissions` in IndexedDB, compute immediate local score feedback for the student, and increment the header's "Pending Sync" counter.
   - When back online: automatically flush `pending_quiz_submissions` to `POST /api/assessments/sync-batch` using `client_attempt_id` for idempotency, clear synced records, and refresh the student's `concept_mastery` state.
4. Service Worker & PWA Manifest:
   - Configure static JS/CSS/SVG shell precaching and provide minimalist SVG PWA icons compliant with `AGENTS.md`.

### CONSTRAINTS
- Never lose a student's quiz attempt during sudden Wi-Fi/mobile-data drops.
- Clearly communicate offline limits in the UI (e.g., disable live new RAG generation gracefully when offline while highlighting available cached flashcards and quizzes).

### VERIFICATION / DEFINITION OF DONE
- Provide step-by-step Chrome DevTools ("Network -> Offline") test instructions proving offline flashcard browsing, offline quiz completion, and automatic background sync upon toggling back Online.