const mongoose = require("mongoose");

const projectMarkSyncConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      unique: true,
      index: true,
    },

    targetAssessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      default: null,
    },

    syncEnabled: {
      type: Boolean,
      default: false,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ProjectMarkSyncConfig",
  projectMarkSyncConfigSchema
);