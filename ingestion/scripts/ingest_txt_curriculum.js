/**
 * SyncScholar — Offline Curriculum Text Ingestion Pipeline
 * 
 * Implements the intelligent PDF processing, structural cleaning, and pedagogical
 * chunking rules from Prompt 9-6 (Deliverables 1-5) for NCERT Class 9 Science.
 * 
 * Source: `ingestion/raw_pdfs_data/class_9_science.txt`
 * Output: Upserted chunks in MongoDB Atlas `curriculum_chunks` with 768-dim embeddings.
 * 
 * Usage:
 *   node scripts/ingest_txt_curriculum.js --dry-run
 *   node scripts/ingest_txt_curriculum.js --chapter=2 --dry-run
 *   node scripts/ingest_txt_curriculum.js --chapter=2
 *   node scripts/ingest_txt_curriculum.js --all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Disable TLS reject for corporate proxies if running locally
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INGESTION_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(INGESTION_ROOT, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'syncscholar';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'curriculum_chunks';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL?.replace(/^models\//, '') || 'gemini-embedding-001';

const SOURCE_TXT_PATH = path.join(INGESTION_ROOT, 'raw_pdfs_data', 'class_9_science.txt');
const MANIFEST_PATH = path.join(INGESTION_ROOT, 'sample_metadata', 'manifest.json');

// CLI Arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const chapterArg = args.find((a) => a.startsWith('--chapter='))?.split('=')[1];
const targetChapter = chapterArg ? parseInt(chapterArg, 10) : null;
const limitChunksArg = args.find((a) => a.startsWith('--limit-chunks='))?.split('=')[1];
const chunkLimit = limitChunksArg ? parseInt(limitChunksArg, 10) : null;

// Chunking Configuration
const TARGET_CHUNK_WORDS = 320;
const MAX_CHUNK_WORDS = 420;
const MIN_CHUNK_WORDS = 25;
const OVERLAP_WORDS = 40;

// Official NCERT Class 9 Science ("Exploration") Chapter Registry
export const CHAPTER_REGISTRY = {
  1: {
    title: 'Exploration: Entering the World of Secondary Science',
    prefix: 'SCI-09-EXPL',
    startPage: 1,
    url: 'https://ncert.nic.in/textbook.php?jesc1=1-13'
  },
  2: {
    title: 'Cell: The Building Block of Life',
    prefix: 'SCI-09-CELL',
    startPage: 9,
    url: 'https://ncert.nic.in/textbook.php?jesc1=2-13'
  },
  3: {
    title: 'Tissues in Action',
    prefix: 'SCI-09-TISS',
    startPage: 29,
    url: 'https://ncert.nic.in/textbook.php?jesc1=3-13'
  },
  4: {
    title: 'Describing Motion Around Us',
    prefix: 'SCI-09-MOTI',
    startPage: 43,
    url: 'https://ncert.nic.in/textbook.php?jesc1=4-13'
  },
  5: {
    title: 'Exploring Mixtures and their Separation',
    prefix: 'SCI-09-MIXT',
    startPage: 63,
    url: 'https://ncert.nic.in/textbook.php?jesc1=5-13'
  },
  6: {
    title: 'How Forces Affect Motion',
    prefix: 'SCI-09-FORC',
    startPage: 81,
    url: 'https://ncert.nic.in/textbook.php?jesc1=6-13'
  },
  7: {
    title: 'Work, Energy, and Simple Machines',
    prefix: 'SCI-09-WORK',
    startPage: 101,
    url: 'https://ncert.nic.in/textbook.php?jesc1=7-13'
  },
  8: {
    title: 'Journey Inside the Atom',
    prefix: 'SCI-09-ATOM',
    startPage: 121,
    url: 'https://ncert.nic.in/textbook.php?jesc1=8-13'
  },
  9: {
    title: 'Atomic Foundations of Matter',
    prefix: 'SCI-09-MATT',
    startPage: 139,
    url: 'https://ncert.nic.in/textbook.php?jesc1=9-13'
  },
  10: {
    title: 'Sound Waves: Characteristics and Applications',
    prefix: 'SCI-09-SOUN',
    startPage: 157,
    url: 'https://ncert.nic.in/textbook.php?jesc1=10-13'
  },
  11: {
    title: 'Reproduction: How Life Continues',
    prefix: 'SCI-09-REPR',
    startPage: 209,
    url: 'https://ncert.nic.in/textbook.php?jesc1=11-13'
  },
  12: {
    title: 'Patterns in Life: Diversity and Classification',
    prefix: 'SCI-09-DIVE',
    startPage: 229,
    url: 'https://ncert.nic.in/textbook.php?jesc1=12-13'
  },
  13: {
    title: 'Earth as a System: Energy, Matter, and Life',
    prefix: 'SCI-09-EART',
    startPage: 253,
    url: 'https://ncert.nic.in/textbook.php?jesc1=13-13'
  }
};

/**
 * Parses raw extracted text file into structured chapters with accurate page tracking
 * and noise filtering.
 */
