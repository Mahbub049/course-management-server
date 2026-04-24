const mongoose = require("mongoose");

const projectEvaluationSchema = new mongoose.Schema(
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

    evaluationType: {
      type: String,
      enum: ["group", "individual"],
      required: true,
    },

    evaluationScope: {
      type: String,
      enum: ["combined", "member"],
      default: "combined",
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

    submission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectSubmission",
      default: null,
    },

    marksObtained: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    feedback: {
      type: String,
      trim: true,
      default: "",
    },

    evaluatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

projectEvaluationSchema.index(
  { phase: 1, group: 1 },
  {
    unique: true,
    partialFilterExpression: {
      group: { $type: "objectId" },
      student: null,
    },
  }
);

projectEvaluationSchema.index(
  { phase: 1, student: 1 },
  {
    unique: true,
    partialFilterExpression: {
      student: { $type: "objectId" },
    },
  }
);

module.exports = mongoose.model("ProjectEvaluation", projectEvaluationSchema);