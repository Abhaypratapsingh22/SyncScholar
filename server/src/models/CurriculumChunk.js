/**
 * @file CurriculumChunk.js
 * @description Mongoose schema for textbook curriculum chunks stored in the unified MongoDB Atlas data plane.
 * Stores passage text, high-dimensional vector embeddings (768-dim), and structured metadata
 * used by MongoDB Atlas Vector Search pre-filtering for zero-hallucination, curriculum-grounded RAG.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Expected dimensionality for curriculum text embeddings.
 * Corresponds to Google Gemini text-embedding-004 / text-embedding-3-small / BAAI/bge-m3.
 */
const EMBEDDING_DIMENSIONS = 768;

/**
 * Metadata sub-schema for curriculum alignment and pre-filtering.
 */
const curriculumMetadataSchema = new Schema(
  {
    // The official curriculum body or textbook publisher (e.g., "NCERT", "OpenStax")
    source_curriculum: {
      type: String,
      required: [true, 'Curriculum source is required (e.g., "NCERT", "OpenStax")'],
      trim: true,
    },
    // Target student grade level (K-12: 1 through 12)
    grade_level: {
      type: Number,
      required: [true, 'Grade level is required'],
      min: [1, 'Minimum grade level is 1'],
      max: [12, 'Maximum grade level is 12'],
      index: true,
    },
    // Subject area normalized to lowercase (e.g., "science", "mathematics", "physics")
    subject: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    // Textbook chapter number for sequential reading
    chapter_number: {
      type: Number,
      required: [true, 'Chapter number is required'],
    },
    // Chapter title (e.g., "Heat and Temperature", "Linear Equations")
    chapter_title: {
      type: String,
      required: [true, 'Chapter title is required'],
      trim: true,
    },
    // Unique curriculum learning objective identifier (e.g., "SCI-G7-CH04-LO02")
    learning_objective_id: {
      type: String,
      required: [true, 'Learning objective ID is required for formative assessment alignment'],
      trim: true,
      index: true,
    },
    // Pedagogical difficulty tier for adaptive prerequisite fallback
    difficulty_tier: {
      type: String,
      required: [true, 'Difficulty tier is required'],
      enum: {
        values: ['foundational', 'standard', 'advanced'],
        message: 'difficulty_tier must be one of: foundational, standard, advanced',
      },
      default: 'standard',
    },
    // Page number in the official textbook PDF for verifiable student citations
    page_number: {
      type: Number,
      required: [true, 'Page number is required for citation grounding'],
    },
    // Optional public URL pointing to the official textbook chapter page (zero raw PDFs in repo)
    source_url: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false }
);

/**
 * Main CurriculumChunk Schema
 */
const curriculumChunkSchema = new Schema(
  {
    // The extracted, sanitized passage text from the textbook
    text: {
      type: String,
      required: [true, 'Chunk text content is required'],
      trim: true,
    },
    // 768-dimensional float embedding vector for Atlas Vector Search
    embedding: {
      type: [Number],
      required: [true, 'Vector embedding array is required'],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length === EMBEDDING_DIMENSIONS;
        },
        message: `Embedding vector must contain exactly ${EMBEDDING_DIMENSIONS} floating-point values.`,
      },
    },
    // Structured curriculum metadata used for pre-filtering and pedagogical routing
    metadata: {
      type: curriculumMetadataSchema,
      required: [true, 'Curriculum chunk metadata is required'],
    },
  },
  {
    timestamps: true,
    collection: 'curriculum_chunks',
  }
);

// ============================================================================
// Compound Indexes for High-Performance Queries
// ============================================================================

// 1. Optimize standard grade + subject filtering (used by RAG retrieval pre-filters)
curriculumChunkSchema.index({ 'metadata.grade_level': 1, 'metadata.subject': 1 });

// 2. Optimize learning objective & difficulty lookup (used by prerequisite fallback when mastery < 0.5)
curriculumChunkSchema.index({
  'metadata.learning_objective_id': 1,
  'metadata.difficulty_tier': 1,
});

// 3. Optimize chapter syllabus browsing
curriculumChunkSchema.index({
  'metadata.grade_level': 1,
  'metadata.subject': 1,
  'metadata.chapter_number': 1,
});

export const CurriculumChunk = mongoose.model('CurriculumChunk', curriculumChunkSchema);
export default CurriculumChunk;
