const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["teacher", "student"],
      required: true,
    },

    username: {
      type: String,
      required: true,
      unique: true, // teacher username OR student roll
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    pendingRecoveryEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    passwordResetOtpHash: {
      type: String,
      default: null,
    },

    passwordResetOtpExpires: {
      type: Date,
      default: null,
    },

    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
    },

    passwordResetVerified: {
      type: Boolean,
      default: false,
    },

    passwordResetVerifiedExpires: {
      type: Date,
      default: null,
    },

    department: {
      type: String,
    },

    designation: {
      type: String,
      trim: true,
    },

    shortCode: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },

    joiningDate: {
      type: Date,
    },

    profileImage: {
      type: String,
      default: "",
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

userSchema.methods.setPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

userSchema.methods.validatePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);