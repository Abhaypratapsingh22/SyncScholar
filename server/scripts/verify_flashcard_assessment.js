/**
 * @file verify_flashcard_assessment.js
 * @description Comprehensive verification script for SyncScholar Formative Assessment Engine.
 * 
 * Verifies the complete prompt specification:
 * 1. Structured Assessment Generator (POST /api/assessments/generate):
 *    - 3 Diagnostic MCQs with question, 4 options, correct_index, concept_tag, textbook_explanation
 *    - 3 Study Flashcards with front, back, learning_objective_id (for offline PWA caching)
 * 2. Idempotent Quiz Submission & EMA Mastery Loop (POST /api/assessments/submit):
 *    - Idempotency guard via client_attempt_id (prevents duplicate scoring on rural network retry)
 *    - EMA mastery recalculation with alpha = 0.4
 *    - Status transition below 0.50 -> 'needs_prerequisite_remediation'
 *    - Misconception tags logged
 * 3. Definition of Done Walkthrough:
 *    - 2 failed quiz attempts drop EMA mastery from 0.50 -> 0.30 -> 0.18 (< 0.50)
 *    - Automatic flipping of status to 'needs_prerequisite_remediation'
 *    - Verification that subsequent RAG query activates prerequisite fallback
 * 4. Resilient Batch Sync (POST /api/assessments/sync-batch):
 *    - Partial failure resilience and atomic execution
 * 5. Teacher Heatmap Analytics (GET /api/teacher/heatmap):
 *    - Misconception tag aggregation by learning objective
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import QuizAttempt from '../src/models/QuizAttempt.js';
import app from '../src/server.js';

const TEST_PORT = 5056;

async function setupTestData() {
  const passwordHash = await bcrypt.hash('TestStudent@123', 8);

  // Clean up any previous test attempts
  await QuizAttempt.deleteMany({
    client_attempt_id: {
      $in: [
        'test-attempt-uuid-001',
        'test-attempt-uuid-002',
        'test-attempt-uuid-batch-01',
        'test-attempt-uuid-batch-02',
      ],
    },
  });

  // Setup Test Student with default baseline mastery (0.50)
  const student = await User.findOneAndUpdate(
    { roll_number: 'DEMO-ASSESS-01' },
    {
      name: 'Rohan Verma (Test Student)',
      roll_number: 'DEMO-ASSESS-01',
      school_id: 'SCH-DEMO-ASSESS',
      role: 'student',
      current_grade: 7,
      password_hash: passwordHash,
      preferred_language: 'en',
      concept_mastery: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'science',
          mastery_score: 0.5, // Baseline 50%
          attempts_count: 0,
          status: 'progressing',
          last_reviewed: new Date(),
        },
      ],
    },
    { upsert: true, new: true }
  );

  // Setup Test Teacher
  const teacher = await User.findOneAndUpdate(
    { email: 'teacher.heatmap@syncscholar.org' },
    {
      name: 'Meera Deshmukh (Science Teacher)',
      email: 'teacher.heatmap@syncscholar.org',
      school_id: 'SCH-DEMO-ASSESS',
      role: 'teacher',
      assigned_grades: [7],
      password_hash: passwordHash,
    },
    { upsert: true, new: true }
  );

  const studentToken = jwt.sign(
    { id: student._id, role: student.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const teacherToken = jwt.sign(
    { id: teacher._id, role: teacher.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return { student, studentToken, teacher, teacherToken };
}

async function runVerification() {
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') {
    console.error('❌ Refusing database access: verification tests cannot run in production environment.');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('🧪 SYNCSCHOLAR FORMATIVE ASSESSMENT & FLASHCARD ENGINE VERIFICATION');
  console.log('='.repeat(80));

  await connectDB();
  const { student, studentToken, teacher, teacherToken } = await setupTestData();

  // Start Express verification test server
  const server = app.listen(TEST_PORT);
  console.log(`📡 Verification HTTP server listening on http://localhost:${TEST_PORT}\n`);

  const results = {
    test1_generate_assessment: false,
    test2_first_failed_quiz: false,
    test3_idempotent_retry: false,
    test4_second_failed_quiz: false,
    test5_rag_remediation_active: false,
    test6_resilient_batch_sync: false,
    test7_teacher_heatmap: false,
  };

  let generatedMcqs = [];
  let generatedFlashcards = [];

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Structured Assessment Generator (POST /api/assessments/generate)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 1: Structured Assessment Generator (POST /api/assessments/generate)');
    console.log('Expected: 3 Diagnostic MCQs with citations & tags + 3 Study Flashcards');
    console.log('----------------------------------------------------------------');

    const res1 = await fetch(`http://localhost:${TEST_PORT}/api/assessments/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        subject: 'Science',
        learning_objective_id: 'SCI-07-HEAT-04',
        grade_level: 7,
      }),
    });

    const data1 = await res1.json();
    console.log(`HTTP Status: ${res1.status}`);

    const payload1 = data1.data || {};
    generatedMcqs = payload1.diagnostic_mcqs || [];
    generatedFlashcards = payload1.study_flashcards || [];

    console.log(`Diagnostic MCQs Count: ${generatedMcqs.length} (Expected: 3)`);
    console.log(`Study Flashcards Count: ${generatedFlashcards.length} (Expected: 3)`);

    if (generatedMcqs.length > 0) {
      console.log('\nSample Generated MCQ [1]:');
      console.log(`  Question:    ${generatedMcqs[0].question}`);
      console.log(`  Options (4): ${JSON.stringify(generatedMcqs[0].options)}`);
      console.log(`  Correct Idx: ${generatedMcqs[0].correct_index} ("${generatedMcqs[0].options[generatedMcqs[0].correct_index]}")`);
      console.log(`  Concept Tag: ${generatedMcqs[0].concept_tag}`);
      console.log(`  Citation:    ${generatedMcqs[0].textbook_explanation}`);
    }

    if (generatedFlashcards.length > 0) {
      console.log('\nSample Generated Flashcard [1]:');
      console.log(`  Front: ${generatedFlashcards[0].front}`);
      console.log(`  Back:  ${generatedFlashcards[0].back}`);
      console.log(`  LO ID: ${generatedFlashcards[0].learning_objective_id}`);
    }

    const mcqsValid =
      generatedMcqs.length === 3 &&
      generatedMcqs.every(
        (m) =>
          typeof m.question === 'string' &&
          m.options?.length === 4 &&
          typeof m.correct_index === 'number' &&
          typeof m.concept_tag === 'string' &&
          typeof m.textbook_explanation === 'string'
      );

    const cardsValid =
      generatedFlashcards.length === 3 &&
      generatedFlashcards.every(
        (f) =>
          typeof f.front === 'string' &&
          typeof f.back === 'string' &&
          typeof f.learning_objective_id === 'string'
      );

    if (res1.status === 200 && mcqsValid && cardsValid) {
      console.log('\n✅ TEST 1 PASSED: Structured MCQs and Flashcards generated successfully.\n');
      results.test1_generate_assessment = true;
    } else {
      console.error('\n❌ TEST 1 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 2: Failed Quiz Attempt 1 (POST /api/assessments/submit)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 2: Failed Quiz Attempt 1 (Score 0/3)');
    console.log('Expected: Baseline 0.50 -> new EMA = (0.4 * 0.0) + (0.6 * 0.50) = 0.30');
    console.log('Status: Transitions to "needs_prerequisite_remediation" (< 0.50)');
    console.log('----------------------------------------------------------------');

    // Prepare 3 questions with intentionally incorrect answers
    const mcqsToUse =
      generatedMcqs.length === 3
        ? generatedMcqs
        : [
            {
              question: 'Which method of heat transfer occurs through direct contact of molecules without bulk motion?',
              options: ['Radiation', 'Conduction', 'Convection', 'Insulation'],
              correct_index: 1,
              concept_tag: 'Conduction',
              textbook_explanation: 'Heat transfer through solids via molecular collisions is conduction.',
            },
            {
              question: 'In which medium can convection occur?',
              options: ['Solids only', 'Fluids (liquids and gases)', 'Vacuum only', 'Metals only'],
              correct_index: 1,
              concept_tag: 'Convection',
              textbook_explanation: 'Convection requires moving fluid matter.',
            },
            {
              question: 'How does heat energy travel from the Sun to the Earth across empty space?',
              options: ['Conduction', 'Convection', 'Thermal Radiation', 'Advection'],
              correct_index: 2,
              concept_tag: 'Thermal Radiation',
              textbook_explanation: 'Radiation transmits thermal energy via electromagnetic waves through a vacuum.',
            },
          ];

    const failedQuestionsAttempt1 = mcqsToUse.map((q) => {
      // Pick an incorrect option
      const wrongIndex = (q.correct_index + 1) % 4;
      return {
        question_text: q.question,
        options: q.options,
        selected_option_index: wrongIndex,
        correct_option_index: q.correct_index,
        concept_tag: q.concept_tag,
        explanation: q.textbook_explanation,
      };
    });

    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/assessments/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        client_attempt_id: 'test-attempt-uuid-001',
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'Science',
        grade_level: 7,
        questions: failedQuestionsAttempt1,
      }),
    });

    const data2 = await res2.json();
    console.log(`HTTP Status: ${res2.status}`);
    console.log('Idempotent Flag:', data2.idempotent);
    console.log('Score:', `${data2.data?.attempt?.score} / ${data2.data?.attempt?.max_score}`);
    console.log('Previous Mastery:', data2.data?.ema_update?.previous_mastery);
    console.log('New Mastery (EMA):', data2.data?.ema_update?.new_mastery);
    console.log('Mastery Status:', data2.data?.ema_update?.status);
    console.log('Incorrect Misconception Tags:', data2.data?.incorrect_question_tags);

    const test2Pass =
      res2.status === 201 &&
      data2.data?.attempt?.score === 0 &&
      data2.data?.ema_update?.new_mastery === 0.3 &&
      data2.data?.ema_update?.status === 'needs_prerequisite_remediation' &&
      data2.data?.incorrect_question_tags?.length > 0;

    if (test2Pass) {
      console.log('✅ TEST 2 PASSED: Attempt 1 dropped EMA to 0.30 and flipped status to needs_prerequisite_remediation.\n');
      results.test2_first_failed_quiz = true;
    } else {
      console.error('❌ TEST 2 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 3: Idempotent Submission Guard (Retry same UUID over flaky network)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 3: Idempotent Submission Guard (Client Retries Same UUID)');
    console.log('Expected: Return existing attempt, idempotent: true, mastery NOT recalculated');
    console.log('----------------------------------------------------------------');

    const res3 = await fetch(`http://localhost:${TEST_PORT}/api/assessments/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        client_attempt_id: 'test-attempt-uuid-001', // SAME UUID
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'Science',
        grade_level: 7,
        questions: failedQuestionsAttempt1,
      }),
    });

    const data3 = await res3.json();
    console.log(`HTTP Status: ${res3.status}`);
    console.log('Idempotent Response Flag:', data3.idempotent);
    console.log('Message:', data3.message);
    console.log('Recorded Attempt ID:', data3.data?.attempt?._id);

    // Verify student mastery did not mutate further
    const studentCheckAfterRetry = await User.findById(student._id).lean();
    const masteryAfterRetry = studentCheckAfterRetry.concept_mastery.find(
      (m) => m.learning_objective_id === 'SCI-07-HEAT-04'
    );
    console.log('Mastery Score after Retry:', masteryAfterRetry?.mastery_score);

    const test3Pass =
      res3.status === 200 &&
      data3.idempotent === true &&
      masteryAfterRetry?.mastery_score === 0.3;

    if (test3Pass) {
      console.log('✅ TEST 3 PASSED: Idempotency guard safely protected against duplicate scoring.\n');
      results.test3_idempotent_retry = true;
    } else {
      console.error('❌ TEST 3 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 4: Failed Quiz Attempt 2 (Definition of Done Part 1)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 4: Failed Quiz Attempt 2 (Second Consecutive Failure)');
    console.log('Expected: 0.30 -> new EMA = (0.4 * 0.0) + (0.6 * 0.30) = 0.18');
    console.log('Status: Firmly locked in "needs_prerequisite_remediation"');
    console.log('----------------------------------------------------------------');

    const res4 = await fetch(`http://localhost:${TEST_PORT}/api/assessments/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        client_attempt_id: 'test-attempt-uuid-002', // NEW UUID
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'Science',
        grade_level: 7,
        questions: failedQuestionsAttempt1,
      }),
    });

    const data4 = await res4.json();
    console.log(`HTTP Status: ${res4.status}`);
    console.log('Previous Mastery:', data4.data?.ema_update?.previous_mastery);
    console.log('New Mastery (EMA):', data4.data?.ema_update?.new_mastery);
    console.log('Mastery Status:', data4.data?.ema_update?.status);
    console.log('Total Attempts Recorded:', data4.data?.concept_mastery?.attempts_count);

    const test4Pass =
      res4.status === 201 &&
      data4.data?.ema_update?.new_mastery === 0.18 &&
      data4.data?.ema_update?.status === 'needs_prerequisite_remediation' &&
      data4.data?.concept_mastery?.attempts_count === 2;

    if (test4Pass) {
      console.log('✅ TEST 4 PASSED: Second attempt dropped EMA to 0.18.\n');
      results.test4_second_failed_quiz = true;
    } else {
      console.error('❌ TEST 4 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 5: Definition of Done Walkthrough — Subsequent RAG Doubt Query
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 5: Subsequent RAG Doubt Query (Definition of Done Verification)');
    console.log('Expected: Student mastery (0.18 < 0.50) automatically flips next');
    console.log('          RAG doubt query to remediation_mode_active = true,');
    console.log('          expanding retrieval to Grade 6 foundational chunks.');
    console.log('----------------------------------------------------------------');

    const res5 = await fetch(`http://localhost:${TEST_PORT}/api/tutor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        question: 'Why do metals conduct heat so quickly while other things do not?',
        subject: 'Science',
        learningObjectiveId: 'SCI-07-HEAT-04',
      }),
    });

    const data5 = await res5.json();
    console.log(`HTTP Status: ${res5.status}`);
    console.log('Remediation Mode Active:', data5.data?.remediation_mode_active);
    console.log('Student Mastery Detected:', data5.data?.metadata?.mastery_score);
    console.log('Retrieved Grades in Chunks:', data5.data?.metadata?.retrieved_grades);
    console.log('Filter Reason:', data5.data?.metadata?.filter_reason);

    const test5Pass =
      res5.status === 200 &&
      data5.data?.remediation_mode_active === true &&
      data5.data?.metadata?.remediation_triggered === true &&
      data5.data?.metadata?.mastery_score === 0.18 &&
      data5.data?.metadata?.retrieved_grades?.includes(6);

    if (test5Pass) {
      console.log('✅ TEST 5 PASSED: 2 failed quiz attempts successfully triggered adaptive prerequisite fallback on RAG!\n');
      results.test5_rag_remediation_active = true;
    } else {
      console.error('❌ TEST 5 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 6: Resilient Batch Sync (POST /api/assessments/sync-batch)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 6: Resilient Batch Sync (Client Reconnects with Offline Queue)');
    console.log('Expected: Atomically sync multiple attempts, tolerate malformed items');
    console.log('----------------------------------------------------------------');

    // Batch contains:
    // 1. One attempt that was already synced (test-attempt-uuid-001) -> 'already_synced'
    // 2. One new attempt with 100% score (3/3 correct) -> 'synced' (EMA should rise)
    // 3. One malformed item missing required fields -> 'failed' (handled gracefully)
    const perfectQuestions = mcqsToUse.map((q) => ({
      question_text: q.question,
      options: q.options,
      selected_option_index: q.correct_index, // ALL CORRECT
      correct_option_index: q.correct_index,
      concept_tag: q.concept_tag,
      explanation: q.textbook_explanation,
    }));

    const batchPayload = {
      attempts: [
        {
          client_attempt_id: 'test-attempt-uuid-001', // Duplicate
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'Science',
          grade_level: 7,
          questions: failedQuestionsAttempt1,
        },
        {
          client_attempt_id: 'test-attempt-uuid-batch-01', // New Perfect Attempt
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'Science',
          grade_level: 7,
          questions: perfectQuestions,
        },
        {
          client_attempt_id: 'malformed-item-003', // Missing questions
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'Science',
          questions: [], // Invalid!
        },
      ],
    };

    const res6 = await fetch(`http://localhost:${TEST_PORT}/api/assessments/sync-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify(batchPayload),
    });

    const data6 = await res6.json();
    console.log(`HTTP Status: ${res6.status}`);
    console.log('Batch Report Summary:', data6.message);
    console.log(`  Total In Batch:        ${data6.data?.total}`);
    console.log(`  Successfully Synced:   ${data6.data?.synced_count}`);
    console.log(`  Already Synced:        ${data6.data?.already_synced_count}`);
    console.log(`  Failed (Resilient):    ${data6.data?.failed_count}`);
    console.log('Per-attempt Results:', data6.data?.results);

    // Verify student mastery rose after the perfect attempt:
    // previous: 0.18, accuracy: 1.0 -> (0.4 * 1.0) + (0.6 * 0.18) = 0.40 + 0.108 = 0.508
    const updatedStudentDoc = await User.findById(student._id).lean();
    const updatedMastery = updatedStudentDoc.concept_mastery.find(
      (m) => m.learning_objective_id === 'SCI-07-HEAT-04'
    );
    console.log('Student Mastery after Perfect Attempt Sync:', updatedMastery?.mastery_score);
    console.log('Updated Status:', updatedMastery?.status);

    const test6Pass =
      res6.status === 200 &&
      data6.data?.synced_count === 1 &&
      data6.data?.already_synced_count === 1 &&
      data6.data?.failed_count === 1 &&
      updatedMastery?.mastery_score === 0.508 &&
      updatedMastery?.status === 'progressing';

    if (test6Pass) {
      console.log('✅ TEST 6 PASSED: Batch sync was resilient to partial failures and updated EMA accurately.\n');
      results.test6_resilient_batch_sync = true;
    } else {
      console.error('❌ TEST 6 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 7: Teacher Classroom Weak-Spot Heatmap (GET /api/teacher/heatmap)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 7: Teacher Classroom Weak-Spot Heatmap (GET /api/teacher/heatmap)');
    console.log('Expected: Aggregated error tags and misconception analytics for blackboard review');
    console.log('----------------------------------------------------------------');

    const res7 = await fetch(`http://localhost:${TEST_PORT}/api/teacher/heatmap?subject=science`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
      },
    });

    const data7 = await res7.json();
    console.log(`HTTP Status: ${res7.status}`);
    console.log('Heatmap Objectives Count:', data7.count);
    if (data7.data?.length > 0) {
      const topObjective = data7.data[0];
      console.log(`\nWeakest Learning Objective: ${topObjective.learning_objective_id}`);
      console.log(`  Total Class Attempts:     ${topObjective.total_attempts}`);
      console.log(`  Average Accuracy:         ${topObjective.accuracy_percentage}`);
      console.log(`  Pedagogical Directive:    ${topObjective.recommendation}`);
      console.log(`  Top Student Misconceptions:`);
      topObjective.top_misconceptions.forEach((m) => {
        console.log(`    - [Tag: "${m.tag}"] occurred in ${m.count} failed questions`);
      });
    }

    const test7Pass =
      res7.status === 200 &&
      Array.isArray(data7.data) &&
      data7.data.length > 0 &&
      data7.data.some((item) => item.learning_objective_id === 'SCI-07-HEAT-04');

    if (test7Pass) {
      console.log('\n✅ TEST 7 PASSED: Teacher Weak-Spot Heatmap aggregated student misconceptions successfully.\n');
      results.test7_teacher_heatmap = true;
    } else {
      console.error('\n❌ TEST 7 FAILED');
    }

    // Final Summary
    console.log('='.repeat(80));
    console.log('VERIFICATION SUMMARY:');
    console.log(`1. Structured Assessment Generator:             ${results.test1_generate_assessment ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`2. Failed Quiz Attempt 1 (EMA 0.50 -> 0.30):    ${results.test2_first_failed_quiz ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`3. Idempotent Retry Protection:                 ${results.test3_idempotent_retry ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`4. Failed Quiz Attempt 2 (EMA 0.30 -> 0.18):    ${results.test4_second_failed_quiz ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`5. Definition of Done (RAG Prerequisite Active): ${results.test5_rag_remediation_active ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`6. Resilient Batch Sync (Partial Failure Safe):  ${results.test6_resilient_batch_sync ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`7. Teacher Weak-Spot Heatmap Analytics:         ${results.test7_teacher_heatmap ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log('='.repeat(80));

    const allPassed = Object.values(results).every(Boolean);
    if (allPassed) {
      console.log('\n🎉 ALL 7 FORMATIVE ASSESSMENT & FLASHCARD TESTS PASSED PERFECTLY!');
    } else {
      console.error('\n⚠️ Some verification checks failed.');
      process.exit(1);
    }
  } finally {
    try {
      await User.deleteMany({
        $or: [
          { roll_number: 'DEMO-ASSESS-01' },
          { email: 'teacher.heatmap@syncscholar.org' },
        ],
      });
      await QuizAttempt.deleteMany({
        client_attempt_id: {
          $in: [
            'test-attempt-uuid-001',
            'test-attempt-uuid-002',
            'test-attempt-uuid-batch-01',
            'test-attempt-uuid-batch-02',
          ],
        },
      });
    } catch (cleanupErr) {
      console.warn('⚠️ Cleanup error during teardown:', cleanupErr.message);
    }
    server.close();
    await disconnectDB();
  }
}

runVerification().catch((err) => {
  console.error('Unhandled verification error:', err);
  process.exitCode = 1;
});
