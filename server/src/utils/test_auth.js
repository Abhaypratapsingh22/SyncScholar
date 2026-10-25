/**
 * @file test_auth.js
 * @description Automated end-to-end verification script for SyncScholar Authentication & RBAC.
 * Tests:
 * 1. Grade 7 Student registration in school 'SCH-DEL-042'
 * 2. Teacher registration in the same school with assigned_grades [6, 7, 8]
 * 3. Student login via roll number
 * 4. Teacher login via email
 * 5. Token verification via GET /api/auth/me
 * 6. Student profile access (GET /api/student/profile)
 * 7. RBAC isolation: Student blocked from teacher endpoint (403)
 * 8. RBAC isolation: Teacher blocked from student profile endpoint (403)
 * 9. Unauthenticated request rejection (401)
 * 10. Automatic cleanup of test users
 */

import http from 'http';
import { validateEnv, env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import app from '../server.js';
import User from '../models/User.js';

// Pre-flight validation
validateEnv();

function request(server, method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const port = address.port;

    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const json = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode, data: json });
          } catch {
            resolve({ status: res.statusCode, raw: rawData });
          }
        });
      }
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runAuthTests() {
  console.log('\n================================================================');
  console.log('🧪 SYNCSCHOLAR AUTHENTICATION & RBAC END-TO-END VERIFICATION');
  console.log('================================================================\n');

  await connectDB();

  // Spin up an ephemeral HTTP server on random free port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const testPort = server.address().port;
  console.log(`📡 Ephemeral test server listening on http://127.0.0.1:${testPort}\n`);

  const schoolId = 'SCH-DEL-042';
  const testStudentRoll = `TEST_STU_${Date.now().toString().slice(-4)}`;
  const testTeacherEmail = `teacher_${Date.now()}@delhi-schools.org`;

  let studentToken = null;
  let teacherToken = null;

  try {
    // ------------------------------------------------------------------------
    // Test 1: Register Grade 7 Student
    // ------------------------------------------------------------------------
    console.log('▶ Test 1: Register Grade 7 Student in school', schoolId);
    const studentRegRes = await request(server, 'POST', '/api/auth/register', {
      name: 'Aarav Sharma',
      role: 'student',
      school_id: schoolId,
      roll_number: testStudentRoll,
      current_grade: 7,
      password: 'SecurePassword123!',
      preferred_language: 'hi',
    });

    console.log(`  Status: ${studentRegRes.status} | Success: ${studentRegRes.data.success}`);
    console.log(`  Message: ${studentRegRes.data.message}`);
    if (studentRegRes.status !== 201 || !studentRegRes.data.token) {
      throw new Error(`Student registration failed: ${JSON.stringify(studentRegRes.data)}`);
    }
    studentToken = studentRegRes.data.token;
    console.log(`  User Grade: ${studentRegRes.data.user.current_grade} | Role: ${studentRegRes.data.user.role}`);
    console.log('  ✅ PASS: Grade 7 Student registered successfully.\n');

    // ------------------------------------------------------------------------
    // Test 2: Register Teacher in same school
    // ------------------------------------------------------------------------
    console.log('▶ Test 2: Register Teacher in school', schoolId);
    const teacherRegRes = await request(server, 'POST', '/api/auth/register', {
      name: 'Pooja Verma',
      role: 'teacher',
      school_id: schoolId,
      email: testTeacherEmail,
      assigned_grades: [6, 7, 8],
      password: 'TeacherSecurePass123!',
    });

    console.log(`  Status: ${teacherRegRes.status} | Success: ${teacherRegRes.data.success}`);
    console.log(`  Message: ${teacherRegRes.data.message}`);
    if (teacherRegRes.status !== 201 || !teacherRegRes.data.token) {
      throw new Error(`Teacher registration failed: ${JSON.stringify(teacherRegRes.data)}`);
    }
    teacherToken = teacherRegRes.data.token;
    console.log(`  Assigned Grades: [${teacherRegRes.data.user.assigned_grades.join(', ')}] | Role: ${teacherRegRes.data.user.role}`);
    console.log('  ✅ PASS: Teacher registered successfully.\n');

    // ------------------------------------------------------------------------
    // Test 3: Student Login via Roll Number
    // ------------------------------------------------------------------------
    console.log('▶ Test 3: Student Login via Roll Number + School ID');
    const studentLoginRes = await request(server, 'POST', '/api/auth/login', {
      identifier: testStudentRoll,
      school_id: schoolId,
      password: 'SecurePassword123!',
    });

    console.log(`  Status: ${studentLoginRes.status} | Success: ${studentLoginRes.data.success}`);
    if (studentLoginRes.status !== 200 || !studentLoginRes.data.token) {
      throw new Error(`Student login failed: ${JSON.stringify(studentLoginRes.data)}`);
    }
    console.log('  ✅ PASS: Student authenticated via roll number.\n');

    // ------------------------------------------------------------------------
    // Test 4: Teacher Login via Email
    // ------------------------------------------------------------------------
    console.log('▶ Test 4: Teacher Login via Email');
    const teacherLoginRes = await request(server, 'POST', '/api/auth/login', {
      identifier: testTeacherEmail,
      password: 'TeacherSecurePass123!',
    });

    console.log(`  Status: ${teacherLoginRes.status} | Success: ${teacherLoginRes.data.success}`);
    if (teacherLoginRes.status !== 200 || !teacherLoginRes.data.token) {
      throw new Error(`Teacher login failed: ${JSON.stringify(teacherLoginRes.data)}`);
    }
    console.log('  ✅ PASS: Teacher authenticated via email.\n');

    // ------------------------------------------------------------------------
    // Test 5: Verify GET /api/auth/me for Student
    // ------------------------------------------------------------------------
    console.log('▶ Test 5: Verify Session Identity (GET /api/auth/me)');
    const meRes = await request(server, 'GET', '/api/auth/me', null, studentToken);
    console.log(`  Status: ${meRes.status} | User: ${meRes.data.user?.name} (${meRes.data.user?.role})`);
    if (meRes.status !== 200 || meRes.data.user?.role !== 'student') {
      throw new Error(`GET /api/auth/me verification failed: ${JSON.stringify(meRes.data)}`);
    }
    console.log('  ✅ PASS: GET /api/auth/me returned verified student profile.\n');

    // ------------------------------------------------------------------------
    // Test 6: Student Access to Student Profile (GET /api/student/profile)
    // ------------------------------------------------------------------------
    console.log('▶ Test 6: Access GET /api/student/profile with Student Token');
    const profileRes = await request(server, 'GET', '/api/student/profile', null, studentToken);
    console.log(`  Status: ${profileRes.status} | Grade: ${profileRes.data.profile?.current_grade}`);
    console.log(`  Mastery Summary:`, JSON.stringify(profileRes.data.profile?.mastery_summary));
    if (profileRes.status !== 200 || profileRes.data.profile?.current_grade !== 7) {
      throw new Error(`Student profile failed: ${JSON.stringify(profileRes.data)}`);
    }
    console.log('  ✅ PASS: Student profile endpoint returns compact, verified grade & mastery schema.\n');

    // ------------------------------------------------------------------------
    // Test 7: RBAC - Student Blocked from Teacher Overview (Expect 403)
    // ------------------------------------------------------------------------
    console.log('▶ Test 7: RBAC Isolation - Student accessing Teacher Route (GET /api/teacher/overview)');
    const studentBlockedRes = await request(server, 'GET', '/api/teacher/overview', null, studentToken);
    console.log(`  Status: ${studentBlockedRes.status} (Expected 403) | Message: ${studentBlockedRes.data.message}`);
    if (studentBlockedRes.status !== 403) {
      throw new Error(`RBAC failure: Student was NOT blocked from teacher route! Got status ${studentBlockedRes.status}`);
    }
    console.log('  ✅ PASS: Student access to teacher route blocked with 403 Forbidden.\n');

    // ------------------------------------------------------------------------
    // Test 8: RBAC - Teacher Accessing Teacher Overview (Expect 200)
    // ------------------------------------------------------------------------
    console.log('▶ Test 8: Teacher accessing Teacher Route (GET /api/teacher/overview)');
    const teacherOverviewRes = await request(server, 'GET', '/api/teacher/overview', null, teacherToken);
    console.log(`  Status: ${teacherOverviewRes.status} | Enrolled students in school: ${teacherOverviewRes.data.classroom_summary?.enrolled_students}`);
    if (teacherOverviewRes.status !== 200) {
      throw new Error(`Teacher overview failed: ${JSON.stringify(teacherOverviewRes.data)}`);
    }
    console.log('  ✅ PASS: Teacher authorized successfully for teacher overview.\n');

    // ------------------------------------------------------------------------
    // Test 9: RBAC - Teacher Blocked from Student Profile (Expect 403)
    // ------------------------------------------------------------------------
    console.log('▶ Test 9: RBAC Isolation - Teacher accessing Student Route (GET /api/student/profile)');
    const teacherBlockedRes = await request(server, 'GET', '/api/student/profile', null, teacherToken);
    console.log(`  Status: ${teacherBlockedRes.status} (Expected 403) | Message: ${teacherBlockedRes.data.message}`);
    if (teacherBlockedRes.status !== 403) {
      throw new Error(`RBAC failure: Teacher was NOT blocked from student route! Got status ${teacherBlockedRes.status}`);
    }
    console.log('  ✅ PASS: Teacher access to student learning profile blocked with 403 Forbidden.\n');

    // ------------------------------------------------------------------------
    // Test 10: Reject Unauthenticated Request (Expect 401)
    // ------------------------------------------------------------------------
    console.log('▶ Test 10: Unauthenticated Request to Protected Route (Expect 401)');
    const unauthRes = await request(server, 'GET', '/api/student/profile', null, null);
    console.log(`  Status: ${unauthRes.status} (Expected 401) | Message: ${unauthRes.data.message}`);
    if (unauthRes.status !== 401) {
      throw new Error(`Auth failure: Unauthenticated request was NOT rejected with 401! Got ${unauthRes.status}`);
    }
    console.log('  ✅ PASS: Missing token cleanly rejected with 401 Unauthorized.\n');

    console.log('🎉 ALL 10 AUTHENTICATION & RBAC TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup created test records
    console.log('🧹 Cleaning up test users from MongoDB Atlas...');
    await User.deleteMany({
      school_id: schoolId,
      $or: [{ roll_number: testStudentRoll }, { email: testTeacherEmail }],
    });
    console.log('✨ Cleanup complete.');

    server.close();
    await disconnectDB();
  }
}

runAuthTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
