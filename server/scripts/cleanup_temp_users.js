/**
 * @file cleanup_temp_users.js
 * @description Purges temporary and benchmark demo user accounts and associated test quiz attempts from MongoDB Atlas.
 */

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';

async function cleanup() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(env.MONGODB_URI);

  const usersCol = mongoose.connection.db.collection('users');
  const attemptsCol = mongoose.connection.db.collection('quiz_attempts');

  const demoQuery = {
    $or: [
      { roll_number: { $regex: '^DEMO-' } },
      { roll_number: { $regex: '^TEST_' } },
      { email: { $regex: 'syncscholar\\.org$|delhi-schools\\.org$' } },
    ],
  };

  const usersToDelete = await usersCol.find(demoQuery).toArray();
  const userIds = usersToDelete.map((u) => u._id);

  console.log(`Found ${usersToDelete.length} temporary users to remove:`, usersToDelete.map((u) => u.name || u.roll_number));

  const deletedUsers = await usersCol.deleteMany(demoQuery);
  const deletedAttempts = await attemptsCol.deleteMany({
    $or: [
      { student_id: { $in: userIds } },
      { student_roll_number: { $regex: '^DEMO-|^TEST_' } },
    ],
  });

  console.log(`Successfully deleted ${deletedUsers.deletedCount} temporary users.`);
  console.log(`Successfully deleted ${deletedAttempts.deletedCount} associated test quiz attempts.`);

  const remainingUsers = await usersCol.countDocuments();
  console.log(`Remaining users in MongoDB: ${remainingUsers}`);

  await mongoose.disconnect();
  process.exit(0);
}

cleanup().catch((err) => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});

