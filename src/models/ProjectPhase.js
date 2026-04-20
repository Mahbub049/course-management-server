const mongoose = require("mongoose");

const projectPhaseSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    instructions: {
      type: String,
      trim: true,
      default: "",
    },

    phaseType: {
      type: String,
      enum: ["group", "individual"],
      default: "group",
    },

    dueDate: {
      type: Date,
      default: null,
    },

    totalMarks: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    order: {
      type: Number,
      default: 0,
    },

    isVisibleToStudents: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

projectPhaseSchema.index({ course: 1, order: 1, createdAt: 1 });

module.exports = mongoose.model("ProjectPhase", projectPhaseSchema);