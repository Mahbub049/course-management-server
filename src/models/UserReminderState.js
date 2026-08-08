const mongoose = require("mongoose");

const userReminderStateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sourceKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    completed: {
      type: Boolean,
      default: false,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userReminderStateSchema.index({ user: 1, sourceKey: 1 }, { unique: true });

module.exports = mongoose.model("UserReminderState", userReminderStateSchema);
