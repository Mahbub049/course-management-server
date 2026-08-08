const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, trim: true },
    platform: { type: String, enum: ["android", "ios", "web", "unknown"], default: "unknown" },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userNotificationPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    enabled: { type: Boolean, default: true },
    categories: {
      tasks: { type: Boolean, default: true },
      submissions: { type: Boolean, default: true },
      exams: { type: Boolean, default: true },
      events: { type: Boolean, default: true },
      academicCalendar: { type: Boolean, default: true },
    },
    reminderOffsetsMinutes: {
      type: [Number],
      default: () => [1440, 180, 60],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= 6 &&
            value.every((item) => Number.isInteger(item) && item >= 1 && item <= 10080)
          );
        },
        message: "Reminder offsets must be whole minutes between 1 minute and 7 days.",
      },
    },
    scheduleWindowDays: {
      type: Number,
      min: 1,
      max: 30,
      default: 7,
    },
    deviceTokens: {
      type: [deviceTokenSchema],
      default: () => [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "UserNotificationPreference",
  userNotificationPreferenceSchema
);
