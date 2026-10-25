/**
 * @file QuizAttempt.js
 * @description Mongoose schema for student formative micro-assessment submissions.
 * Designed for offline-first resilience: includes a client-generated UUID (`client_attempt_id`)
 * enabling idempotent synchronization from the Dexie.js (IndexedDB) offline queue.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Question evaluation sub-schema.
 */
const quizQuestionSchema = new Schema(
  {
    question_text: {
      type: String,
      required: [true, 'Question prompt is required'],
      trim: true,
    },
    options: {
      type: [String],
      required: [true, 'Question options array is required'],
      validate: {
        validator: function (opts) {
          return Array.isArray(opts) && opts.length >= 2;
        },
        message: 'A question must provide at least 2 answer options.',
      },
    },
    selected_option_index: {
      type: Number,
      required: [true, 'Selected option index is required'],
      min: 0,
    },
    correct_option_index: {
      type: Number,
      required: [true, 'Correct option index is required'],
      min: 0,
    },
    is_correct: {
      type: Boolean,
      required: true,
    },
    explanation: {
      type: String,
      default: '',
      trim: true,
    },
    tag: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false }
);

/**
 * Main QuizAttempt Schema
 */
const quizAttemptSchema = new Schema(
  {
    // Client-generated UUID (v4) created in browser IndexedDB before offline submission
    // Guarantees idempotency when background sync retries over intermittent connectivity
    client_attempt_id: {
      type: String,
      required: [true, 'client_attempt_id UUID is required for idempotent offline synchronization'],
      trim: true,
      index: true,
    },
    // Reference to the student user document
    student_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student ID reference is required'],
      index: true,
    },
    // Target curriculum learning objective evaluated by this micro-quiz
    learning_objective_id: {
      type: String,
      required: [true, 'Learning objective ID is required'],
      trim: true,
      uppercase: true,
      index: true,
    },
    // Subject normalized to lowercase
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      lowercase: true,
    },
    // Grade level when the quiz was taken
    grade_level: {
      type: Number,
      required: [true, 'Grade level is required'],
      min: [1, 'Minimum grade is 1'],
      max: [12, 'Maximum grade is 12'],
    },
    // Array of evaluated 3-question diagnostic items
    questions: {
      type: [quizQuestionSchema],
      required: [true, 'Questions array is required'],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length > 0;
        },
        message: 'Quiz attempt must contain at least one question.',
      },
    },
    // Number of correct answers
    score: {
      type: Number,
      required: [true, 'Quiz score is required'],
      min: 0,
    },
    // Total possible score (typically 3 for micro-assessments)
    max_score: {
      type: Number,
      required: [true, 'Maximum possible score is required'],
      min: 1,
      default: 3,
    },
    // Tags for misconceptions identified in missed questions (used for teacher heatmap analytics)
    incorrect_question_tags: {
      type: [String],
      default: [],
    },
    // Flag indicating whether this record was created offline and synced later
    synced_from_offline: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'quiz_attempts',
  }
);

// ============================================================================
// Compound Indexes
// ============================================================================

// 1. Ensure idempotent attempts per student
quizAttemptSchema.index({ student_id: 1, client_attempt_id: 1 }, { unique: true });

// 2. Heatmap join optimization: student_id and learning_objective_id in that order
quizAttemptSchema.index({ student_id: 1, learning_objective_id: 1 });

// 3. Fetch student history for a specific objective ordered by recency
quizAttemptSchema.index({ student_id: 1, learning_objective_id: 1, createdAt: -1 });

// 2. Aggregate teacher heatmap analytics by learning objective across classrooms
quizAttemptSchema.index({ learning_objective_id: 1, createdAt: -1 });

// 3. School/Grade level reporting
quizAttemptSchema.index({ subject: 1, grade_level: 1, createdAt: -1 });

export const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);
export default QuizAttempt;
