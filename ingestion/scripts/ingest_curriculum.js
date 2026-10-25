/**
 * SyncScholar — Offline Curriculum PDF Ingestion Pipeline
 * 
 * Objective:
 * Standalone offline pipeline that reads NCERT / OpenStax textbook PDFs from
 * `ingestion/raw_pdfs/`, extracts text page-by-page, strips noisy running
 * headers/footers, splits text into ~300-400 word pedagogical chunks with 40-word
 * overlap, enriches with educational metadata, generates 768-dimensional embeddings
 * via Gemini (`gemini-embedding-001`), and idempotently upserts into MongoDB Atlas.
 * 
 * CLI Usage:
 *   node scripts/ingest_curriculum.js
 *   node scripts/ingest_curriculum.js --file=iemh101.pdf
 *   node scripts/ingest_curriculum.js --file=iemh101.pdf --limit-pages=3
 *   node scripts/ingest_curriculum.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pdf from 'pdf-parse';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// -----------------------------------------------------------------------------
// 1. Environment & Configuration Setup
// -----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INGESTION_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(INGESTION_ROOT, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'syncscholar';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'curriculum_chunks';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL?.replace(/^models\//, '') || 'gemini-embedding-001';

const MANIFEST_PATH = path.join(INGESTION_ROOT, 'sample_metadata', 'manifest.json');
const RAW_PDFS_DIR = path.join(INGESTION_ROOT, 'raw_pdfs');

// CLI Argument Parsing
const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith('--file='))?.split('=')[1];
const limitPagesArg = args.find((a) => a.startsWith('--limit-pages='))?.split('=')[1];
const isDryRun = args.includes('--dry-run');
const pageLimit = limitPagesArg ? parseInt(limitPagesArg, 10) : null;

// Chunking Configuration
const TARGET_CHUNK_WORDS = 350;
const CHUNK_OVERLAP_WORDS = 40;
const MIN_CHUNK_WORDS = 40;

// -----------------------------------------------------------------------------
// 2. Helper Functions
// -----------------------------------------------------------------------------

/**
 * Derives a standardized 3-letter subject code for deterministic chunk IDs.
 */
function getSubjectCode(subject = '') {
  const s = subject.toLowerCase().trim();
  if (s.includes('sci')) return 'sci';
  if (s.includes('math')) return 'mat';
  if (s.includes('eng')) return 'eng';
  if (s.includes('soc') || s.includes('hist') || s.includes('geo')) return 'soc';
  return s.slice(0, 3);
}

/**
 * Strips running book headers, chapter title headers, and publication boilerplate.
 */
function stripHeadersAndFooters(pageText, chapterTitle = '') {
  let text = pageText;

  // Normalize Windows/Unix newlines
  text = text.replace(/\r\n/g, '\n');

  // Strip running book header (e.g., '2 Ganita Manjari | Grade 9 | Part I')
  text = text.replace(/^\s*\d+\s+[A-Za-z\s]+?\|\s*Grade\s*\d+\s*\|\s*Part\s*[A-Za-z0-9]+/gim, '');

  // Strip running chapter title header if present (e.g. '3 Orienting Yourself: The Use of Coordinates')
  if (chapterTitle && chapterTitle.trim().length > 3) {
    const escaped = chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('^\\s*\\d+\\s+' + escaped, 'gim'), '');
    text = text.replace(new RegExp(escaped + '\\s*$', 'gim'), '');
  }

  // Strip common NCERT boilerplate footers
  text = text.replace(/Rationalised\s*\d{4}-\d{2}/gi, '');
  text = text.replace(/Not to be republished/gi, '');
  text = text.replace(/Reprint\s*\d{4}/gi, '');

  // Strip standalone page numbers at beginning or end of page
  text = text.replace(/^\s*\d+\s*\n/, '');
  text = text.replace(/\n\s*\d+\s*$/, '');

  // Normalize excessive spaces and linebreaks
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

  return text;
}

/**
 * Splits text into overlapping word chunks (~300–400 words, 40-word overlap).
 */
