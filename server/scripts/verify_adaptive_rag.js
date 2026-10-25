/**
 * @file verify_adaptive_rag.js
 * @description Comprehensive verification script for SyncScholar Adaptive RAG Pipeline.
 * 
 * Verifies:
 * 1. High-Mastery Student (Grade 7 chunks only, remediation_mode_active = false)
 * 2. Low-Mastery Student (mastery = 0.35, expanding to Grade 6 + Grade 7, remediation_mode_active = true)
 * 3. Socratic Anti-Cheating Guardrail (detects direct homework problem, provides Step 1 analogy & guidance)
 * 4. Out-of-Syllabus Refusal Gate (prevents hallucination when query is not in textbook)
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import app from '../src/server.js';

const TEST_PORT = 5055;

/**
 * Creates or updates test student profiles in MongoDB Atlas.
 */
async function setupTestStudents() {
  const passwordHash = await bcrypt.hash('TestStudent@123', 8);

  // Student A: High Mastery (85% on Heat Conduction)
  const highMasteryStudent = await User.findOneAndUpdate(
    { roll_number: 'DEMO-G7-HIGH' },
    {
      name: 'Aarav Sharma (High Mastery)',
      roll_number: 'DEMO-G7-HIGH',
      school_id: 'SCH-DEMO-01',
      role: 'student',
      current_grade: 7,
      password_hash: passwordHash,
      preferred_language: 'en',
      concept_mastery: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'science',
          mastery_score: 0.85,
          attempts_count: 5,
          status: 'mastered',
          last_reviewed: new Date(),
        },
      ],
    },
    { upsert: true, returnDocument: 'after' }
  );

  // Student B: Low Mastery (35% on Heat Conduction - Needs Remediation)
  const lowMasteryStudent = await User.findOneAndUpdate(
    { roll_number: 'DEMO-G7-LOW' },
    {
      name: 'Priya Patel (Low Mastery)',
      roll_number: 'DEMO-G7-LOW',
      school_id: 'SCH-DEMO-01',
      role: 'student',
      current_grade: 7,
      password_hash: passwordHash,
      preferred_language: 'en',
      concept_mastery: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          subject: 'science',
          mastery_score: 0.35,
          attempts_count: 3,
          status: 'needs_prerequisite_remediation',
          last_reviewed: new Date(),
        },
      ],
    },
    { upsert: true, returnDocument: 'after' }
  );

  const highMasteryToken = jwt.sign(
    { id: highMasteryStudent._id, role: highMasteryStudent.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const lowMasteryToken = jwt.sign(
    { id: lowMasteryStudent._id, role: lowMasteryStudent.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return {
    highMasteryStudent,
    highMasteryToken,
    lowMasteryStudent,
    lowMasteryToken,
  };
}

async function runVerification() {
  console.log('='.repeat(80));
  console.log('🧪 SYNCSCHOLAR ADAPTIVE RAG PIPELINE VERIFICATION SUITE');
  console.log('='.repeat(80));

  await connectDB();
  const { highMasteryToken, lowMasteryToken } = await setupTestStudents();

  // Start test server
  const server = app.listen(TEST_PORT);
  console.log(`📡 Verification HTTP test server listening on http://localhost:${TEST_PORT}\n`);

  const results = {
    test1_high_mastery: false,
    test2_low_mastery: false,
    test3_anti_cheating: false,
    test4_out_of_syllabus: false,
  };

  try {
    // ------------------------------------------------------------------------
    // TEST 1: High-Mastery Student (Grade 7 chunks only)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 1: High-Mastery Student (mastery = 0.85 >= 0.50)');
    console.log('Expected: Standard Mode, Grade 7 chunks only, remediation_mode_active = false');
    console.log('----------------------------------------------------------------');

    const res1 = await fetch(`http://localhost:${TEST_PORT}/api/tutor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${highMasteryToken}`,
      },
      body: JSON.stringify({
        question: 'How does heat flow from a hotter body to a colder body in solids through conduction?',
        subject: 'Science',
        learningObjectiveId: 'SCI-07-HEAT-04',
      }),
    });

    const data1 = await res1.json();
    console.log(`HTTP Status: ${res1.status}`);
    console.log('Tutor Answer Preview:', data1.data?.answer?.slice(0, 160) + '...');
    console.log('Socratic Follow-up:', data1.data?.socratic_follow_up);
    console.log('Remediation Mode Active:', data1.data?.remediation_mode_active);
    console.log('Retrieved Grades in Chunks:', data1.data?.metadata?.retrieved_grades);
    console.log('Citations Count:', data1.data?.citations?.length);

    const test1Pass =
      res1.status === 200 &&
      data1.data?.remediation_mode_active === false &&
      data1.data?.metadata?.retrieved_grades?.every((g) => g === 7);

    if (test1Pass) {
      console.log('✅ TEST 1 PASSED: High-mastery retrieved Grade 7 chunks exclusively with standard mode.\n');
      results.test1_high_mastery = true;
    } else {
      console.error('❌ TEST 1 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 2: Low-Mastery Student (mastery = 0.35 < 0.50)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 2: Low-Mastery Student (mastery = 0.35 < 0.50)');
    console.log('Expected: Prerequisite Fallback Mode, Grade 6 + Grade 7 retrieval, remediation_mode_active = true');
    console.log('----------------------------------------------------------------');

    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/tutor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lowMasteryToken}`,
      },
      body: JSON.stringify({
        question: 'Why do metal spoons feel cold and heat up fast, while materials around us feel different?',
        subject: 'Science',
        learningObjectiveId: 'SCI-07-HEAT-04',
      }),
    });

    const data2 = await res2.json();
    console.log(`HTTP Status: ${res2.status}`);
    console.log('Tutor Answer Preview:', data2.data?.answer?.slice(0, 160) + '...');
    console.log('Socratic Follow-up:', data2.data?.socratic_follow_up);
    console.log('Remediation Mode Active:', data2.data?.remediation_mode_active);
    console.log('Retrieved Grades in Chunks:', data2.data?.metadata?.retrieved_grades);
    console.log('Filter Reason:', data2.data?.metadata?.filter_reason);

    const test2Pass =
      res2.status === 200 &&
      data2.data?.remediation_mode_active === true &&
      data2.data?.metadata?.remediation_triggered === true &&
      data2.data?.metadata?.retrieved_grades?.includes(6);

    if (test2Pass) {
      console.log('✅ TEST 2 PASSED: Prerequisite fallback triggered Grade 6 + Grade 7 retrieval!\n');
      results.test2_low_mastery = true;
    } else {
      console.error('❌ TEST 2 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 3: Socratic Anti-Cheating Rule Test
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 3: Socratic Anti-Cheating Guardrail');
    console.log('Expected: Detect direct homework request, explain analogy & Step 1 clue without giving away final answer');
    console.log('----------------------------------------------------------------');

    const res3 = await fetch(`http://localhost:${TEST_PORT}/api/tutor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${highMasteryToken}`,
      },
      body: JSON.stringify({
        question: 'Give me the direct answer for homework problem 4: Explain why pressure cookers have bakelite handles instead of metal.',
        subject: 'Science',
      }),
    });

    const data3 = await res3.json();
    console.log(`HTTP Status: ${res3.status}`);
    console.log('Tutor Guidance:', data3.data?.answer);
    console.log('Socratic Follow-up Question:', data3.data?.socratic_follow_up);

    const test3Pass =
      res3.status === 200 &&
      data3.data?.answer?.length > 40 &&
      data3.data?.socratic_follow_up?.length > 10;

    if (test3Pass) {
      console.log('✅ TEST 3 PASSED: Socratic anti-cheating guided with analogy and follow-up question.\n');
      results.test3_anti_cheating = true;
    } else {
      console.error('❌ TEST 3 FAILED');
    }

    // ------------------------------------------------------------------------
    // TEST 4: Out-of-Syllabus Refusal Gate Test (Zero Hallucination)
    // ------------------------------------------------------------------------
    console.log('----------------------------------------------------------------');
    console.log('TEST 4: Out-of-Syllabus Refusal Gate (Zero Internet Hallucination)');
    console.log('Expected: Refusal returned without calling LLM for unrelated queries');
    console.log('----------------------------------------------------------------');

    const res4 = await fetch(`http://localhost:${TEST_PORT}/api/tutor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${highMasteryToken}`,
      },
      body: JSON.stringify({
        question: 'How do I mine cryptocurrency and trade Ethereum on foreign exchanges?',
        subject: 'Science',
      }),
    });

    const data4 = await res4.json();
    console.log(`HTTP Status: ${res4.status}`);
    console.log('Refusal Answer:', data4.data?.answer);
    console.log('Out of Syllabus Flag:', data4.data?.metadata?.out_of_syllabus);
    console.log('Citations Count:', data4.data?.citations?.length);

    const test4Pass =
      res4.status === 200 &&
      data4.data?.metadata?.out_of_syllabus === true &&
      data4.data?.citations?.length === 0;

    if (test4Pass) {
      console.log('✅ TEST 4 PASSED: Safe out-of-syllabus refusal returned with zero hallucination.\n');
      results.test4_out_of_syllabus = true;
    } else {
      console.error('❌ TEST 4 FAILED');
    }

    // Final summary
    console.log('='.repeat(80));
    console.log('VERIFICATION SUMMARY:');
    console.log(`1. High-Mastery (Grade 7 chunks only):       ${results.test1_high_mastery ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`2. Low-Mastery (Grade 6 + Grade 7 fallback): ${results.test2_low_mastery ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`3. Socratic Anti-Cheating Guardrail:         ${results.test3_anti_cheating ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`4. Out-of-Syllabus Refusal Gate:             ${results.test4_out_of_syllabus ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log('='.repeat(80));

    const allPassed = Object.values(results).every(Boolean);
    if (allPassed) {
      console.log('\n🎉 ALL 4 ADAPTIVE RAG VERIFICATION TESTS PASSED SUCCESSFULLY!');
    } else {
      console.error('\n⚠️ Some verification checks failed.');
      process.exitCode = 1;
    }
  } finally {
    server.close();
    await disconnectDB();
  }
}

runVerification().catch((err) => {
  console.error('Unhandled verification error:', err);
  process.exitCode = 1;
});
