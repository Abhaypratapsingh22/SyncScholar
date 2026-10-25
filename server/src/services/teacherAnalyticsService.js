/**
 * @file teacherAnalyticsService.js
 * @description Teacher classroom weak-spot heatmap and student remediation analytics service.
 * Executes MongoDB aggregation pipelines directly in the database engine to summarize
 * multi-grade classroom performance without loading raw student documents into Node.js memory.
 */

import User from '../models/User.js';

/**
 * Builds and executes the MongoDB Aggregation Pipeline for the Classroom Weak-Spot Heatmap.
 * Groups by `learning_objective_id` and `grade_level` to compute:
 * - total_students_assessed
 * - average_mastery_score
 * - struggling_student_count (mastery_score < 0.50)
 * - top_misconception_tags (top 3 most frequent incorrect_question_tags from quiz_attempts)
 * 
 * Results are sorted with most critical weak spots at the top:
 * `struggling_student_count` descending, `average_mastery_score` ascending.
 *
 * @param {object} params
 * @param {string} params.schoolId - Teacher's school ID
 * @param {number[]} [params.assignedGrades] - Grades assigned to the teacher
 * @param {number} [params.gradeLevel] - Optional specific grade level query
 * @param {string} [params.subject] - Optional subject filter (e.g., 'science')
 * @returns {Promise<Array<object>>} Aggregated heatmap items
 */
