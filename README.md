# SyncScholar 🎓📚
### Curriculum-Aligned Adaptive Tutor for Underserved Classrooms (SDG 4: Quality Education)

SyncScholar is an offline-resilient, curriculum-grounded Retrieval-Augmented Generation (RAG) tutoring and formative assessment platform designed specifically for low-connectivity, multi-grade rural and underserved learning environments.

---

## 🏛️ Monorepo Architecture

- **`client/`**: Offline-first Progressive Web App (PWA) built with Vite and React, utilizing Dexie.js (IndexedDB) for local caching and offline quiz queueing.
- **`server/`**: Modular Node.js + Express backend orchestrating Socratic AI tutoring, MongoDB Atlas Vector Search retrieval, and idempotent offline synchronization.
- **`ingestion/`**: Standalone offline Python pipeline for extracting NCERT/OpenStax textbook passages and generating dense vector embeddings into MongoDB Atlas.
- **`docs/`**: Architectural documentation and MongoDB Atlas Vector Search index definitions.

---

## 🚀 Getting Started

### 1. Workspace Configuration
Copy `.env.example` to `.env` in each workspace and fill in your credentials:
```bash
# Server configuration
cp server/.env.example server/.env

# Client configuration
cp client/.env.example client/.env

# Ingestion configuration
cp ingestion/.env.example ingestion/.env
```

### 2. Dependency Approval Gate
As per `AGENTS.md` guidelines, third-party library installations require explicit team review and approval before running `npm install` or `pip install`. Refer to the proposed dependency table in the documentation.

---

## 🛡️ Git Hygiene
- Raw textbook `.pdf` files are strictly excluded from Git tracking (`ingestion/raw_pdfs/*.pdf`).
- All environment secret files (`.env`, `.env.*`) are ignored.
- Only schema-conforming curriculum chunks and metadata are tracked.
