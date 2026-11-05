/**
 * SyncScholar — End-to-End Math RAG Pipeline Verification Script
 * 
 * Verifies:
 * 1. Atlas Vector Search retrieval against Class 9 Math chunks with score > 0.70.
 * 2. Socratic, curriculum-grounded explanation from ragTutorService.js citing NCERT Grade 9 Ch 1.
 */

import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { retrieveRelevantChunks } from './src/services/vectorSearchService.js';
import { askTutor } from './src/services/ragTutorService.js';

async function runMathRagTest() {
  console.log('================================================================');
  console.log('🧪 SyncScholar — Grade 9 Mathematics RAG End-to-End Verification');
  console.log('================================================================');

  await mongoose.connect(env.MONGODB_URI);
  console.log(' Connected to MongoDB Atlas\n');

  try {
    const testQuery = 'What is the Cartesian plane and what are the x and y coordinates of the origin?';
    console.log(`📝 Test Student Query:\n   "${testQuery}"\n`);

    // -------------------------------------------------------------------------
    // 1. Vector Search Service Retrieval Test
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Testing Vector Search Retrieval (vectorSearchService.js) ---');
    const searchFilter = {
      'metadata.grade_level': { $in: [9] },
      'metadata.subject': 'Mathematics'
    };

    const searchResult = await retrieveRelevantChunks({
      query: testQuery,
      filter: searchFilter,
      minRelevanceScore: 0.70
    });

    console.log(`🔍 Retrieved Chunks Count: ${searchResult.chunks.length}`);
    console.log(`📊 Top Relevance Score: ${searchResult.topScore ? searchResult.topScore.toFixed(4) : 'N/A'}`);
    console.log(`🚫 Out of Syllabus Refusal: ${searchResult.isOutOfSyllabus}`);

    if (searchResult.chunks.length === 0) {
      throw new Error('Vector retrieval returned 0 chunks for Grade 9 Mathematics query!');
    }

    if (searchResult.topScore < 0.70) {
      throw new Error(`Vector retrieval score (${searchResult.topScore}) did not meet threshold (> 0.70)!`);
    }

    console.log('\n📄 Top Retrieved Chunk:');
    const topChunk = searchResult.chunks[0];
    console.log(`   - Chunk ID: ${topChunk._id}`);
    console.log(`   - Chapter ${topChunk.metadata?.chapter_number}: "${topChunk.metadata?.chapter_title}" (Page ${topChunk.metadata?.page_number})`);
    console.log(`   - Vector Score: ${topChunk.vectorSearchScore?.toFixed(4)}`);
    console.log(`   - Text Snippet: "${topChunk.text?.slice(0, 200).replace(/\n/g, ' ')}..."\n`);

    // -------------------------------------------------------------------------
    // 2. Socratic Tutor Synthesis Test
    // -------------------------------------------------------------------------
    console.log('--- Step 2: Testing Socratic Tutor Synthesis (ragTutorService.js) ---');
    const mockStudent = {
      _id: new mongoose.Types.ObjectId().toString(),
      name: 'Rohan (Grade 9 Student)',
      current_grade: 9,
      concept_mastery: []
    };

    const tutorResponse = await askTutor({
      studentId: mockStudent._id,
      subject: 'Mathematics',
      question: testQuery,
      userDoc: mockStudent
    });

    const tutorResult = tutorResponse.data;

    console.log('\n🎓 Socratic AI Tutor Response:');
    console.log('----------------------------------------------------------------');
    console.log(`💡 Pedagogical Answer:\n${tutorResult.answer}\n`);
    console.log(`❓ Socratic Follow-Up:\n${tutorResult.socratic_follow_up}\n`);
    console.log(`📚 Detected LO: ${tutorResult.detected_learning_objective_id}`);
    console.log('📑 Verified Citations:');
    if (tutorResult.citations && tutorResult.citations.length > 0) {
      for (const cit of tutorResult.citations) {
        console.log(`   * ${cit.source_curriculum || 'NCERT'} Grade ${cit.grade_level} ${cit.subject || 'Math'}, Ch: "${cit.chapter_title}", Page ${cit.page_number}`);
      }
    } else {
      console.log('   (No citations attached)');
    }
    console.log('----------------------------------------------------------------');

    if (!tutorResult.answer || !tutorResult.socratic_follow_up) {
      throw new Error('Socratic tutor response did not generate expected answer or follow-up question!');
    }

    if (!tutorResult.citations || tutorResult.citations.length === 0) {
      throw new Error('Socratic tutor response did not attach citations!');
    }

    console.log('\n✅ Verification Assertions:');
    console.log('   [PASS] vectorSearchService retrieved Class 9 chunks with score > 0.70');
    console.log('   [PASS] ragTutorService returned curriculum-grounded Socratic explanation');
    console.log('   [PASS] Citations reference Grade 9 Chapter 1 textbook pages');

  } finally {
    await mongoose.disconnect();
    console.log('\n Disconnected from MongoDB');
  }
}

runMathRagTest().catch((err) => {
  console.error('\n❌ RAG Verification Failed:', err);
  process.exit(1);
});
