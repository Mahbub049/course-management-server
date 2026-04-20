const mongoose = require("mongoose");

const courseMaterialSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    topic: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    driveLink: {
      type: String,
      required: true,
      trim: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "ppt", "pptx", "google_slide", "doc", "docx", "link", "other"],
      default: "google_slide",
    },
    visibleToStudents: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseMaterial", courseMaterialSchema);