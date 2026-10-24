### CONTEXT & PRE-FLIGHT MANDATE
Before doing anything, read `AGENTS.md` in full and strictly follow every rule in it throughout this task. Act in your assigned role as our Senior Full-Stack AI Engineering Mentor.

### OBJECTIVE
Initialize the clean monorepo folder structure, configuration templates, and Git hygiene rules for **SyncScholar** (Curriculum-Aligned Adaptive Tutor for Underserved Classrooms — SDG 4) without installing any unapproved third-party libraries yet.

### STEP-BY-STEP INSTRUCTIONS
1. Propose and create a clean, teachable monorepo folder architecture containing:
   - `/client` (Vite + React frontend PWA workspace structure: `src/components`, `src/pages`, `src/hooks`, `src/db`, `src/services`, `src/utils`, `public`)
   - `/server` (Node.js + Express backend workspace structure: `src/config`, `src/models`, `src/controllers`, `src/services`, `src/middlewares`, `src/routes`, `src/utils`)
   - `/ingestion` (Standalone one-time offline PDF parsing and vector indexing workspace: `scripts/`, `sample_metadata/`, and a git-ignored `raw_pdfs/` directory)
   - `/docs` (Architecture notes and MongoDB Atlas Vector Search index JSON definitions)
2. Create a strict root `.gitignore` that explicitly excludes `node_modules/`, `.venv/`, `.env`, `dist/`, build artifacts, and `ingestion/raw_pdfs/*.pdf` so raw textbook PDFs are never committed to Git.
3. Create `.env.example` files for `/server`, `/client`, and `/ingestion` documenting every required variable (`PORT`, `MONGODB_URI`, `GEMINI_API_KEY`, `JWT_SECRET`, `VITE_API_BASE_URL`) with clear inline comments explaining how to obtain each one.
4. Create minimal `package.json` skeletons (or pause and ask permission first) for `/server` and `/client`.

### CONSTRAINTS & LIBRARY PERMISSION GATE (STRICT)
- Do NOT run `npm install`, `pip install`, or add third-party packages yet.
- List the exact baseline libraries you recommend for `/server`, `/client`, and `/ingestion`, clearly explain why each library is needed, and ask for my explicit permission before installing them.

### VERIFICATION / DEFINITION OF DONE
- Output a visual directory tree of the created workspace.
- Present the proposed dependency table and wait for my approval.