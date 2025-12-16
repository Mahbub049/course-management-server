require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const run = async () => {
  await connectDB();

  const username = 'teacher01';
  const plainPassword = 'teacher123';

  let user = await User.findOne({ username });

  if (!user) {
    user = new User({
      role: 'teacher',
      username,
      name: 'Main Teacher',
      email: 'teacher@example.com',
      passwordHash: 'temp',
      firstLogin: true,
    });
    await user.setPassword(plainPassword);
    await user.save();
    console.log('Teacher created successfully!');
  } else {
    console.log('Teacher already exists.');
  }

  console.log({ username, plainPassword });

  mongoose.connection.close();
};

run().catch((err) => {
  console.error(err);
  mongoose.connection.close();
});
