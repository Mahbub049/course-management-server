const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['teacher', 'student'],
      required: true,
    },

    username: {
      type: String,
      required: true,
      unique: true, // teacher username OR student roll
    },

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true, // allows students without email
    },

    // 👇 Teacher-only fields
    department: {
      type: String,
    },
    designation: {
      type: String,
    },
    joiningDate: {
      type: Date,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    firstLogin: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Password helpers
userSchema.methods.setPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

userSchema.methods.validatePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
