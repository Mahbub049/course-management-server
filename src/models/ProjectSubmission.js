const mongoose = require("mongoose");

const projectSubmissionSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },

    phase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectPhase",
      required: true,
      index: true,
    },

    submissionType: {
      type: String,
      enum: ["group", "individual"],
      required: true,
    },

    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectGroup",
      default: null,
    },

    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    link: {
      type: String,
      required: true,
      trim: true,
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    submittedAt: {
      type: Date,
      default: Date.now,
    },

    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

projectSubmissionSchema.index(
  { phase: 1, group: 1 },
  {
    unique: true,
    partialFilterExpression: {
      group: { $type: "objectId" },
    },
  }
);

projectSubmissionSchema.index(
  { phase: 1, student: 1 },
  {
    unique: true,
    partialFilterExpression: {
      student: { $type: "objectId" },
    },
  }
);

module.exports = mongoose.model("ProjectSubmission", projectSubmissionSchema);