/**
 * SyncScholar — Verification Test Suite for Failure Report Fixes (BUG SS-001 through SS-011)
 * 
 * Tests:
 * 1. SS-001: Worked numerical calculations (Car travels 120m in 10s -> 12 m/s).
 * 2. SS-002: Deductive kinematic application (Train accelerating at 0.2 m/s² for 5 min).
 * 3. SS-003: Casual colloquial phrasing ("yo bro why does ice float on water man").
 * 4. SS-004: Multi-turn conversational memory ("Explain its formula" -> acceleration).
 * 5. SS-005: Collegiate out-of-syllabus gating (Quantum entanglement communication).
 * 6. SS-006: Classic NCERT topics (Evaporation cooling, Gravitation weightlessness, Mole concept).
 * 7. SS-007: Citation relevance check (No irrelevant citations on refusals).
 * 8. SS-008: Dynamic fallback check (Grade 9 student gets Grade 9 curriculum fallback).
 * 9. SS-009: Prerequisite remediation retrieval (Mastery < 0.50 retrieves Grade 8 chunks).
 * 10. SS-010: Chemical formula recall (H2O, CO2, NaCl, Ca(OH)2).
 */

import dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if custom DNS cannot be configured
}
import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { askTutor } from './src/services/ragTutorService.js';
import { retrieveRelevantChunks, cleanSearchQuery } from './src/services/vectorSearchService.js';
import { buildAdaptiveFilter } from './src/services/adaptiveFilterService.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 SyncScholar — Failure Report Bug Fixes Verification Suite');
  console.log('================================================================\n');

  await mongoose.connect(env.MONGODB_URI);
  console.log(' Connected to MongoDB Atlas\n');

  let passed = 0;
  let failed = 0;

  function report(testName, isSuccess, details = '') {
    if (isSuccess) {
      console.log(`✅ PASS: ${testName}`);
      if (details) console.log(`   ${details}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      if (details) console.error(`   ${details}`);
      failed++;
    }
    console.log('----------------------------------------------------------------');
  }

  const mockGrade9Student = {
    _id: new mongoose.Types.ObjectId().toString(),
    name: 'Aarav (Grade 9)',
    current_grade: 9,
    concept_mastery: []
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1 (BUG SS-003 & cleanSearchQuery): Colloquial Query Normalization & Retrieval
    // -------------------------------------------------------------------------
    console.log('Running Test 1: Colloquial Slang Query (BUG SS-003)...');
    const slangQuery = 'yo bro why does ice float on water man';
    const cleaned = cleanSearchQuery(slangQuery);
    const filterG9 = { 'metadata.subject': 'Science', 'metadata.grade_level': 9 };
    const slangRetrieval = await retrieveRelevantChunks({ query: slangQuery, filter: filterG9 });

    const test1Pass =
      cleaned.toLowerCase().includes('why does ice float on water') &&
      !slangRetrieval.isOutOfSyllabus &&
      slangRetrieval.chunks.length > 0 &&
      slangRetrieval.topScore >= 0.72;

    report(
      'BUG SS-003: Colloquial phrasing retrieved without false out-of-syllabus refusal',
      test1Pass,
      `Cleaned: "${cleaned}" | Top Score: ${slangRetrieval.topScore} | Chunks: ${slangRetrieval.chunks.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 2 (BUG SS-009): Prerequisite Remediation Mode (Grade 8 Chunks in Atlas)
    // -------------------------------------------------------------------------
    console.log('Running Test 2: Prerequisite Remediation Retrieval (BUG SS-009)...');
    const strugglingStudent = {
      _id: new mongoose.Types.ObjectId().toString(),
      name: 'Priya (Grade 9 Struggling)',
      current_grade: 9,
      concept_mastery: [
        {
          learning_objective_id: 'SCI-09-MOTI-01',
          subject: 'Science',
          mastery_score: 0.35 // Below 0.50 threshold
        }
      ]
    };

    const filterContext = await buildAdaptiveFilter({
      studentId: strugglingStudent._id,
      subject: 'Science',
      userDoc: strugglingStudent,
      learningObjectiveId: 'SCI-09-MOTI-01'
    });

    const remediationRetrieval = await retrieveRelevantChunks({
      query: 'What is a force and how does push or pull change state of motion?',
      filter: filterContext.filter
    });

    const retrievedGrades = [...new Set(remediationRetrieval.chunks.map((c) => c.metadata?.grade_level))];
    const test2Pass =
      filterContext.remediationTriggered === true &&
      retrievedGrades.includes(8);

    report(
      'BUG SS-009: Prerequisite remediation mode successfully retrieves Grade 8 chunks',
      test2Pass,
      `Remediation Triggered: ${filterContext.remediationTriggered} | Grades Retrieved: [${retrievedGrades.join(', ')}] | Chunks: ${remediationRetrieval.chunks.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 3 (BUG SS-001): Worked Numerical Problem (Speed = Distance / Time)
    // -------------------------------------------------------------------------
    console.log('Running Test 3: Numerical Calculation (BUG SS-001)...');
    const numQ1 = 'A car travels 120 metres in 10 seconds. Calculate its speed.';
    const res1 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: numQ1,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer1 = res1.data.answer;
    const test3Pass =
      answer1.includes('12') &&
      (answer1.includes('m/s') || answer1.includes('metre per second')) &&
      !res1.data.metadata.out_of_syllabus;

    report(
      'BUG SS-001: Direct numerical problem calculated with final answer (12 m/s)',
      test3Pass,
      `Calculated Answer Snippet:\n   "${answer1.slice(0, 240).replace(/\n/g, ' ')}..."\n   Follow-up: "${res1.data.socratic_follow_up}"`
    );

    // -------------------------------------------------------------------------
    // TEST 4 (BUG SS-002): Multi-step Kinematics Numerical Application
    // -------------------------------------------------------------------------
    console.log('Running Test 4: Kinematics Numerical Application (BUG SS-002)...');
    const numQ2 = 'A train starts from a railway station and moves with a uniform acceleration of 0.2 m/s² for 5 minutes. Find its speed in km/h and distance in km.';
    const res2 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: numQ2,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer2 = res2.data.answer;
    const has216 = answer2.includes('216');
    const has9km = /\b(?:9(?:\.0)?\s*km|9[,.]?000\s*m)\b/i.test(answer2);
    const test4Pass =
      !answer2.includes('My approved textbook passages do not cover this specific detail') &&
      has216 &&
      has9km &&
      !res2.data.metadata.out_of_syllabus;

    report(
      'BUG SS-002: Zero-hallucination loosened for deductive physics problem',
      test4Pass,
      `Calculated Answer Snippet:\n   "${answer2.slice(0, 240).replace(/\n/g, ' ')}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 5 (BUG SS-004): Conversational Memory & Pronoun Follow-Up Turn
    // -------------------------------------------------------------------------
    console.log('Running Test 5: Multi-turn Conversation Follow-Up (BUG SS-004)...');
    const history = [
      { role: 'student', content: 'What is acceleration in Class 9 physics?' },
      { role: 'tutor', content: 'Acceleration is defined as the rate of change of velocity of an object per unit time.' }
    ];

    const followUpQ = 'Explain its formula.';
    const res5 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: followUpQ,
      userDoc: mockGrade9Student,
      grade: 9,
      conversationHistory: history
    });

    const answer5 = res5.data.answer;
    const test5Pass =
      !res5.data.metadata.out_of_syllabus &&
      (answer5.toLowerCase().includes('acceleration') || answer5.toLowerCase().includes('velocity') || answer5.includes('(v - u)'));

    report(
      'BUG SS-004: Anaphoric follow-up ("Explain its formula") resolved to acceleration',
      test5Pass,
      `Tutor Response Snippet:\n   "${answer5.slice(0, 240).replace(/\n/g, ' ')}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 6 (BUG SS-006): Classic NCERT Topic: Evaporation Cooling
    // -------------------------------------------------------------------------
    console.log('Running Test 6: Evaporation Causes Cooling (BUG SS-006)...');
    const evapQ = 'Why does evaporation cause cooling?';
    const res6 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: evapQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer6 = res6.data.answer;
    const test6Pass =
      !answer6.includes('do not cover this specific detail') &&
      (answer6.toLowerCase().includes('surroundings') || answer6.toLowerCase().includes('latent heat') || answer6.toLowerCase().includes('absorb'));

    report(
      'BUG SS-006: Classic NCERT evaporation cooling explained and grounded',
      test6Pass,
      `Tutor Response Snippet:\n   "${answer6.slice(0, 240).replace(/\n/g, ' ')}..."\n   Citations: ${res6.data.citations?.map((c) => c.chapter_title).join(', ')}`
    );

    // -------------------------------------------------------------------------
    // TEST 7 (BUG SS-006 & SS-007): Factors Affecting Evaporation & Citation Check
    // -------------------------------------------------------------------------
    console.log('Running Test 7: Wet clothes on windy day citation alignment (BUG SS-007)...');
    const windQ = 'Why do wet clothes dry faster on a windy day?';
    const res7 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: windQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer7 = res7.data.answer;
    const citChapters7 = res7.data.citations?.map((c) => c.chapter_title) || [];
    const test7Pass =
      !answer7.includes('do not cover this specific detail') &&
      (answer7.toLowerCase().includes('wind') || answer7.toLowerCase().includes('water vapor') || answer7.toLowerCase().includes('evaporat')) &&
      !citChapters7.some((ch) => ch.includes('Earth as a System')); // Should NOT cite Ch 13 valley breeze!

    report(
      'BUG SS-007: Citation correctly cites evaporation rather than Earth atmospheric wind',
      test7Pass,
      `Tutor Citations: [${citChapters7.join(', ')}]`
    );

    // -------------------------------------------------------------------------
    // TEST 8 (BUG SS-006): Gravitation & Orbital Weightlessness
    // -------------------------------------------------------------------------
    console.log('Running Test 8: Orbital Weightlessness of Astronauts (BUG SS-006)...');
    const gravQ = "Why do astronauts appear weightless in space even though Earth's gravity still acts on them?";
    const res8 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: gravQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer8 = res8.data.answer;
    const test8Pass =
      !answer8.includes('do not cover this specific detail') &&
      (answer8.toLowerCase().includes('free fall') || answer8.toLowerCase().includes('orbit') || answer8.toLowerCase().includes('reaction force'));

    report(
      'BUG SS-006: Astronaut orbital weightlessness explained via continuous free fall',
      test8Pass,
      `Tutor Response Snippet:\n   "${answer8.slice(0, 240).replace(/\n/g, ' ')}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 9 (BUG SS-006): Mole Concept Calculation
    // -------------------------------------------------------------------------
    console.log('Running Test 9: Mole Concept Calculation (BUG SS-006)...');
    const moleQ = 'How many moles are present in 52 g of Helium (He)? (Atomic mass of He = 4 u)';
    const res9 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: moleQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer9 = res9.data.answer;
    const test9Pass =
      !answer9.includes('do not cover this specific detail') &&
      answer9.includes('13');

    report(
      'BUG SS-006: Mole concept calculation solved accurately (52 / 4 = 13 moles)',
      test9Pass,
      `Tutor Response Snippet:\n   "${answer9.slice(0, 240).replace(/\n/g, ' ')}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 10 (BUG SS-010): Chemical Formulas Recall
    // -------------------------------------------------------------------------
    console.log('Running Test 10: Chemical Formulas Inquiry (BUG SS-010)...');
    const chemQ = 'Write the chemical formula for water, carbon dioxide, sodium chloride, and calcium hydroxide.';
    const res10 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: chemQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer10 = res10.data.answer;
    const test10Pass =
      (answer10.includes('H₂O') || answer10.includes('H2O')) &&
      (answer10.includes('CO₂') || answer10.includes('CO2')) &&
      answer10.includes('NaCl') &&
      (answer10.includes('Ca(OH)₂') || answer10.includes('Ca(OH)2'));

    report(
      'BUG SS-010: Standard chemical formulas recalled and rendered with subscripts',
      test10Pass,
      `Formulas Rendered:\n   "${answer10.slice(0, 240).replace(/\n/g, ' ')}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 11 (BUG SS-005): Collegiate Out-of-Syllabus Refusal with Empty Citations
    // -------------------------------------------------------------------------
    console.log('Running Test 11: Collegiate Out-of-Syllabus Refusal (BUG SS-005)...');
    const collegiateQ = 'Does quantum entanglement allow faster-than-light communication across biological cell membranes?';
    const res11 = await askTutor({
      studentId: mockGrade9Student._id,
      subject: 'Science',
      question: collegiateQ,
      userDoc: mockGrade9Student,
      grade: 9
    });

    const answer11 = res11.data.answer;
    const cit11 = res11.data.citations || [];
    const test11Pass =
      (answer11.toLowerCase().includes('outside') || answer11.toLowerCase().includes('quantum entanglement') || answer11.includes('do not cover')) &&
      cit11.length === 0; // Must NOT attach irrelevant lung alveoli citations!

    report(
      'BUG SS-005: Collegiate query refused politely without irrelevant biology citations',
      test11Pass,
      `Tutor Response Snippet:\n   "${answer11.slice(0, 200).replace(/\n/g, ' ')}..."\n   Citations count: ${cit11.length}`
    );

    console.log('\n================================================================');
    console.log(`📊 FINAL TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test execution error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTestSuite();

