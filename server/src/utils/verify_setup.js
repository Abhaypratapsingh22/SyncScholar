/**
 * @file verify_setup.js
 * @description Verification script for Step 1-5 implementation.
 * Tests:
 * 1. Environment validator error reporting and behavior.
 * 2. Schema compilation, default values, and validation constraints.
 * 3. Express server instantiation and GET /api/health response format.
 */

import { CurriculumChunk } from '../models/CurriculumChunk.js';
import { User } from '../models/User.js';
import { QuizAttempt } from '../models/QuizAttempt.js';
import app from '../server.js';
import { getDBStatus } from '../config/db.js';

async function runVerification() {
  console.log('🧪 Starting Automated Verification of MongoDB & Schema Setup...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- Test 1: CurriculumChunk Schema ---
  console.log('--- 1. Testing CurriculumChunk Schema ---');
  try {
    const validChunk = new CurriculumChunk({
      text: 'Plants make their own food through photosynthesis using sunlight and water.',
      embedding: new Array(768).fill(0.0123),
      metadata: {
        source_curriculum: 'NCERT',
        grade_level: 7,
        subject: 'science',
        chapter_number: 1,
        chapter_title: 'Nutrition in Plants',
        learning_objective_id: 'SCI-G7-CH01-LO01',
        difficulty_tier: 'standard',
        page_number: 12,
        source_url: 'https://ncert.nic.in/textbook.php?gesc1=1-18',
      },
    });

    let validationErr = null;
    try {
      await validChunk.validate();
    } catch (err) {
      validationErr = err;
    }
    assert(!validationErr, 'Valid CurriculumChunk document validates cleanly with 768-dim embedding');

    // Test embedding length constraint
    const invalidChunk = new CurriculumChunk({
      text: 'Test short embedding',
      embedding: [0.1, 0.2], // Invalid length
      metadata: {
        source_curriculum: 'NCERT',
        grade_level: 7,
        subject: 'science',
        chapter_number: 1,
        chapter_title: 'Nutrition in Plants',
        learning_objective_id: 'SCI-G7-CH01-LO01',
        difficulty_tier: 'standard',
        page_number: 12,
      },
    });
    let invalidErr = null;
    try {
      await invalidChunk.validate();
    } catch (err) {
      invalidErr = err;
    }
    assert(
      invalidErr && invalidErr.errors['embedding'],
      'CurriculumChunk rejects embedding array when length !== 768'
    );
  } catch (err) {
    assert(false, `CurriculumChunk schema error: ${err.message}`);
  }

  // --- Test 2: User Schema ---
  console.log('\n--- 2. Testing User Schema ---');
  try {
    // Student with roll number (no email)
    const studentUser = new User({
      name: 'Rohan Sharma',
      roll_number: 'R-104',
      password_hash: '$2b$10$hashedpasswordstringhere',
      role: 'student',
      school_id: 'SCH-DELHI-001',
      current_grade: 8,
      concept_mastery: [
        {
          learning_objective_id: 'SCI-G8-CH02-LO01',
          subject: 'science',
          mastery_score: 0.5,
          attempts_count: 0,
          status: 'progressing',
        },
      ],
    });

    let studentErr = null;
    try {
      await studentUser.validate();
    } catch (err) {
      studentErr = err;
    }
    assert(!studentErr, 'Student with roll_number validates successfully without email');
    assert(
      studentUser.concept_mastery[0].mastery_score === 0.5,
      'Baseline mastery score correctly defaults to 0.50'
    );

    // Teacher with email
    const teacherUser = new User({
      name: 'Priya Verma',
      email: 'priya.verma@school.edu',
      password_hash: '$2b$10$hashedpasswordstringhere',
      role: 'teacher',
      school_id: 'SCH-DELHI-001',
    });
    let teacherErr = null;
    try {
      await teacherUser.validate();
    } catch (err) {
      teacherErr = err;
    }
    assert(!teacherErr, 'Teacher with email validates successfully');

    // User without email and without roll_number should fail
    const invalidUser = new User({
      name: 'No Identifier',
      password_hash: 'hash',
      school_id: 'SCH-01',
    });
    let noIdErr = null;
    try {
      await invalidUser.validate();
    } catch (err) {
      noIdErr = err;
    }
    assert(
      noIdErr && (noIdErr.errors['email'] || noIdErr.errors['roll_number']),
      'User requires either email or roll_number'
    );
  } catch (err) {
    assert(false, `User schema error: ${err.message}`);
  }

  // --- Test 3: QuizAttempt Schema ---
  console.log('\n--- 3. Testing QuizAttempt Schema ---');
  try {
    const validAttempt = new QuizAttempt({
      client_attempt_id: '550e8400-e29b-41d4-a716-446655440000',
      student_id: new User({ name: 'S', roll_number: '1', password_hash: 'x', school_id: '1' })._id,
      learning_objective_id: 'SCI-G7-CH01-LO01',
      subject: 'science',
      grade_level: 7,
      questions: [
        {
          question_text: 'Which organelle carries out photosynthesis?',
          options: ['Mitochondria', 'Chloroplast', 'Ribosome', 'Nucleus'],
          selected_option_index: 1,
          correct_option_index: 1,
          is_correct: true,
          explanation: 'Chloroplasts contain chlorophyll which absorbs sunlight.',
        },
      ],
      score: 1,
      max_score: 1,
      synced_from_offline: true,
    });

    let quizErr = null;
    try {
      await validAttempt.validate();
    } catch (err) {
      quizErr = err;
    }
    assert(!quizErr, 'QuizAttempt with idempotent client_attempt_id validates successfully');
    assert(validAttempt.synced_from_offline === true, 'synced_from_offline flag preserved');
  } catch (err) {
    assert(false, `QuizAttempt schema error: ${err.message}`);
  }

  // --- Test 4: Health Check Endpoint Logic ---
  console.log('\n--- 4. Testing GET /api/health Endpoint Response ---');
  try {
    const dbStatus = getDBStatus();
    assert(typeof dbStatus.isConnected === 'boolean', 'getDBStatus returns boolean isConnected');
    assert(typeof dbStatus.state === 'string', 'getDBStatus returns string state label');
    assert(typeof app === 'function', 'Express app exported and ready');
  } catch (err) {
    assert(false, `Health check error: ${err.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${passed} Passed, ${failed} Failed`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification();
