/**
 * SyncScholar — Verification Script for MongoDB Atlas Vector Storage
 * 
 * Verifies:
 * 1. Total document count in `curriculum_chunks`.
 * 2. Strict 768-float dimensional integrity of all vector embeddings.
 * 3. Breakdown of chunks by grade, subject, and chapter.
 * 4. Sample chunk metadata structure.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'syncscholar';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'curriculum_chunks';

async function verify() {
  console.log('================================================================');
  console.log('🔍 MongoDB Atlas Vector Storage Verification');
  console.log('================================================================');
  console.log(`📌 Database: [${DATABASE_NAME}] | Collection: [${COLLECTION_NAME}]`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);

  try {
    const totalCount = await collection.countDocuments();
    console.log(`\n📊 Total Documents: ${totalCount}`);

    if (totalCount === 0) {
      console.warn('⚠️ No documents found. Run `npm run seed` or `npm run ingest` first.');
      return;
    }

    // Inspect chunks breakdown by grade and subject
    const breakdown = await collection
      .aggregate([
        {
          $group: {
            _id: {
              grade: '$metadata.grade_level',
              subject: '$metadata.subject',
              chapter: '$metadata.chapter_number',
              chapter_title: '$metadata.chapter_title'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.grade': 1, '_id.chapter': 1 } }
      ])
      .toArray();

    console.log('\n📚 Curriculum Chunks Breakdown:');
    for (const b of breakdown) {
      console.log(`   - Grade ${b._id.grade} ${b._id.subject} (Ch. ${b._id.chapter}: "${b._id.chapter_title}"): ${b.count} chunks`);
    }

    // Vector Dimensionality & Integrity Check
    const cursor = collection.find({}, { projection: { _id: 1, embedding: 1 } });
    let validVectors = 0;
    let invalidVectors = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (Array.isArray(doc.embedding) && doc.embedding.length === 768 && !doc.embedding.some(isNaN)) {
        validVectors++;
      } else {
        invalidVectors++;
        console.error(`❌ Invalid vector detected on doc: ${doc._id} (length: ${doc.embedding?.length})`);
      }
    }

    const validPct = totalCount > 0 ? ((validVectors / totalCount) * 100).toFixed(1) : '0.0';
    console.log(`\n🧠 Vector Dimensionality Verification:`);
    console.log(`   - Valid 768-float vectors: ${validVectors}/${totalCount} (${validPct}%)`);
    console.log(`   - Anomalies / Mismatches: ${invalidVectors}`);

    // Print Sample Document
    const sample = await collection.findOne();
    console.log('\n📄 Sample Stored Document:');
    console.log(JSON.stringify({
      _id: sample?._id,
      chunk_id: sample?.chunk_id,
      text_preview: sample?.text?.slice(0, 140) + '...',
      embedding_length: sample?.embedding?.length,
      embedding_sample: sample?.embedding?.slice(0, 4),
      metadata: sample?.metadata
    }, null, 2));

    if (invalidVectors > 0) {
      console.error(`\n❌ Verification failed: ${invalidVectors} anomalous vector(s) detected.`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ All checks passed! Ready for Atlas Vector Search queries.');
    }
  } finally {
    await client.close();
  }
}

verify();