export function parseAndCleanTextbook(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const chapters = [];
  let currentChapter = null;
  let currentLines = [];
  let currentPage = 1;

  // Find all chapter boundaries: -+chapter\s*(\d+)-+
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const chapterMatch = line.match(/-+\s*chapter\s*(\d+)\s*-+/i);

    if (chapterMatch) {
      if (currentChapter) {
        currentChapter.rawLines = currentLines;
        chapters.push(currentChapter);
      }
      const chNum = parseInt(chapterMatch[1], 10);
      const meta = CHAPTER_REGISTRY[chNum] || {
        title: `Chapter ${chNum}`,
        prefix: `SCI-09-CH${String(chNum).padStart(2, '0')}`,
        startPage: chNum * 15,
        url: null
      };
      currentChapter = {
        number: chNum,
        title: meta.title,
        prefix: meta.prefix,
        startPage: meta.startPage,
        url: meta.url,
        rawLines: []
      };
      currentLines = [];
      currentPage = meta.startPage;
      continue;
    }

    if (currentChapter) {
      currentLines.push(line);
    }
  }

  if (currentChapter && currentLines.length > 0) {
    currentChapter.rawLines = currentLines;
    chapters.push(currentChapter);
  }

  return chapters;
}

/**
 * Cleans a chapter's raw lines, extracts page markers, removes running headers/footers,
 * and normalizes structural sections.
 */
