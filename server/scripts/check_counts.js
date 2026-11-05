import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';

async function check() {
  await connectDB();
  const col = mongoose.connection.db.collection('curriculum_chunks');
  const counts = await col.aggregate([
    { $group: { _id: { grade: '$metadata.grade_level', ch: '$metadata.chapter_number' }, count: { $sum: 1 } } },
    { $sort: { '_id.grade': 1, '_id.ch': 1 } }
  ]).toArray();
  console.log('Chapter chunk counts:', JSON.stringify(counts, null, 2));
  const total = await col.countDocuments();
  console.log('Total chunks in curriculum_chunks:', total);
  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
