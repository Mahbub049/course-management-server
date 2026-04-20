const mongoose = require("mongoose");

const projectFeatureSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["lab_final", "project"],
      default: "lab_final",
    },
    totalProjectMarks: {
      type: Number,
      default: 40,
      min: 0,
    },
    allowStudentGroupCreation: {
      type: Boolean,
      default: true,
    },
    allowTeacherGroupEditing: {
      type: Boolean,
      default: true,
    },
    visibleToStudents: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    section: {
      type: String,
    },
    semester: {
      type: String,
    },
    year: {
      type: Number,
    },
    courseType: {
      type: String,
      enum: ["theory", "lab", "hybrid"],
      default: "theory",
    },

    projectFeature: {
      type: projectFeatureSchema,
      default: () => ({}),
    },

    classTestPolicy: {
      mode: {
        type: String,
        enum: [
          "best_n_individual_scaled",
          "best_n_average_scaled",
          "best_one_scaled",
          "manual_average_scaled",
        ],
        default: "best_n_average_scaled",
      },
      bestCount: {
        type: Number,
        default: 2,
        min: 1,
      },
      totalWeight: {
        type: Number,
        default: 15,
        min: 0,
      },
      manualSelectedAssessmentIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Assessment",
        },
      ],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Course = mongoose.model("Course", courseSchema);

module.exports = Course;