const mongoose = require("mongoose");

const projectGroupSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    leader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    groupName: {
      type: String,
      trim: true,
      default: "",
    },

    projectTitle: {
      type: String,
      trim: true,
      default: "",
    },

    projectSummary: {
      type: String,
      trim: true,
      default: "",
    },

    driveLink: {
      type: String,
      trim: true,
      default: "",
    },

    repositoryLink: {
      type: String,
      trim: true,
      default: "",
    },

    contactEmail: {
      type: String,
      trim: true,
      default: "",
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    createdByRole: {
      type: String,
      enum: ["teacher", "student"],
      default: "student",
    },
  },
  { timestamps: true }
);

projectGroupSchema.index({ course: 1, leader: 1 });

module.exports = mongoose.model("ProjectGroup", projectGroupSchema);