function chunkText(text, targetWords = TARGET_CHUNK_WORDS, overlapWords = CHUNK_OVERLAP_WORDS) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // If text is small enough, return as single chunk
  if (words.length <= targetWords + 30) {
    return [words.join(' ')];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < words.length) {
    const endIndex = Math.min(startIndex + targetWords, words.length);
    const chunkWords = words.slice(startIndex, endIndex);

    if (chunkWords.length >= MIN_CHUNK_WORDS || chunks.length === 0) {
      chunks.push(chunkWords.join(' '));
    } else if (chunks.length > 0) {
      // Append leftover small words to the previous chunk to maintain coherence
      chunks[chunks.length - 1] += ' ' + chunkWords.join(' ');
    }

    if (endIndex >= words.length) {
      break;
    }

    startIndex += targetWords - overlapWords;
  }

  return chunks;
}

/**
 * Generates deterministic chunk ID matching schema (e.g., `ncert_mat_g9_ch01_p02_c01`).
 */
function createDeterministicChunkId(curriculum, subject, grade, chapterNum, pageNum, chunkIdx) {
  const cur = (curriculum || 'ncert').toLowerCase();
  const sub = getSubjectCode(subject);
  const gr = `g${grade}`;
  const ch = `ch${String(chapterNum).padStart(2, '0')}`;
  const p = `p${String(pageNum).padStart(2, '0')}`;
  const c = `c${String(chunkIdx).padStart(2, '0')}`;
  return `${cur}_${sub}_${gr}_${ch}_${p}_${c}`;
}

/**
 * Extracts page-by-page text from a PDF file using pdf-parse.
 */
async function extractPagesFromPdf(filePath, pageLimitCount = null) {
  const buffer = fs.readFileSync(filePath);
  const pages = [];

  const options = {
    pagerender: async function (pageData) {
      const pageNumber = pageData.pageNumber;
      if (pageLimitCount && pageNumber > pageLimitCount) {
        return '';
      }
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(' ');
      pages.push({ pageNumber, text });
      return text;
    }
  };

  await pdf(buffer, options);
  // Sort by page number to guarantee ascending order
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return pages;
}