export function cleanChapterContent(chapter) {
  const lines = chapter.rawLines;
  const processedBlocks = [];
  let currentPage = chapter.startPage;
  let currentSection = 'Introduction';
  let buffer = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text.split(/\s+/).length >= 5) {
      processedBlocks.push({
        text,
        pageNumber: currentPage,
        section: currentSection
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) {
      flushBuffer();
      continue;
    }

    const isValidChapterPage = (p) => p >= chapter.startPage && p <= chapter.startPage + 32;

    // 1. Detect Even Page Header: "<PageNum> Exploration|Grade 9" or "Exploration|Grade 9 <PageNum>"
    const evenPageMatch = rawLine.match(/^(\d{1,3})\s+Exploration\s*\|\s*Grade\s*9$/i) ||
                          rawLine.match(/^Exploration\s*\|\s*Grade\s*9\s+(\d{1,3})$/i);
    if (evenPageMatch) {
      const p = parseInt(evenPageMatch[1], 10);
      if (isValidChapterPage(p)) {
        flushBuffer();
        currentPage = p;
        continue;
      }
    }

    // 2. Pure "Exploration|Grade 9" running header (no page number on this line)
    if (/^Exploration\s*\|\s*Grade\s*9$/i.test(rawLine)) {
      flushBuffer();
      continue;
    }

    // 3. Detect Odd Page Header: "<PageNum> <Chapter Title>" (e.g. "213 Reproduction: How Life Continues")
    const prefixPageMatch = rawLine.match(/^(\d{1,3})\s+([A-Za-z\s:,—\-]+)$/);
    if (prefixPageMatch && prefixPageMatch[2].length > 8 && !/Exploration\s*\|\s*Grade/i.test(prefixPageMatch[2])) {
      const pNum = parseInt(prefixPageMatch[1], 10);
      if (isValidChapterPage(pNum)) {
        flushBuffer();
        currentPage = pNum;
        continue;
      }
    }

    // 4. Detect Odd Page Header: "<Chapter Title> <PageNum>" (e.g. "Tissues in Action 31")
    const oddPageMatch = rawLine.match(/^([A-Za-z\s:,—\-]+?)\s+(\d{1,3})$/);
    if (oddPageMatch && !/Exploration\s*\|\s*Grade/i.test(oddPageMatch[1].trim())) {
      const pNum = parseInt(oddPageMatch[2], 10);
      const titleCandidate = oddPageMatch[1].trim();
      if (
        isValidChapterPage(pNum) &&
        (titleCandidate.toLowerCase().includes('exploration') ||
         titleCandidate.toLowerCase().includes('science') ||
         titleCandidate.toLowerCase().includes(chapter.title.split(':')[0].toLowerCase()) ||
         chapter.title.toLowerCase().includes(titleCandidate.toLowerCase()))
      ) {
        flushBuffer();
        currentPage = pNum;
        continue;
      }
    }

    // 5. Standalone page number (e.g. "186", "40", "132" on its own line)
    if (/^\d{1,3}$/.test(rawLine)) {
      const pNum = parseInt(rawLine, 10);
      if (isValidChapterPage(pNum)) {
        flushBuffer();
        currentPage = pNum;
        continue;
      }
    }

    // 3. Detect and skip inter-textbook cross-references (e.g., "Grade 8 Curiosity Chapter 10")
    if (/^Grade\s*\d+\s*$/i.test(rawLine)) {
      if (i + 1 < lines.length && /^(Curiosity|Exploration)/i.test(lines[i + 1].trim())) {
        i += 2; // Skip "Grade X", "Curiosity", "Chapter Y"
        continue;
      }
    }

    // 4. Skip standalone repeated running chapter titles or single numbers
    if (rawLine === chapter.title || rawLine === 'Chapter' || rawLine === String(chapter.number)) {
      continue;
    }

    // 5. Detect Section Headings (e.g., "2.1 How to Study Cells?", "2.2.1 Cell membrane...")
    // Must start with current chapter number and be followed by capital letter title (not '0.1 mm' or '3.5 billion')
    const sectionRegex = new RegExp(`^(${chapter.number}\\.\\d+(?:\\.\\d+)?)\\s+([A-Z].+)$`);
    const sectionMatch = rawLine.match(sectionRegex);
    if (sectionMatch && !/(?:mm|nm|µm|cm|m|billion|million)\b/i.test(sectionMatch[2])) {
      flushBuffer();
      currentSection = `${sectionMatch[1]} ${sectionMatch[2]}`;
      buffer.push(rawLine);
      continue;
    }

    // 6. Detect Activity / Example / Table / Summary headers
    if (/^(Activity|Example|Table)\s+\d+\.\d+/i.test(rawLine) ||
        /^(Think It Over|Meet a Scientist|Ready to Go Beyond|Threads of Curiosity|Pause and Ponder|At a Glance|Revise, Reflect, Refine)/i.test(rawLine)) {
      flushBuffer();
      buffer.push(rawLine);
      continue;
    }

    // 7. Filter isolated diagram callout label dumps (vertical list of single words without verbs)
    const isIsolatedCallout = /^(Vacuole|Chloroplast|Cell wall|Cytoplasm|Nucleoid|Ribosome|Mitochondria|Golgi body|Lysosome)$/i.test(rawLine);
    if (isIsolatedCallout && buffer.length === 0) {
      continue; // Skip orphan diagram label
    }

    buffer.push(rawLine);
  }

  flushBuffer();
  return processedBlocks;
}

/**
 * Slices blocks into pedagogical chunks (~250-350 words) with overlap.
 */
