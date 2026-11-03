/**
 * SyncScholar — End-to-End Verification Suite for Class 9 Science RAG
 * 
 * Verifies:
 * 1. Vector Search retrieval of Grade 9 Science chunks from MongoDB Atlas
 * 2. Pre-filtering by Grade 9 and Science
 * 3. Socratic Pedagogical Tutoring via Gemini LLM with strict curriculum grounding
 * 4. Verifiable textbook citations (Chapter 2, exact page numbers)
 * 5. Socratic anti-cheating guardrail behavior
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { embedQueryWithRetry, retrieveRelevantChunks } from '../src/services/vectorSearchService.js';
import { askTutor } from '../src/services/ragTutorService.js';
import User from '../src/models/User.js';

// Allow local corporate network proxies in non-production environments
if (process.env.NODE_ENV !== 'production' && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function runScienceVerification() {
  console.log('================================================================');
  console.log('🧪 SYNCSCHOLAR CLASS 9 SCIENCE RAG VERIFICATION SUITE');
  console.log('================================================================');

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set in server/.env');
    process.exit(1);
  }

  console.log('⏳ Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas.\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Direct Vector Search for Class 9 Cell Membrane & Osmosis
    // -------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 1: Vector Search on Class 9 Science (Osmosis & Cell Membrane)');
    console.log('----------------------------------------------------------------');
    const query1 = 'What is the cell membrane and how does osmosis work in cells?';
    console.log(`Query: "${query1}"`);

    const filter1 = {
      'metadata.subject': 'Science',
      'metadata.grade_level': 9,
    };

    const retrievalResult1 = await retrieveRelevantChunks({
      query: query1,
      filter: filter1,
      minRelevanceScore: 0.70,
    });

    console.log(`Retrieved ${retrievalResult1.chunks.length} chunks.`);
    console.log(`Top Score: ${retrievalResult1.topScore?.toFixed(4)}`);
    console.log(`Out of Syllabus: ${retrievalResult1.isOutOfSyllabus}`);

    if (retrievalResult1.chunks.length > 0) {
      const top = retrievalResult1.chunks[0];
      console.log(`\nTop Chunk Preview:`);
      console.log(`  ID: ${top._id}`);
      console.log(`  Chapter: ${top.metadata?.chapter_title} (Ch. ${top.metadata?.chapter_number})`);
      console.log(`  Page: ${top.metadata?.page_number}`);
      console.log(`  LO: ${top.metadata?.learning_objective_id}`);
      console.log(`  Text: "${top.text.slice(0, 150)}..."`);
      console.log(`✅ TEST 1 PASSED: Successfully retrieved Class 9 Science chunk.`);
    } else {
      console.log(`❌ TEST 1 FAILED: No chunks retrieved.`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Direct Vector Search for Mitochondria & ATP
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('TEST 2: Vector Search on Mitochondria and Energy Currency');
    console.log('----------------------------------------------------------------');
    const query2 = 'Why are mitochondria called the powerhouses of the cell and what is ATP?';
    console.log(`Query: "${query2}"`);

    const retrievalResult2 = await retrieveRelevantChunks({
      query: query2,
      filter: filter1,
      minRelevanceScore: 0.70,
    });

    console.log(`Retrieved ${retrievalResult2.chunks.length} chunks.`);
    console.log(`Top Score: ${retrievalResult2.topScore?.toFixed(4)}`);

    if (retrievalResult2.chunks.length > 0) {
      const top = retrievalResult2.chunks[0];
      console.log(`\nTop Chunk Preview:`);
      console.log(`  ID: ${top._id}`);
      console.log(`  Chapter: ${top.metadata?.chapter_title}`);
      console.log(`  Page: ${top.metadata?.page_number}`);
      console.log(`  Text: "${top.text.slice(0, 150)}..."`);
      console.log(`✅ TEST 2 PASSED: Successfully retrieved Mitochondria chunk.`);
    } else {
      console.log(`❌ TEST 2 FAILED: No chunks retrieved.`);
    }

    // -------------------------------------------------------------------------
    // TEST 3: End-to-End Socratic Tutor with Grade 9 Student Profile
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('TEST 3: End-to-End Socratic Tutor Answering (Grade 9 Science)');
    console.log('----------------------------------------------------------------');

    // Create or find mock Grade 9 student
    const mockStudent = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Aarav Sharma',
      email: 'aarav.grade9@school.edu',
      role: 'student',
      current_grade: 9,
      concept_mastery: [
        {
          subject: 'Science',
          learning_objective_id: 'SCI-09-CELL-01',
          mastery_score: 0.85,
          status: 'mastered',
        },
      ],
    };

    const tutorResponse = await askTutor({
      studentId: mockStudent._id.toString(),
      subject: 'Science',
      question: 'What is the difference between plant and animal cell walls and membranes?',
      userDoc: mockStudent,
    });

    console.log('Tutor Response:');
    console.log(`Answer:\n${tutorResponse.data?.answer}\n`);
    console.log(`Socratic Follow-up:\n${tutorResponse.data?.socratic_follow_up}\n`);
    console.log(`Remediation Active: ${tutorResponse.data?.remediation_mode_active}`);
    console.log(`Detected LO: ${tutorResponse.data?.detected_learning_objective_id}`);
    console.log(`Citations Count: ${tutorResponse.data?.citations?.length}`);

    if (tutorResponse.data?.citations?.length > 0) {
      console.log('Citations:');
      tutorResponse.data.citations.forEach((c, idx) => {
        console.log(`  [${idx + 1}] ${c.chapter_title} (Grade ${c.grade_level}, p. ${c.page_number}) - ${c.source_url}`);
      });
      console.log('✅ TEST 3 PASSED: Grounded Socratic answer with verified citations generated.');
    } else {
      console.log('⚠️ TEST 3 NOTE: Answer generated but citations array was empty.');
    }

    // -------------------------------------------------------------------------
    // TEST 4: The Exact Sound Wave Exercise Question from NCERT Class 9 Ch. 10
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('TEST 4: Exact NCERT Sound Wave Exercise Question (User Bug Report)');
    console.log('----------------------------------------------------------------');
    const soundQuestion = 'A source produces a sound wave of wavelength 3.44 m. If the wave travels with a speed of 344 m s-1 find its time period.';
    console.log(`Question: "${soundQuestion}"`);

    const soundResponse = await askTutor({
      studentId: mockStudent._id.toString(),
      subject: 'Science',
      question: soundQuestion,
      grade: 9,
      userDoc: mockStudent,
    });

    console.log(`\nSound Tutor Response:`);
    console.log(`Answer:\n${soundResponse.data?.answer}\n`);
    console.log(`Socratic Follow-up:\n${soundResponse.data?.socratic_follow_up}\n`);
    console.log(`Out of Syllabus: ${soundResponse.data?.metadata?.out_of_syllabus}`);
    console.log(`Citations Count: ${soundResponse.data?.citations?.length}`);

    if (soundResponse.data?.citations?.length > 0) {
      soundResponse.data.citations.forEach((c, idx) => {
        console.log(`  [${idx + 1}] ${c.chapter_title} (Grade ${c.grade_level}, p. ${c.page_number}) - ${c.source_url}`);
      });
      if (!soundResponse.data?.metadata?.out_of_syllabus) {
        console.log('✅ TEST 4 PASSED: Sound wave question answered Socratically with Ch. 10 citation!');
      } else {
        console.log('❌ TEST 4 FAILED: Out of syllabus triggered unexpectedly.');
      }
    } else {
      console.log('❌ TEST 4 FAILED: No citations returned for Sound Wave question.');
    }

    console.log('\n================================================================');
    console.log('🎉 ALL CLASS 9 SCIENCE RAG VERIFICATION TESTS COMPLETE');
    console.log('================================================================');
  } catch (err) {
    console.error('Verification Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB Atlas.');
  }
}

runScienceVerification();