export async function getClassroomWeakSpotHeatmap({
  schoolId,
  assignedGrades = [],
  gradeLevel = null,
  subject = null,
}) {
  // 1. Build student match query
  const studentMatch = {
    school_id: schoolId,
    role: 'student',
    'concept_mastery.0': { $exists: true },
  };

  if (gradeLevel !== null && gradeLevel !== undefined) {
    studentMatch.current_grade = Number(gradeLevel);
  } else if (Array.isArray(assignedGrades) && assignedGrades.length > 0) {
    studentMatch.current_grade = { $in: assignedGrades };
  }

  // 2. Build concept mastery filter
  const masteryMatch = {};
  if (subject && typeof subject === 'string') {
    masteryMatch['concept_mastery.subject'] = subject.toLowerCase().trim();
  }

  // 3. Assemble MongoDB Aggregation Pipeline
  const pipeline = [
    // Stage 1: Filter students strictly to this school cohort and assigned/requested grades
    { $match: studentMatch },

    // Stage 2: Unwind student concept mastery array to analyze individual objectives
    { $unwind: '$concept_mastery' },

    // Stage 3: Apply subject filter on unwound concept mastery if provided
    ...(Object.keys(masteryMatch).length > 0 ? [{ $match: masteryMatch }] : []),

    // Stage 4: Group by learning_objective_id and student's current grade
    {
      $group: {
        _id: {
          learning_objective_id: '$concept_mastery.learning_objective_id',
          grade_level: '$current_grade',
        },
        subject: { $first: '$concept_mastery.subject' },
        total_students_assessed: { $sum: 1 },
        average_mastery_score: { $avg: '$concept_mastery.mastery_score' },
        struggling_student_count: {
          $sum: {
            $cond: [{ $lt: ['$concept_mastery.mastery_score', 0.50] }, 1, 0],
          },
        },
        student_ids: { $addToSet: '$_id' },
      },
    },

    // Stage 5: Lookup quiz attempts directly inside MongoDB to aggregate misconception tags
    {
      $lookup: {
        from: 'quiz_attempts',
        localField: 'student_ids',
        foreignField: 'student_id',
        let: {
          loId: '$_id.learning_objective_id',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ['$learning_objective_id', '$$loId'],
              },
            },
          },
          {
            $facet: {
              stats: [
                {
                  $group: {
                    _id: null,
                    total_attempts: { $sum: 1 },
                    total_score: { $sum: '$score' },
                    total_max_score: { $sum: '$max_score' },
                  },
                },
              ],
              misconceptions: [
                { $unwind: '$incorrect_question_tags' },
                {
                  $match: {
                    incorrect_question_tags: { $nin: [null, ''] },
                  },
                },
                {
                  $group: {
                    _id: '$incorrect_question_tags',
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 3 },
                {
                  $project: {
                    _id: 0,
                    tag: '$_id',
                    count: 1,
                  },
                },
              ],
            },
          },
        ],
        as: 'attempt_metrics',
      },
    },

    // Stage 6: Project clean, standardized schema with teacher metrics
    {
      $project: {
        _id: 0,
        learning_objective_id: '$_id.learning_objective_id',
        grade_level: '$_id.grade_level',
        subject: '$subject',
        total_students_assessed: '$total_students_assessed',
        average_mastery_score: { $round: ['$average_mastery_score', 4] },
        struggling_student_count: '$struggling_student_count',
        struggling_percentage: {
          $cond: [
            { $gt: ['$total_students_assessed', 0] },
            {
              $round: [
                {
                  $multiply: [
                    { $divide: ['$struggling_student_count', '$total_students_assessed'] },
                    100,
                  ],
                },
                1,
              ],
            },
            0,
          ],
        },
        top_misconception_tags: {
          $let: {
            vars: {
              firstMetrics: { $arrayElemAt: ['$attempt_metrics', 0] },
            },
            in: {
              $map: {
                input: { $ifNull: ['$$firstMetrics.misconceptions', []] },
                as: 'm',
                in: '$$m.tag',
              },
            },
          },
        },
        top_misconceptions: {
          $let: {
            vars: {
              firstMetrics: { $arrayElemAt: ['$attempt_metrics', 0] },
            },
            in: { $ifNull: ['$$firstMetrics.misconceptions', []] },
          },
        },
        total_attempts: {
          $let: {
            vars: {
              firstMetrics: { $arrayElemAt: ['$attempt_metrics', 0] },
              firstStat: {
                $arrayElemAt: [
                  {
                    $ifNull: [
                      {
                        $arrayElemAt: ['$attempt_metrics.stats', 0],
                      },
                      [],
                    ],
                  },
                  0,
                ],
              },
            },
            in: { $ifNull: ['$$firstStat.total_attempts', 0] },
          },
        },
        average_accuracy: {
          $let: {
            vars: {
              firstStat: {
                $arrayElemAt: [
                  {
                    $ifNull: [
                      {
                        $arrayElemAt: ['$attempt_metrics.stats', 0],
                      },
                      [],
                    ],
                  },
                  0,
                ],
              },
            },
            in: {
              $cond: [
                { $gt: ['$$firstStat.total_max_score', 0] },
                {
                  $round: [
                    { $divide: ['$$firstStat.total_score', '$$firstStat.total_max_score'] },
                    3,
                  ],
                },
                0,
              ],
            },
          },
        },
        accuracy_percentage: {
          $let: {
            vars: {
              firstStat: {
                $arrayElemAt: [
                  {
                    $ifNull: [
                      {
                        $arrayElemAt: ['$attempt_metrics.stats', 0],
                      },
                      [],
                    ],
                  },
                  0,
                ],
              },
            },
            in: {
              $cond: [
                { $gt: ['$$firstStat.total_max_score', 0] },
                {
                  $concat: [
                    {
                      $toString: {
                        $round: [
                          {
                            $multiply: [
                              {
                                $divide: [
                                  '$$firstStat.total_score',
                                  '$$firstStat.total_max_score',
                                ],
                              },
                              100,
                            ],
                          },
                          1,
                        ],
                      },
                    },
                    '%',
                  ],
                },
                '0.0%',
              ],
            },
          },
        },
        recommendation: {
          $cond: [
            { $gt: ['$struggling_student_count', 0] },
            'Blackboard Review Recommended',
            {
              $cond: [
                { $gte: ['$average_mastery_score', 0.80] },
                'Mastery Achieved',
                'Moderate Reinforcement Needed',
              ],
            },
          ],
        },
      },
    },

    // Stage 7: Sort so critical weak spots appear at the top for immediate blackboard review:
    // struggling_student_count descending, average_mastery_score ascending
    {
      $sort: {
        struggling_student_count: -1,
        average_mastery_score: 1,
        learning_objective_id: 1,
      },
    },
  ];

  return await User.aggregate(pipeline);
}

/**
 * Retrieves the list of students in a school needing prerequisite remediation on a specific
 * learning objective, along with their last quiz attempt score and timestamp.
 * Runs completely inside MongoDB via Aggregation Pipeline.
 *
 * @param {object} params
 * @param {string} params.schoolId - Teacher's school ID
 * @param {string} params.objectiveId - Curriculum Learning Objective ID (e.g., 'SCI-07-HEAT-04')
 * @param {number[]} [params.assignedGrades] - Grades assigned to teacher
 * @param {number} [params.gradeLevel] - Optional grade filter
 * @returns {Promise<Array<object>>} List of struggling students with last attempt metadata
 */