export function chunkBlocks(blocks, chapter) {
  const chunks = [];
  let currentWords = [];
  let chunkPage = blocks[0]?.pageNumber || chapter.startPage;
  let chunkSection = blocks[0]?.section || 'General';
  let chunkIndex = 1;

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const bWords = block.text.split(/\s+/).filter(Boolean);

    // If adding this block exceeds maximum chunk words and we already have sufficient content
    if (currentWords.length + bWords.length > MAX_CHUNK_WORDS && currentWords.length >= 200) {
      const chunkText = currentWords.join(' ');
      chunks.push(createChunkObject(chunkText, chapter, chunkPage, chunkSection, chunkIndex));
      chunkIndex++;

      // Retain trailing words for overlap
      const overlap = currentWords.slice(-OVERLAP_WORDS);
      currentWords = [...overlap, ...bWords];
      chunkPage = block.pageNumber;
      chunkSection = block.section;
    } else {
      if (currentWords.length === 0) {
        chunkPage = block.pageNumber;
        chunkSection = block.section;
      }
      currentWords.push(...bWords);
    }
  }

  if (currentWords.length >= MIN_CHUNK_WORDS) {
    const chunkText = currentWords.join(' ');
    chunks.push(createChunkObject(chunkText, chapter, chunkPage, chunkSection, chunkIndex));
  }

  return chunks;
}

/**
 * Creates a standardized chunk document matching MongoDB Atlas curriculum_chunks schema.
 */
function createChunkObject(text, chapter, pageNumber, section, index) {
  const chunkId = `ncert_sci_g9_ch${String(chapter.number).padStart(2, '0')}_p${String(pageNumber).padStart(2, '0')}_c${String(index).padStart(2, '0')}`;
  const loId = `${chapter.prefix}-${String(index).padStart(2, '0')}`;

  // Pedagogical difficulty tier determination
  let difficulty = 'standard';
  if (index <= 3 || /introduction|nature of|what is/i.test(section)) {
    difficulty = 'foundational';
  } else if (index >= 15 || /formula|mathematical|problems|experiments/i.test(section)) {
    difficulty = 'advanced';
  }

  return {
    chunk_id: chunkId,
    text: text,
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: chapter.number,
      chapter_title: chapter.title,
      learning_objective_id: loId,
      difficulty_tier: difficulty,
      page_number: pageNumber,
      source_url: chapter.url,
      section_title: section
    }
  };
}

/**
 * Generates 768-dimensional embeddings with exponential backoff on HTTP 429.
 */
