### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` before writing code. Follow all rules regarding clean, teachable code, no raw PDFs in Git, and asking explicit permission before installing any new libraries.

### OBJECTIVE
Build the standalone, one-time offline curriculum ingestion script in `/ingestion` that parses NCERT/OpenStax PDF chapters, splits them into hierarchical/overlapping chunks, enriches them with educational metadata, generates 768-dimensional embeddings, and upserts them idempotently into MongoDB Atlas.

### STEP-BY-STEP INSTRUCTIONS
1. Library Proposal & Permission Gate: Recommend the cleanest stack for `/ingestion` (for example, Python with `pymupdf` or `llama-index`, `google-genai` using `gemini-embedding-001` with `output_dimensionality=768`, `pymongo`, and `python-dotenv`, OR a pure Node.js equivalent if you think keeping a single language is simpler). Explain the trade-off, recommend the best option, and wait for my approval before installing.
2. Metadata Manifest (`ingestion/sample_metadata/manifest.json`): Create a clean configuration format mapping local filenames in `ingestion/raw_pdfs/` to curriculum attributes (`source_curriculum`: "NCERT", `grade_level`, `subject`, `chapter_number`, `chapter_title`, `learning_objective_prefix`, `source_url`).
3. Text Extraction & Pedagogical Chunking:
   - Extract text page-by-page while stripping noisy headers/footers.
   - Split passages into ~300–400 word chunks with a 40-word overlap so definitions and examples stay together.
   - Assign deterministic chunk IDs (e.g., `ncert_sci_g7_ch04_p40_c02`) so re-running the script updates existing chunks via `UpdateOne(..., upsert=True)` instead of creating duplicates.
4. Embedding Generation & Batch Upsert:
   - Generate 768-dimensional embeddings with rate-limit-safe batching and retry backoff.
   - Write chunks + vectors + metadata to `edubridge.curriculum_chunks`.
5. Seed Fallback Option (`ingestion/scripts/seed_sample_chunks.js` or `.py`): Include a small 10-chunk open-licensed Class 7 Science ("Heat") sample dataset script so we can immediately test Vector Search even before downloading full PDFs.

### CONSTRAINTS
- Never commit `.pdf` files.
- Handle API rate limits (HTTP 429) gracefully with clear terminal progress logs.

### VERIFICATION / DEFINITION OF DONE
- Provide exact terminal commands to run the ingestion/seed script and verify document counts and 768-float embedding arrays in MongoDB Atlas.