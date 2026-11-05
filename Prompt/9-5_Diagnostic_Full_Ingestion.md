### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` before executing any changes. Follow all development guidelines, clean-code rules, and the Library Permission Gate strictly.

### CURRENT DEFECT & PROBLEM STATEMENT
We ingested NCERT Class 9 Mathematics Part 1 (`iemh101.pdf` through `iemh108.pdf`), but MongoDB Atlas `curriculum_chunks` only contains 3 chunks total for Chapter 1 (and 0 for the remaining chapters). Because only the introductory chapter titles/headers were stored instead of the actual body content (theorems, definitions, worked examples, coordinate planes, and exercises), the RAG pipeline fails to answer any Class 9 math queries.

### OBJECTIVE
Diagnose and overhaul the ingestion pipeline in `/ingestion` so that every single page and content section across all 8 chapters of Class 9 Maths Part 1 is thoroughly extracted, pedagogical-chunked, embedded, and upserted into MongoDB Atlas `curriculum_chunks`, restoring full RAG tutor functionality.

---

### STEP-BY-STEP INSTRUCTIONS

#### Step 1: Ingestion Diagnostic & Extraction Audit
1. Write a temporary diagnostic utility script `ingestion/scripts/debug_extract_chapter.js` that takes a single PDF (`iemh101.pdf`), runs extraction page-by-page, and logs:
   - Total pages detected vs. pages extracted.
   - Word count per page before and after `stripHeadersAndFooters`.
   - Pages discarded by the low-density filter (`< 40 words`).
2. Run this diagnostic on `iemh101.pdf` (pages 1 to 10) to identify the exact lines of code where mathematical text, worked solutions, and theorems are being dropped.

#### Step 2: Overhaul Text Extraction & Cleaning (`ingest_curriculum.js`)
1. **Fix `extractPagesFromPdf`:**
   - Ensure the `pdf-parse` pagerender handles NCERT's two-column and sidebar layout without corrupting line sequence or dropping text spans with math glyphs.
   - Replace rigid single-pass Y-coordinate sorting with a block-aware extraction that concatenates text cleanly.
2. **Refine `stripHeadersAndFooters`:**
   - Make header/footer regex strict and targeted *only* to the exact page margins (top 40px and bottom 40px) or exact boilerplate phrases ("Rationalised 2024-25", "Reprint 2024", "Not to be republished").
   - Ensure it NEVER deletes lines containing mathematical keywords: "Example", "Solution", "Theorem", "Definition", "Activity", "Coordinates", "Cartesian", "Abscissa", "Ordinate", or equation symbols (`=`, `+`, `-`, `x`, `y`).
3. **Adjust the Low-Density Filter for Math:**
   - Lower the minimum page discard threshold from 40 words to 15 words so pages with geometric diagrams, coordinate grids, and concise algebraic definitions are preserved.

#### Step 3: Math-Aware Pedagogical Chunking (`chunkText`)
1. **Restructure Chunk Slicing:**
   - Target chunk size: 250–350 words (or 3–4 logical paragraphs) with a 40-word overlap.
   - Ensure boundary detection respects natural math breaks: do NOT slice chunks in the middle of a numbered "Example X" or "Solution" block. Keep the problem statement and its worked steps inside the same chunk whenever possible.
2. **Preserve Learning Objective Tagging:**
   - In `createDeterministicChunkId` and metadata generation, ensure each chunk properly inherits:
     - `source_curriculum`: "NCERT"
     - `grade_level`: 9
     - `subject`: "Mathematics"
     - `chapter_number`: Integer (1 to 8)
     - `chapter_title`: Extracted from `manifest.json`
     - `page_number`: Exact textbook page
     - `source_url`: Official NCERT chapter URL

#### Step 4: Validate `manifest.json` for All 8 Chapters
Ensure `ingestion/sample_metadata/manifest.json` correctly registers all 8 chapters of Class 9 Maths Part 1 located in `ingestion/raw_pdfs/Ncert_class_9_part1/`:
- `iemh101.pdf`: Ch 1 — "Orienting Yourself: The Use of Coordinates" (`MATH-09-COORD`)
- `iemh102.pdf`: Ch 2 — "Introduction to Linear Polynomials" (`MATH-09-POLY`)
- `iemh103.pdf`: Ch 3 — "The World of Numbers" (`MATH-09-NUM`)
- `iemh104.pdf`: Ch 4 — "Exploring Algebraic Identities" (`MATH-09-IDENT`)
- `iemh105.pdf`: Ch 5 — "I'm Up and Down, and Round and Round" (`MATH-09-CURV`)
- `iemh106.pdf`: Ch 6 — "Measuring Space: Perimeter and Area" (`MATH-09-MENS`)
- `iemh107.pdf`: Ch 7 — "The Mathematics of Maybe: Introduction to Probability" (`MATH-09-PROB`)
- `iemh108.pdf`: Ch 8 — "Sequences and Progressions" (`MATH-09-SEQ`)

#### Step 5: Execute Ingestion with Rate-Limit Backoff
1. Run the overhauling script across all 8 chapters:
   `node ingestion/scripts/ingest_curriculum.js`
2. Ensure batch upsert via `bulkWrite` with `{ upsert: true }` so existing 3 chunks are overwritten with rich content.
3. Keep the 350ms delay and exponential backoff on `gemini-embedding-001` calls to avoid HTTP 429 quota errors.

---

### VERIFICATION & DEFINITION OF DONE
1. **Database Audit (`verify_curriculum_chunks.js`):**
   - Run verification and report the total chunk count for Grade 9 Mathematics. Each chapter should yield between 15 to 40 chunks (totaling 150+ chunks across Part 1, not just 3).
2. **Text Quality Inspection:**
   - Print 2 sample chunks from Chapter 1 to confirm that actual explanations (such as Cartesian plane, x-axis, y-axis, quadrants, and coordinate plotting) are present in the `text` field.
3. **End-to-End RAG Verification (`test_math_rag.js`):**
   - Execute a test query simulating a Grade 9 student asking:
     `"What is the Cartesian plane and what are the x and y coordinates of the origin?"`
   - Verify that:
     a) `vectorSearchService.js` retrieves the newly ingested Class 9 Math chunks with similarity scores > 0.70.
     b) `ragTutorService.js` returns a Socratic, curriculum-grounded explanation citing NCERT Grade 9 Chapter 1 with page numbers.