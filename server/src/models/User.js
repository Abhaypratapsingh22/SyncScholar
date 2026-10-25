/**
 * @file User.js
 * @description Mongoose schema for SyncScholar users supporting both Student and Teacher roles.
 * Supports identifier flexibility (email for teachers, roll numbers for low-resource classroom students),
 * role-based access control, and student concept mastery tracking with baseline mastery scores.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

/**
 * Sub-schema for individual concept mastery tracking.
 * SyncScholar uses an Exponential Moving Average (EMA) mastery loop where:
 * - A student starts at a default mastery baseline of 0.50 (50%).
 * - Scores >= 0.80 transition to 'mastered'.
 * - Scores < 0.50 trigger 'needs_prerequisite_remediation' (activating foundational fallback chunks).
 */
const conceptMasterySchema = new Schema(
  {
    learning_objective_id: {
      type: String,
      required: [true, 'Learning objective ID is required'],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      lowercase: true,
    },
    mastery_score: {
      type: Number,
      required: true,
      default: 0.5,
      min: [0.0, 'Mastery score cannot be negative'],
      max: [1.0, 'Mastery score cannot exceed 1.0 (100%)'],
    },
    attempts_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ['mastered', 'progressing', 'needs_prerequisite_remediation'],
        message: 'Status must be one of: mastered, progressing, needs_prerequisite_remediation',
      },
      default: 'progressing',
    },
    last_reviewed: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/**
 * Main User Schema
 */
const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    // Teachers and administrators typically authenticate via email
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: [
        function () {
          return !this.roll_number;
        },
        'Email address is required when roll number is not provided.',
      ],
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    // In underserved rural schools, students often lack personal emails and use school roll numbers
    roll_number: {
      type: String,
      trim: true,
      uppercase: true,
      required: [
        function () {
          return !this.email;
        },
        'Student roll number is required when email is not provided.',
      ],
    },
    password_hash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      required: [true, 'User role is required'],
      enum: {
        values: ['student', 'teacher', 'admin'],
        message: 'Role must be student, teacher, or admin',
      },
      default: 'student',
    },
    school_id: {
      type: String,
      required: [true, 'School ID is required for multi-tenant classroom partitioning'],
      trim: true,
      index: true,
    },
    // Current grade level (1-12) for curriculum grounding and adaptive pre-filtering
    current_grade: {
      type: Number,
      min: [1, 'Minimum grade is 1'],
      max: [12, 'Maximum grade is 12'],
      default: null,
    },
    // Assigned grades for teachers (e.g., [6, 7, 8]) for classroom overview and heatmap filtering
    assigned_grades: {
      type: [Number],
      default: [],
    },
    preferred_language: {
      type: String,
      default: 'en',
      trim: true,
    },
    // Granular concept mastery records per learning objective
    concept_mastery: {
      type: [conceptMasterySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

/**
 * Compares an incoming plain-text password with the stored bcrypt hash.
 * 
 * @param {string} enteredPassword - Candidate plain-text password from login request
 * @returns {Promise<boolean>} True if password matches stored hash, false otherwise
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password_hash);
};

// ============================================================================
// Compound Indexes
// ============================================================================

// 1. Ensure roll numbers are unique per school for students
userSchema.index(
  { school_id: 1, roll_number: 1 },
  { unique: true, sparse: true, partialFilterExpression: { roll_number: { $type: 'string' } } }
);

// 2. Ensure emails are unique when present
userSchema.index(
  { email: 1 },
  { unique: true, sparse: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// 3. Optimize queries for school teacher/student listings
userSchema.index({ school_id: 1, role: 1 });

// 4. Optimize aggregation queries for teacher classroom weak-spot heatmaps
userSchema.index({ 'concept_mastery.learning_objective_id': 1 });

export const User = mongoose.model('User', userSchema);
export default User;