/**
 * Generates 768-dimensional embeddings using Gemini with exponential backoff on HTTP 429.
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

// -----------------------------------------------------------------------------
// 3. Main Ingestion Pipeline
// -----------------------------------------------------------------------------
async function runIngestion() {
  console.log('================================================================');
  console.log('📖 SyncScholar Offline PDF Curriculum Ingestion Pipeline');
  console.log('================================================================');
  console.log(`📌 Target DB: [${DATABASE_NAME}] | Collection: [${COLLECTION_NAME}]`);
  console.log(`🧠 Embedding Model: [${EMBEDDING_MODEL_NAME}] (outputDimensionality: 768)`);
  if (isDryRun) console.log('🧪 DRY-RUN MODE: Parsing and chunking only, skipping API & DB writes.');
  if (pageLimit) console.log(`⏱️ Page Limit: Maximum ${pageLimit} pages per PDF.`);

  // Validate pre-requisites
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest file not found at: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  if (!isDryRun) {
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI is required in ingestion/.env');
      process.exit(1);
    }
    if (!GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY is required in ingestion/.env');
      process.exit(1);
    }
  }

  // Read Manifest
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  let filesToProcess = manifest.files || [];

  if (fileArg) {
    filesToProcess = filesToProcess.filter((f) => f.file_path.endsWith(fileArg) || f.file_path === fileArg);
    if (filesToProcess.length === 0) {
      console.error(`❌ No manifest entry found matching --file=${fileArg}`);
      process.exit(1);
    }
  }

  console.log(`\n📋 Manifest contains ${filesToProcess.length} file configurations to inspect.\n`);

  // Initialize DB and AI clients if not in dry-run mode
  let mongoClient = null;
  let collection = null;
  let embeddingModel = null;

  if (!isDryRun) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db(DATABASE_NAME);
    collection = db.collection(COLLECTION_NAME);
    console.log(` Connected to MongoDB Atlas: [${DATABASE_NAME}.${COLLECTION_NAME}]\n`);
  }

  let totalChunksIngested = 0;
  let totalFilesProcessed = 0;

  try {
    for (const fileConfig of filesToProcess) {
      const fullPdfPath = path.resolve(RAW_PDFS_DIR, fileConfig.file_path);

      if (!fs.existsSync(fullPdfPath)) {
        console.log(`⏩ Skipping "${fileConfig.file_path}" (Local file not found in raw_pdfs/)`);
        continue;
      }

      console.log('----------------------------------------------------------------');
      console.log(`📄 Processing PDF: ${fileConfig.file_path}`);
      console.log(`   Grade: ${fileConfig.grade_level} | Subject: ${fileConfig.subject}`);
      console.log(`   Chapter ${fileConfig.chapter_number}: "${fileConfig.chapter_title}"`);
      console.log(`   Prefix: ${fileConfig.learning_objective_prefix}`);
      console.log('----------------------------------------------------------------');

      const pages = await extractPagesFromPdf(fullPdfPath, pageLimit);
      console.log(`   Extracted ${pages.length} pages from PDF.`);

      const chunksForFile = [];
      let globalChunkSeq = 1;

      for (const page of pages) {
        const cleanedText = stripHeadersAndFooters(page.text, fileConfig.chapter_title);
        if (cleanedText.split(/\s+/).length < MIN_CHUNK_WORDS) {
          continue; // Skip image-only, cover, or blank pages
        }

        const pageChunks = chunkText(cleanedText, TARGET_CHUNK_WORDS, CHUNK_OVERLAP_WORDS);

        for (let i = 0; i < pageChunks.length; i++) {
          const chunkIndexOnPage = i + 1;
          const chunkId = createDeterministicChunkId(
            fileConfig.source_curriculum,
            fileConfig.subject,
            fileConfig.grade_level,
            fileConfig.chapter_number,
            page.pageNumber,
            chunkIndexOnPage
          );

          const objectiveId = `${fileConfig.learning_objective_prefix}-${String(globalChunkSeq).padStart(2, '0')}`;

          chunksForFile.push({
            chunk_id: chunkId,
            text: pageChunks[i],
            metadata: {
              source_curriculum: fileConfig.source_curriculum || 'NCERT',
              grade_level: fileConfig.grade_level,
              subject: fileConfig.subject,
              chapter_number: fileConfig.chapter_number,
              chapter_title: fileConfig.chapter_title,
              learning_objective_id: objectiveId,
              difficulty_tier: globalChunkSeq <= 3 ? 'foundational' : globalChunkSeq <= 7 ? 'intermediate' : 'advanced',
              page_number: page.pageNumber,
              source_url: fileConfig.source_url
            }
          });

          globalChunkSeq++;
        }
      }

      console.log(`   🧩 Generated ${chunksForFile.length} pedagogical chunks (~300-400 words each).`);

      if (isDryRun) {
        if (chunksForFile.length > 0) {
          console.log(`   🔍 Sample Chunk Preview [${chunksForFile[0].chunk_id}]:`);
          console.log(`      Word Count: ${chunksForFile[0].text.split(/\s+/).length}`);
          console.log(`      Text: "${chunksForFile[0].text.slice(0, 160)}..."`);
        }
        totalFilesProcessed++;
        totalChunksIngested += chunksForFile.length;
        continue;
      }

      // Generate embeddings and bulk upsert
      const bulkOps = [];
      for (let i = 0; i < chunksForFile.length; i++) {
        const chunk = chunksForFile[i];
        process.stdout.write(`   [${i + 1}/${chunksForFile.length}] Embedding ${chunk.chunk_id} (p. ${chunk.metadata.page_number})... `);

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

        bulkOps.push({
          updateOne: {
            filter: { _id: chunk.chunk_id },
            update: { $set: document },
            upsert: true
          }
        });

        // Throttle slightly between chunks to maintain quota headroom
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      if (bulkOps.length > 0) {
        console.log(`   💾 Upserting ${bulkOps.length} chunks into MongoDB Atlas...`);
        const result = await collection.bulkWrite(bulkOps, { ordered: false });
        console.log(`   ✨ Upsert Result: Matched: ${result.matchedCount}, Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`);
        totalChunksIngested += bulkOps.length;
        totalFilesProcessed++;
      }
    }

    console.log('\n================================================================');
    console.log('🎉 INGESTION PIPELINE FINISHED');
    console.log('================================================================');
    console.log(`📁 Total Files Processed: ${totalFilesProcessed}`);
    console.log(`🧩 Total Chunks Ingested: ${totalChunksIngested}`);

    if (!isDryRun && collection) {
      const finalCount = await collection.countDocuments();
      console.log(`📚 Total Documents Now in [${COLLECTION_NAME}]: ${finalCount}`);
    }
  } catch (error) {
    console.error('\n❌ Fatal Ingestion Pipeline Error:', error);
    process.exit(1);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
    }
  }
}

runIngestion();
