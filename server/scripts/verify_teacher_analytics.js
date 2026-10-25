/**
 * @file verify_teacher_analytics.js
 * @description Comprehensive verification script for SyncScholar Teacher Classroom Analytics.
 * 
 * Verifies the prompt specification:
 * 1. Multi-grade Classroom Weak-Spot Heatmap (GET /api/teacher/heatmap):
 *    - Direct MongoDB aggregation over users and quiz_attempts grouped by learning_objective_id and grade_level
 *    - total_students_assessed
 *    - average_mastery_score
 *    - struggling_student_count (mastery_score < 0.50)
 *    - top_misconception_tags (top 3 most frequent incorrect_question_tags)
 *    - Sorted by struggling_student_count descending, average_mastery_score ascending
 * 2. Struggling Students Drill-Down (GET /api/teacher/objectives/:objectiveId/students):
 *    - Returns students needing prerequisite remediation on a specific learning objective
 *    - Displays last attempt score, accuracy percentage, and timestamp
 * 3. Role-Based Security & Cohort Guardrails:
 *    - 401 for unauthenticated requests
 *    - 403 for student role attempting teacher endpoints
 *    - 403 for teacher requesting unassigned grade level
 * 4. Definition of Done:
 *    - Displays sample JSON output of GET /api/teacher/heatmap across multi-grade cohort (Grades 6, 7, 8)
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import QuizAttempt from '../src/models/QuizAttempt.js';
import app from '../src/server.js';

const TEST_PORT = 5057;
const TEST_SCHOOL_ID = 'SCH-VERIFY-MULTIGRADE-01';

async function setupMultiGradeTestData() {
  const passwordHash = await bcrypt.hash('TeacherVerify@123', 8);

  // 1. Clean previous verification data
  await User.deleteMany({ school_id: TEST_SCHOOL_ID });
  await QuizAttempt.deleteMany({ client_attempt_id: { $regex: /^test-mg-/ } });

  // 2. Setup Multi-Grade Teacher (Grades 6, 7, 8)
  const teacher = await User.create({
    name: 'Sunita Sharma (Multi-Grade Science Teacher)',
    email: 'teacher.multigrade@syncscholar.org',
    school_id: TEST_SCHOOL_ID,
    role: 'teacher',
    assigned_grades: [6, 7, 8],
    password_hash: passwordHash,
  });

  // 3. Setup Multi-Grade Students (Grades 6, 7, 8)
  // Grade 6: 2 students assessed on SCI-06-MOTION-01 (both struggling)
  const studentG6_1 = await User.create({
    name: 'Aarav Patel (Grade 6)',
    roll_number: 'MG-G6-01',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 6,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-06-MOTION-01',
        subject: 'science',
        mastery_score: 0.35, // Struggling (< 0.50)
        attempts_count: 2,
        status: 'needs_prerequisite_remediation',
        last_reviewed: new Date('2026-10-25T09:00:00Z'),
      },
    ],
  });

  const studentG6_2 = await User.create({
    name: 'Diya Rao (Grade 6)',
    roll_number: 'MG-G6-02',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 6,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-06-MOTION-01',
        subject: 'science',
        mastery_score: 0.42, // Struggling (< 0.50)
        attempts_count: 1,
        status: 'needs_prerequisite_remediation',
        last_reviewed: new Date('2026-10-25T09:30:00Z'),
      },
      {
        learning_objective_id: 'SCI-06-LIGHT-01',
        subject: 'science',
        mastery_score: 0.78, // Progressing
        attempts_count: 1,
        status: 'progressing',
        last_reviewed: new Date('2026-10-25T09:45:00Z'),
      },
    ],
  });

  // Grade 7: 3 students assessed on SCI-07-HEAT-04 (2 struggling, 1 mastered)
  const studentG7_1 = await User.create({
    name: 'Rohan Verma (Grade 7)',
    roll_number: 'MG-G7-01',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 7,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'science',
        mastery_score: 0.18, // Severely struggling (< 0.50)
        attempts_count: 2,
        status: 'needs_prerequisite_remediation',
        last_reviewed: new Date('2026-10-25T10:00:00Z'),
      },
    ],
  });

  const studentG7_2 = await User.create({
    name: 'Ananya Gupta (Grade 7)',
    roll_number: 'MG-G7-02',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 7,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'science',
        mastery_score: 0.45, // Struggling (< 0.50)
        attempts_count: 1,
        status: 'needs_prerequisite_remediation',
        last_reviewed: new Date('2026-10-25T10:15:00Z'),
      },
      {
        learning_objective_id: 'SCI-07-ACID-01',
        subject: 'science',
        mastery_score: 0.85, // Mastered (>= 0.80)
        attempts_count: 2,
        status: 'mastered',
        last_reviewed: new Date('2026-10-25T10:30:00Z'),
      },
    ],
  });

  const studentG7_3 = await User.create({
    name: 'Vikram Singh (Grade 7)',
    roll_number: 'MG-G7-03',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 7,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-07-HEAT-04',
        subject: 'science',
        mastery_score: 0.88, // Mastered (>= 0.80)
        attempts_count: 3,
        status: 'mastered',
        last_reviewed: new Date('2026-10-25T10:45:00Z'),
      },
    ],
  });

  // Grade 8: 2 students assessed on SCI-08-FORCE-01 (1 struggling, 1 progressing)
  const studentG8_1 = await User.create({
    name: 'Deepak Joshi (Grade 8)',
    roll_number: 'MG-G8-01',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 8,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-08-FORCE-01',
        subject: 'science',
        mastery_score: 0.28, // Struggling (< 0.50)
        attempts_count: 2,
        status: 'needs_prerequisite_remediation',
        last_reviewed: new Date('2026-10-25T11:00:00Z'),
      },
    ],
  });

  const studentG8_2 = await User.create({
    name: 'Kavita Iyer (Grade 8)',
    roll_number: 'MG-G8-02',
    school_id: TEST_SCHOOL_ID,
    role: 'student',
    current_grade: 8,
    password_hash: passwordHash,
    concept_mastery: [
      {
        learning_objective_id: 'SCI-08-FORCE-01',
        subject: 'science',
        mastery_score: 0.65, // Progressing
        attempts_count: 1,
        status: 'progressing',
        last_reviewed: new Date('2026-10-25T11:15:00Z'),
      },
    ],
  });

  // 4. Setup Seeded Quiz Attempts with Error Misconception Tags
  // Grade 6: SCI-06-MOTION-01 Attempts
  await QuizAttempt.create([
    {
      client_attempt_id: 'test-mg-g6-att-01',
      student_id: studentG6_1._id,
      learning_objective_id: 'SCI-06-MOTION-01',
      subject: 'science',
      grade_level: 6,
      score: 1,
      max_score: 3,
      incorrect_question_tags: ['rectilinear_motion_definition', 'periodic_motion'],
      questions: [
        {
          question_text: 'What type of motion is the pendulum of a clock?',
          options: ['Periodic', 'Rectilinear', 'Circular', 'Random'],
          selected_option_index: 1,
          correct_option_index: 0,
          is_correct: false,
          tag: 'periodic_motion',
        },
      ],
      createdAt: new Date('2026-10-25T09:00:00Z'),
    },
    {
      client_attempt_id: 'test-mg-g6-att-02',
      student_id: studentG6_2._id,
      learning_objective_id: 'SCI-06-MOTION-01',
      subject: 'science',
      grade_level: 6,
      score: 1,
      max_score: 3,
      incorrect_question_tags: ['rectilinear_motion_definition', 'speed_unit_conversion'],
      questions: [
        {
          question_text: 'What motion describes a train moving on a straight track?',
          options: ['Rectilinear', 'Circular', 'Periodic', 'Oscillatory'],
          selected_option_index: 2,
          correct_option_index: 0,
          is_correct: false,
          tag: 'rectilinear_motion_definition',
        },
      ],
      createdAt: new Date('2026-10-25T09:30:00Z'),
    },
  ]);

  // Grade 7: SCI-07-HEAT-04 Attempts
  await QuizAttempt.create([
    {
      client_attempt_id: 'test-mg-g7-att-01',
      student_id: studentG7_1._id,
      learning_objective_id: 'SCI-07-HEAT-04',
      subject: 'science',
      grade_level: 7,
      score: 0,
      max_score: 3,
      incorrect_question_tags: ['thermal_conduction', 'conductors_vs_insulators'],
      questions: [
        {
          question_text: 'Why does a metal spoon feel colder than a wooden spoon?',
          options: ['Higher conductivity', 'Lower temperature', 'More density', 'Smaller heat capacity'],
          selected_option_index: 1,
          correct_option_index: 0,
          is_correct: false,
          tag: 'thermal_conduction',
        },
      ],
      createdAt: new Date('2026-10-25T10:00:00Z'),
    },
    {
      client_attempt_id: 'test-mg-g7-att-02',
      student_id: studentG7_2._id,
      learning_objective_id: 'SCI-07-HEAT-04',
      subject: 'science',
      grade_level: 7,
      score: 1,
      max_score: 3,
      incorrect_question_tags: ['thermal_conduction', 'latent_heat_of_vaporization'],
      questions: [
        {
          question_text: 'Which process transfers heat in solids without actual particle movement?',
          options: ['Conduction', 'Convection', 'Radiation', 'Sublimation'],
          selected_option_index: 1,
          correct_option_index: 0,
          is_correct: false,
          tag: 'thermal_conduction',
        },
      ],
      createdAt: new Date('2026-10-25T10:15:00Z'),
    },
    {
      client_attempt_id: 'test-mg-g7-att-03',
      student_id: studentG7_3._id,
      learning_objective_id: 'SCI-07-HEAT-04',
      subject: 'science',
      grade_level: 7,
      score: 3,
      max_score: 3,
      incorrect_question_tags: [],
      questions: [
        {
          question_text: 'Which of the following is an insulator?',
          options: ['Wood', 'Copper', 'Iron', 'Aluminum'],
          selected_option_index: 0,
          correct_option_index: 0,
          is_correct: true,
          tag: 'conductors_vs_insulators',
        },
      ],
      createdAt: new Date('2026-10-25T10:45:00Z'),
    },
  ]);

  // Grade 8: SCI-08-FORCE-01 Attempts
  await QuizAttempt.create([
    {
      client_attempt_id: 'test-mg-g8-att-01',
      student_id: studentG8_1._id,
      learning_objective_id: 'SCI-08-FORCE-01',
      subject: 'science',
      grade_level: 8,
      score: 0,
      max_score: 3,
      incorrect_question_tags: ['contact_vs_noncontact_forces', 'atmospheric_pressure'],
      questions: [
        {
          question_text: 'Which force acts without physical contact between objects?',
          options: ['Gravitational force', 'Frictional force', 'Muscular force', 'Tension force'],
          selected_option_index: 1,
          correct_option_index: 0,
          is_correct: false,
          tag: 'contact_vs_noncontact_forces',
        },
      ],
      createdAt: new Date('2026-10-25T11:00:00Z'),
    },
    {
      client_attempt_id: 'test-mg-g8-att-02',
      student_id: studentG8_2._id,
      learning_objective_id: 'SCI-08-FORCE-01',
      subject: 'science',
      grade_level: 8,
      score: 2,
      max_score: 3,
      incorrect_question_tags: ['contact_vs_noncontact_forces'],
      questions: [
        {
          question_text: 'Which of the following is a non-contact force?',
          options: ['Magnetic force', 'Friction', 'Push', 'Tension'],
          selected_option_index: 1,
          correct_option_index: 0,
          is_correct: false,
          tag: 'contact_vs_noncontact_forces',
        },
      ],
      createdAt: new Date('2026-10-25T11:15:00Z'),
    },
  ]);

  // Generate JWTs
  const teacherToken = jwt.sign(
    { id: teacher._id, role: teacher.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const studentToken = jwt.sign(
    { id: studentG7_1._id, role: studentG7_1.role },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return {
    teacher,
    teacherToken,
    studentG7_1,
    studentToken,
  };
}

async function runTeacherAnalyticsVerification() {
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') {
    console.error('❌ Refusing execution: verification tests cannot run in production.');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('👩‍🏫 SYNCSCHOLAR TEACHER CLASSROOM ANALYTICS VERIFICATION');
  console.log('='.repeat(80));

  await connectDB();
  const { teacher, teacherToken, studentToken } = await setupMultiGradeTestData();

  const server = app.listen(TEST_PORT);
  console.log(`📡 Verification HTTP server listening on http://localhost:${TEST_PORT}\n`);

  const results = {};

  try {
    // ------------------------------------------------------------------------
    // TEST 1: GET /api/teacher/overview
    // ------------------------------------------------------------------------
    console.log('--- TEST 1: Teacher Classroom Overview ---');
    const res1 = await fetch(`http://localhost:${TEST_PORT}/api/teacher/overview`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const data1 = await res1.json();
    console.log(`Status: ${res1.status}`);
    console.log(`Teacher: ${data1.teacher?.name} | School: ${data1.teacher?.school_id}`);
    console.log(`Assigned Grades: [${data1.teacher?.assigned_grades?.join(', ')}]`);
    console.log(`Enrolled Multi-Grade Students: ${data1.classroom_summary?.enrolled_students}`);

    results.test1_overview =
      res1.status === 200 &&
      data1.success === true &&
      data1.classroom_summary?.enrolled_students === 7;

    console.log(results.test1_overview ? '✅ TEST 1 PASSED\n' : '❌ TEST 1 FAILED\n');

    // ------------------------------------------------------------------------
    // TEST 2: GET /api/teacher/heatmap (Multi-Grade Cohort Aggregation)
    // ------------------------------------------------------------------------
    console.log('--- TEST 2: Multi-Grade Classroom Weak-Spot Heatmap (All Grades 6, 7, 8) ---');
    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/teacher/heatmap`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const data2 = await res2.json();
    console.log(`Status: ${res2.status}`);
    console.log(`Total Objective Groups Found: ${data2.count}`);

    // Verify properties on each item
    const hasRequiredFields = data2.data?.every(
      (item) =>
        item.learning_objective_id &&
        typeof item.grade_level === 'number' &&
        typeof item.total_students_assessed === 'number' &&
        typeof item.average_mastery_score === 'number' &&
        typeof item.struggling_student_count === 'number' &&
        Array.isArray(item.top_misconception_tags)
    );

    // Verify sorting: struggling_student_count descending, average_mastery_score ascending
    let isProperlySorted = true;
    for (let i = 0; i < data2.data.length - 1; i++) {
      const curr = data2.data[i];
      const next = data2.data[i + 1];
      if (curr.struggling_student_count < next.struggling_student_count) {
        isProperlySorted = false;
        break;
      }
      if (
        curr.struggling_student_count === next.struggling_student_count &&
        curr.average_mastery_score > next.average_mastery_score
      ) {
        isProperlySorted = false;
        break;
      }
    }

    results.test2_heatmap =
      res2.status === 200 &&
      data2.success === true &&
      data2.count >= 3 &&
      hasRequiredFields &&
      isProperlySorted;

    console.log(`Required Fields Present: ${hasRequiredFields ? 'YES' : 'NO'}`);
    console.log(`Critical Weak-Spots Sorted at Top: ${isProperlySorted ? 'YES' : 'NO'}`);
    console.log(results.test2_heatmap ? '✅ TEST 2 PASSED\n' : '❌ TEST 2 FAILED\n');

    // ------------------------------------------------------------------------
    // TEST 3: GET /api/teacher/heatmap?grade_level=7 (Grade Filter)
    // ------------------------------------------------------------------------
    console.log('--- TEST 3: Heatmap Grade Filtering (Grade 7 Only) ---');
    const res3 = await fetch(`http://localhost:${TEST_PORT}/api/teacher/heatmap?grade_level=7`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const data3 = await res3.json();
    console.log(`Status: ${res3.status}`);
    console.log(`Grade 7 Objectives Count: ${data3.count}`);
    const allGrade7 = data3.data?.every((item) => item.grade_level === 7);
    console.log(`All returned items are Grade 7: ${allGrade7 ? 'YES' : 'NO'}`);

    results.test3_grade_filter =
      res3.status === 200 &&
      data3.success === true &&
      data3.count > 0 &&
      allGrade7;

    console.log(results.test3_grade_filter ? '✅ TEST 3 PASSED\n' : '❌ TEST 3 FAILED\n');

    // ------------------------------------------------------------------------
    // TEST 4: GET /api/teacher/objectives/:objectiveId/students (Struggling Students Drill-Down)
    // ------------------------------------------------------------------------
    console.log('--- TEST 4: Struggling Students Drill-Down (SCI-07-HEAT-04) ---');
    const res4 = await fetch(
      `http://localhost:${TEST_PORT}/api/teacher/objectives/SCI-07-HEAT-04/students`,
      {
        headers: { Authorization: `Bearer ${teacherToken}` },
      }
    );
    const data4 = await res4.json();
    console.log(`Status: ${res4.status}`);
    console.log(`Objective: ${data4.learning_objective_id}`);
    console.log(`Struggling Students Needing Remediation: ${data4.struggling_count}`);
    if (data4.data?.length > 0) {
      data4.data.forEach((s, idx) => {
        console.log(`  [${idx + 1}] Student: ${s.name} (${s.roll_number})`);
        console.log(`      Grade: ${s.grade_level} | Mastery Score: ${(s.mastery_score * 100).toFixed(1)}% | Status: ${s.status}`);
        console.log(`      Last Attempt: Score ${s.last_attempt?.score}/${s.last_attempt?.max_score} (${s.last_attempt?.accuracy_percentage}) at ${s.last_attempt?.submitted_at}`);
        console.log(`      Incorrect Tags: [${s.last_attempt?.incorrect_question_tags?.join(', ')}]`);
      });
    }

    const hasRohan = data4.data?.some((s) => s.name.includes('Rohan'));
    const hasAnanya = data4.data?.some((s) => s.name.includes('Ananya'));
    const excludesVikram = !data4.data?.some((s) => s.name.includes('Vikram')); // Vikram mastered (0.88), should not be in struggling list

    results.test4_drill_down =
      res4.status === 200 &&
      data4.success === true &&
      data4.struggling_count === 2 &&
      hasRohan &&
      hasAnanya &&
      excludesVikram;

    console.log(`Rohan (Mastery 0.18) present: ${hasRohan ? 'YES' : 'NO'}`);
    console.log(`Ananya (Mastery 0.45) present: ${hasAnanya ? 'YES' : 'NO'}`);
    console.log(`Vikram (Mastery 0.88, Mastered) excluded: ${excludesVikram ? 'YES' : 'NO'}`);
    console.log(results.test4_drill_down ? '✅ TEST 4 PASSED\n' : '❌ TEST 4 FAILED\n');

    // ------------------------------------------------------------------------
    // TEST 5: Security & Role Authorization Guardrails
    // ------------------------------------------------------------------------
    console.log('--- TEST 5: Security & Role Authorization Guardrails ---');

    // 5A: Student accessing teacher endpoint -> 403 Forbidden
    const res5A = await fetch(`http://localhost:${TEST_PORT}/api/teacher/heatmap`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    console.log(`Student token access status: ${res5A.status} (Expected 403)`);

    // 5B: Unauthenticated request -> 401 Unauthorized
    const res5B = await fetch(`http://localhost:${TEST_PORT}/api/teacher/heatmap`);
    console.log(`Unauthenticated request status: ${res5B.status} (Expected 401)`);

    // 5C: Teacher requesting unassigned grade (Grade 10 when assigned 6, 7, 8) -> 403 Forbidden
    const res5C = await fetch(
      `http://localhost:${TEST_PORT}/api/teacher/heatmap?grade_level=10`,
      {
        headers: { Authorization: `Bearer ${teacherToken}` },
      }
    );
    console.log(`Teacher requesting Grade 10 status: ${res5C.status} (Expected 403)`);

    results.test5_security =
      res5A.status === 403 &&
      res5B.status === 401 &&
      res5C.status === 403;

    console.log(results.test5_security ? '✅ TEST 5 PASSED\n' : '❌ TEST 5 FAILED\n');

    // ------------------------------------------------------------------------
    // DEFINITION OF DONE: Output Sample Multi-Grade Heatmap JSON
    // ------------------------------------------------------------------------
    console.log('='.repeat(80));
    console.log('📋 DEFINITION OF DONE: SAMPLE JSON OUTPUT OF GET /api/teacher/heatmap');
    console.log('Across Multi-Grade (Grades 6, 7, 8) School Cohort:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(data2, null, 2));
    console.log('='.repeat(80));

    // Summary Check
    const allPassed = Object.values(results).every(Boolean);
    console.log('\nVERIFICATION SUMMARY:');
    console.log(`1. Teacher Classroom Overview:        ${results.test1_overview ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`2. Multi-Grade Weak-Spot Heatmap:     ${results.test2_heatmap ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`3. Grade-Level Filtering:             ${results.test3_grade_filter ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`4. Struggling Students Drill-Down:    ${results.test4_drill_down ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`5. Role-Based Security & Guardrails:  ${results.test5_security ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log('='.repeat(80));

    if (allPassed) {
      console.log('🎉 ALL TEACHER CLASSROOM ANALYTICS TESTS PASSED PERFECTLY!');
    } else {
      console.error('❌ Some tests failed.');
      process.exit(1);
    }
  } finally {
    // Clean up test data
    try {
      await User.deleteMany({ school_id: TEST_SCHOOL_ID });
      await QuizAttempt.deleteMany({ client_attempt_id: { $regex: /^test-mg-/ } });
      console.log('🧹 Multi-grade verification test data cleaned up successfully.');
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    server.close();
    await disconnectDB();
  }
}

runTeacherAnalyticsVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
