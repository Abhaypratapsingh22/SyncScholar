/**
 * SyncScholar — Standalone Curriculum Seeding Script (Fallback Option)
 * 
 * Objective:
 * Seeds 10 pedagogical, open-licensed Class 7 Science ("Heat" - NCERT Ch 4)
 * curriculum chunks into MongoDB Atlas with 768-dimensional embeddings generated
 * via Gemini Embedding API (`gemini-embedding-001`).
 * 
 * Key Features:
 * - 10 complete educational chunks covering heat, conduction, convection, radiation.
 * - Idempotent upserts via deterministic `_id` and `chunk_id` (`updateOne(..., { upsert: true })`).
 * - Rate-limit-safe backoff retry mechanism for API rate limits (HTTP 429).
 * - Full alignment with MongoDB Atlas Vector Search index schema (`vector_index`).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables from ingestion/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'syncscholar';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'curriculum_chunks';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL?.replace(/^models\//, '') || 'gemini-embedding-001';

if (!MONGODB_URI) {
  console.error('❌ Error: MONGODB_URI is not set in ingestion/.env');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY is not set in ingestion/.env');
  process.exit(1);
}

// 10 Open-Licensed NCERT Class 7 Science Chapter 4 ("Heat") chunks
const SAMPLE_CHUNKS = [
  {
    chunk_id: 'ncert_sci_g7_ch04_p35_c01',
    text: 'In our daily life, we come across a number of objects. Some of them are hot and some of them are cold. Tea is hot and ice is cold. A reliable measure of the hotness of an object is its temperature. Temperature is measured by a device called a thermometer. Our sense of touch is not always a reliable guide to the degree of hotness or coldness of an object.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-01',
      difficulty_tier: 'foundational',
      page_number: 35,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-06-MATT-01',
          grade_level: 6,
          concept: 'Physical Properties of Everyday Objects'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p36_c02',
    text: 'The thermometer that measures our body temperature is called a clinical thermometer. A clinical thermometer consists of a long, narrow, uniform glass tube with a bulb at one end containing mercury. It has a scale marked in degree Celsius (°C). The normal temperature of the human body is 37°C. The clinical thermometer is designed to measure temperatures only between 35°C and 42°C because human body temperature does not normally go below 35°C or above 42°C.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-02',
      difficulty_tier: 'foundational',
      page_number: 36,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-01',
          grade_level: 7,
          concept: 'Introduction to Temperature and Hotness'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p38_c03',
    text: 'A laboratory thermometer is used for measuring the temperature of objects other than the human body. The range of a laboratory thermometer is generally from -10°C to 110°C. While measuring temperature with a laboratory thermometer, it should be kept upright without tilting, and the bulb must be completely surrounded by the substance whose temperature is being measured, without touching the surface or bottom of the container.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-03',
      difficulty_tier: 'intermediate',
      page_number: 38,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-02',
          grade_level: 7,
          concept: 'Clinical Thermometer Operation'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p40_c04',
    text: 'Heat flows from a body at a higher temperature to a body at a lower temperature. The process by which heat is transferred from the hotter end to the colder end of an object without actual bodily movement of the particles is known as conduction. In solids, generally, heat is transferred by the process of conduction. Materials which allow heat to pass through them easily are conductors of heat (e.g., copper, iron, aluminum). Materials which do not allow heat to pass through them easily are poor conductors of heat, known as insulators (e.g., plastic, wood, air).',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-04',
      difficulty_tier: 'foundational',
      page_number: 40,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-01',
          grade_level: 7,
          concept: 'Direction of Heat Flow'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p41_c05',
    text: 'Thermal insulators have vital practical applications in everyday life. Cooking pans and pressure cookers are made of metals like aluminum or stainless steel because they are good conductors and transfer heat rapidly to food. However, their handles are made of wood or bakelite plastic, which are insulators that protect our hands from burns. Similarly, woollen clothes keep us warm in winter because wool fibres trap a large amount of air between them, and air is a poor conductor of heat that prevents body heat from escaping.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-05',
      difficulty_tier: 'intermediate',
      page_number: 41,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          grade_level: 7,
          concept: 'Thermal Conduction and Insulators'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p42_c06',
    text: 'Water and air are poor conductors of heat. When water in a round bottom flask is heated from below, the water near the flame becomes hot and less dense, causing it to rise up. The colder water from the sides moves down towards the source of heat to take its place. This water also gets heated and rises, setting up cyclic currents called convection currents. This mode of heat transfer in liquids and gases through the actual movement of matter is known as convection.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-06',
      difficulty_tier: 'intermediate',
      page_number: 42,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          grade_level: 7,
          concept: 'Heat Transfer in Fluids'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p42_c07',
    text: 'The people living in coastal areas experience an interesting natural phenomenon known as sea breeze. During the day, land gets heated faster than the sea water. The air over the land becomes hotter and rises up. The cooler air from the sea rushes in towards the land to take its place. The warm air from the land moves towards the sea to complete the cycle. The cool breeze blowing from the sea towards the land during daytime is called the sea breeze.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-07',
      difficulty_tier: 'advanced',
      page_number: 42,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-06',
          grade_level: 7,
          concept: 'Convection Currents in Air'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p43_c08',
    text: 'At night in coastal areas, the reverse of the daytime sea breeze occurs. Land cools down much faster than sea water. Therefore, the air above the sea remains warmer and rises, while the cooler air from the land moves towards the sea to take its place. This breeze flowing from the land towards the sea during the night is called the land breeze. Houses in coastal regions have windows facing the sea to receive cool sea breeze during the day.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-08',
      difficulty_tier: 'advanced',
      page_number: 43,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-07',
          grade_level: 7,
          concept: 'Differential Heating of Land and Water'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p43_c09',
    text: 'The heat from the Sun cannot reach Earth by conduction or convection because most of the space between the Sun and the Earth is a complete vacuum with no material medium. Heat transfer that does not require any medium is called radiation. All hot bodies emit radiant heat. When this radiant heat falls on an object, a part of it is reflected, a part is absorbed, and a part may be transmitted. The temperature of the object increases due to the absorbed part of the heat.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-09',
      difficulty_tier: 'foundational',
      page_number: 43,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-04',
          grade_level: 7,
          concept: 'Modes of Heat Transfer'
        }
      ]
    }
  },
  {
    chunk_id: 'ncert_sci_g7_ch04_p44_c10',
    text: 'Dark-coloured surfaces absorb more heat radiation than light-coloured surfaces. We feel more comfortable in light-coloured or white clothes in the summer because they reflect most of the heat radiation that falls on them, keeping us cool. In contrast, dark-coloured clothes absorb more heat, keeping us warm during cold winter days. Solar cookers and solar water heaters have their interior surfaces painted black to absorb maximum radiant heat from the Sun.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 7,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Heat',
      learning_objective_id: 'SCI-07-HEAT-10',
      difficulty_tier: 'intermediate',
      page_number: 44,
      source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
      prerequisites: [
        {
          learning_objective_id: 'SCI-07-HEAT-09',
          grade_level: 7,
          concept: 'Thermal Radiation and Absorption'
        }
      ]
    }
  }
];

// Retry helper with exponential backoff for rate limits (HTTP 429)
async function generateEmbeddingWithRetry(model, text, maxRetries = 5) {
  let attempt = 0;
  let delay = 1000;

  while (attempt < maxRetries) {
    try {
      const response = await model.embedContent({
        content: { parts: [{ text }] },
        outputDimensionality: 768
      });
      return response.embedding.values;
    } catch (err) {
      attempt++;
      const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && attempt < maxRetries) {
        console.warn(`⚠️ Rate limit (429) hit. Backing off for ${(delay / 1000).toFixed(1)}s (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to generate embedding after ${maxRetries} attempts.`);
}

async function seedSampleChunks() {
  console.log('🚀 Starting SyncScholar Seed Fallback Pipeline...');
  console.log(`📌 Target DB: [${DATABASE_NAME}] | Collection: [${COLLECTION_NAME}]`);
  console.log(`🧠 Embedding Model: [${EMBEDDING_MODEL_NAME}] (outputDimensionality: 768)`);
  console.log(`📚 Preparing ${SAMPLE_CHUNKS.length} Class 7 Science ("Heat") chunks...\n`);

  // Initialize Gemini AI SDK
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

  // Connect to MongoDB
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);

  try {
    const bulkOperations = [];

    for (let i = 0; i < SAMPLE_CHUNKS.length; i++) {
      const chunk = SAMPLE_CHUNKS[i];
      const chunkIndex = i + 1;

      process.stdout.write(`[${chunkIndex}/${SAMPLE_CHUNKS.length}] Embedding "${chunk.chunk_id}" (${chunk.metadata.learning_objective_id})... `);
      
      const embedding = await generateEmbeddingWithRetry(embeddingModel, chunk.text);

      if (!Array.isArray(embedding) || embedding.length !== 768) {
        throw new Error(`Invalid embedding vector size: expected 768, got ${embedding?.length}`);
      }

      console.log(`✅ 768-dim vector generated`);

      const document = {
        _id: chunk.chunk_id,
        chunk_id: chunk.chunk_id,
        text: chunk.text,
        embedding: embedding,
        metadata: chunk.metadata,
        updated_at: new Date()
      };

      bulkOperations.push({
        updateOne: {
          filter: { _id: chunk.chunk_id },
          update: { $set: document },
          upsert: true
        }
      });

      // Small throttle between requests to be gentle on free-tier RPM
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    console.log(`\n💾 Upserting ${bulkOperations.length} chunks into MongoDB Atlas [${DATABASE_NAME}.${COLLECTION_NAME}]...`);
    const bulkResult = await collection.bulkWrite(bulkOperations, { ordered: false });

    console.log(`✨ Upsert complete!`);
    console.log(`   - Matched: ${bulkResult.matchedCount}`);
    console.log(`   - Upserted: ${bulkResult.upsertedCount}`);
    console.log(`   - Modified: ${bulkResult.modifiedCount}`);

    // Verification check
    const totalCount = await collection.countDocuments();
    const sampleDoc = await collection.findOne({ _id: SAMPLE_CHUNKS[0].chunk_id });

    console.log(`\n🔍 Verification Summary:`);
    console.log(`   - Total documents in ${COLLECTION_NAME}: ${totalCount}`);
    console.log(`   - Sample Chunk ID: ${sampleDoc?._id}`);
    console.log(`   - Embedding Vector Length: ${sampleDoc?.embedding?.length} floats (Expected: 768)`);
    console.log(`   - First 3 Vector Floats: [${sampleDoc?.embedding?.slice(0, 3).map(n => n.toFixed(5)).join(', ')}]`);
    console.log(`   - Metadata Grade Level: ${sampleDoc?.metadata?.grade_level}`);
    console.log(`   - Metadata Subject: ${sampleDoc?.metadata?.subject}`);
    console.log(`   - Metadata Objective ID: ${sampleDoc?.metadata?.learning_objective_id}`);
    console.log(`\n🎉 Seed script finished successfully!`);
  } catch (error) {
    console.error('❌ Ingestion Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedSampleChunks();