async function generateEmbeddingWithRetry(model, text, maxRetries = 6) {
  let attempt = 0;
  let delay = 1200;

  while (attempt < maxRetries) {
    try {
      const response = await model.embedContent({
        content: { parts: [{ text }] },
        outputDimensionality: 768
      });
      return response.embedding.values;
    } catch (err) {
      attempt++;
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      if (isRateLimit && attempt < maxRetries) {
        console.warn(`   ⚠️ Rate limit hit. Backing off for ${(delay / 1000).toFixed(1)}s (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Embedding generation failed after ${maxRetries} attempts.`);
}

/**
 * Main Execution Function
 */
async function main() {
  console.log('================================================================');
  console.log('📖 SyncScholar Class 9 Science Ingestion Pipeline');
  console.log('================================================================');
  console.log(`📌 Source: ${SOURCE_TXT_PATH}`);
  console.log(`📌 Target DB: [${DATABASE_NAME}] | Collection: [${COLLECTION_NAME}]`);
  console.log(`🧠 Embedding Model: [${EMBEDDING_MODEL_NAME}] (outputDimensionality: 768)`);
  if (isDryRun) console.log('🧪 DRY-RUN MODE: Parsing and chunking only, skipping API & DB writes.');
  if (targetChapter) console.log(`🎯 Targeting Chapter: ${targetChapter}`);
  if (chunkLimit) console.log(`⏱️ Chunk Limit: Maximum ${chunkLimit} chunks.`);

  if (!fs.existsSync(SOURCE_TXT_PATH)) {
    console.error(`❌ Source text file not found at: ${SOURCE_TXT_PATH}`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(SOURCE_TXT_PATH, 'utf-8');
  console.log(`\n⏳ Parsing and cleaning chapters from extracted text...`);
  const chapters = parseAndCleanTextbook(rawText);
  console.log(`✅ Detected ${chapters.length} chapters.`);

  const chaptersToProcess = targetChapter
    ? chapters.filter((c) => c.number === targetChapter)
    : chapters;

  if (chaptersToProcess.length === 0) {
    console.error(`❌ Chapter ${targetChapter} not found in parsed chapters.`);
    process.exit(1);
  }

  // Pre-calculate all chunks
  const allChunks = [];
  for (const chapter of chaptersToProcess) {
    const blocks = cleanChapterContent(chapter);
    const chunks = chunkBlocks(blocks, chapter);
    console.log(`   📚 Chapter ${chapter.number}: "${chapter.title}" -> ${blocks.length} blocks -> ${chunks.length} chunks`);
    allChunks.push(...chunks);
  }

  console.log(`\n🧩 Total Pedagogical Chunks Prepared: ${allChunks.length}`);

  if (allChunks.length > 0) {
    console.log('\n🔍 Sample Chunk Preview:');
    const sample = allChunks[0];
    console.log(`   ID: ${sample.chunk_id}`);
    console.log(`   Grade: ${sample.metadata.grade_level} | Subject: ${sample.metadata.subject}`);
    console.log(`   Chapter: ${sample.metadata.chapter_number} - ${sample.metadata.chapter_title}`);
    console.log(`   Section: ${sample.metadata.section_title} | Page: ${sample.metadata.page_number}`);
    console.log(`   LO ID: ${sample.metadata.learning_objective_id} | Tier: ${sample.metadata.difficulty_tier}`);
    console.log(`   Word Count: ${sample.text.split(/\s+/).length}`);
    console.log(`   Text Excerpt:\n   "${sample.text.slice(0, 200)}..."\n`);
  }

  if (isDryRun) {
    console.log('✨ Dry run complete. No database writes or embedding calls made.');
    return;
  }

  // Live Embedding and Database Upsert
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is required in ingestion/.env');
    process.exit(1);
  }
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is required in ingestion/.env');
    process.exit(1);
  }

  const chunksToEmbed = chunkLimit ? allChunks.slice(0, chunkLimit) : allChunks;
  console.log(`⏳ Connecting to MongoDB Atlas: [${DATABASE_NAME}]...`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);
  console.log('✅ Connected to MongoDB Atlas.');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

  console.log(`\n⚡ Generating 768-dim embeddings and upserting ${chunksToEmbed.length} chunks...`);
  let upsertedCount = 0;
  const bulkBatchSize = 10;
  let currentBatch = [];

  for (let i = 0; i < chunksToEmbed.length; i++) {
    const chunk = chunksToEmbed[i];
    process.stdout.write(`   [${i + 1}/${chunksToEmbed.length}] Embedding ${chunk.chunk_id} (p. ${chunk.metadata.page_number})... `);

    try {
      const embedding = await generateEmbeddingWithRetry(embeddingModel, chunk.text);
      process.stdout.write('✅ 768-dim\n');

      const document = {
        _id: chunk.chunk_id,
        chunk_id: chunk.chunk_id,
        text: chunk.text,
        embedding: embedding,
        metadata: chunk.metadata,
        updated_at: new Date()
      };

      currentBatch.push({
        updateOne: {
          filter: { _id: chunk.chunk_id },
          update: { $set: document },
          upsert: true
        }
      });

      if (currentBatch.length >= bulkBatchSize || i === chunksToEmbed.length - 1) {
        const result = await collection.bulkWrite(currentBatch, { ordered: false });
        upsertedCount += (result.upsertedCount + result.modifiedCount + result.matchedCount);
        currentBatch = [];
      }

      // 400ms throttle between calls to maintain quota headroom
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`\n❌ Failed to embed chunk ${chunk.chunk_id}: ${err.message}`);
      break;
    }
  }

  console.log('\n================================================================');
  console.log('🎉 INGESTION COMPLETE');
  console.log('================================================================');
  console.log(`🧩 Total Chunks Processed: ${upsertedCount}`);
  const finalCount = await collection.countDocuments();
  console.log(`📚 Total Chunks in [${COLLECTION_NAME}]: ${finalCount}`);

  await client.close();
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('ingest_txt_curriculum.js')) {
  main().catch((err) => {
    console.error('Fatal Ingestion Error:', err);
    process.exit(1);
  });
}