export async function getStrugglingStudentsForObjective({
  schoolId,
  objectiveId,
  assignedGrades = [],
  gradeLevel = null,
}) {
  const normalizedLoId = String(objectiveId || '').trim();

  // Match students belonging to the teacher's school and assigned/requested grades
  const studentMatch = {
    school_id: schoolId,
    role: 'student',
  };

  if (gradeLevel !== null && gradeLevel !== undefined) {
    studentMatch.current_grade = Number(gradeLevel);
  } else if (Array.isArray(assignedGrades) && assignedGrades.length > 0) {
    studentMatch.current_grade = { $in: assignedGrades };
  }

  const pipeline = [
    // Stage 1: Match school students in allowed grades
    { $match: studentMatch },

    // Stage 2: Unwind student concept mastery records
    { $unwind: '$concept_mastery' },

    // Stage 3: Match the specific learning objective AND struggling status (mastery < 0.50 or status = needs_prerequisite_remediation)
    {
      $match: {
        $expr: {
          $and: [
            {
              $eq: [
                { $toUpper: '$concept_mastery.learning_objective_id' },
                normalizedLoId.toUpperCase(),
              ],
            },
            {
              $or: [
                { $lt: ['$concept_mastery.mastery_score', 0.50] },
                { $eq: ['$concept_mastery.status', 'needs_prerequisite_remediation'] },
              ],
            },
          ],
        },
      },
    },

    // Stage 4: Lookup the student's most recent quiz attempt for this objective
    {
      $lookup: {
        from: 'quiz_attempts',
        let: { studentId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$student_id', '$$studentId'] },
                  {
                    $eq: [
                      { $toUpper: '$learning_objective_id' },
                      normalizedLoId.toUpperCase(),
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 1,
              score: 1,
              max_score: 1,
              accuracy: {
                $cond: [
                  { $gt: ['$max_score', 0] },
                  { $round: [{ $divide: ['$score', '$max_score'] }, 4] },
                  0,
                ],
              },
              incorrect_question_tags: 1,
              submitted_at: '$createdAt',
            },
          },
        ],
        as: 'latest_attempt',
      },
    },

    // Stage 5: Project clean structure for blackboard drill-down
    {
      $project: {
        _id: 0,
        student_id: '$_id',
        name: '$name',
        roll_number: '$roll_number',
        grade_level: '$current_grade',
        learning_objective_id: '$concept_mastery.learning_objective_id',
        subject: '$concept_mastery.subject',
        mastery_score: { $round: ['$concept_mastery.mastery_score', 4] },
        status: '$concept_mastery.status',
        attempts_count: '$concept_mastery.attempts_count',
        last_reviewed: '$concept_mastery.last_reviewed',
        last_attempt: {
          $let: {
            vars: { att: { $arrayElemAt: ['$latest_attempt', 0] } },
            in: {
              $cond: [
                { $ifNull: ['$$att', false] },
                {
                  score: '$$att.score',
                  max_score: '$$att.max_score',
                  accuracy: '$$att.accuracy',
                  accuracy_percentage: {
                    $concat: [
                      {
                        $toString: {
                          $round: [{ $multiply: ['$$att.accuracy', 100] }, 1],
                        },
                      },
                      '%',
                    ],
                  },
                  incorrect_question_tags: {
                    $ifNull: ['$$att.incorrect_question_tags', []],
                  },
                  submitted_at: '$$att.submitted_at',
                },
                null,
              ],
            },
          },
        },
      },
    },

    // Stage 6: Sort by lowest mastery score first (most urgent remediation needed), then student name
    {
      $sort: {
        mastery_score: 1,
        name: 1,
      },
    },
  ];

  return await User.aggregate(pipeline);
}

/**
 * Computes classroom overview telemetry for the teacher's dashboard.
 *
 * @param {object} params
 * @param {object} params.teacher - Authenticated teacher user document
 * @returns {Promise<object>} Classroom overview metrics
 */
export async function getTeacherOverviewSummary({ teacher }) {
  const studentQuery = {
    school_id: teacher.school_id,
    role: 'student',
  };

  if (Array.isArray(teacher.assigned_grades) && teacher.assigned_grades.length > 0) {
    studentQuery.current_grade = { $in: teacher.assigned_grades };
  }

  const enrolledStudents = await User.countDocuments(studentQuery);

  return {
    teacher: {
      id: teacher._id,
      name: teacher.name,
      school_id: teacher.school_id,
      email: teacher.email,
      assigned_grades: teacher.assigned_grades || [],
    },
    classroom_summary: {
      enrolled_students: enrolledStudents,
      assigned_grades: teacher.assigned_grades || [],
      school_id: teacher.school_id,
    },
  };
}

export default {
  getClassroomWeakSpotHeatmap,
  getStrugglingStudentsForObjective,
  getTeacherOverviewSummary,
};
