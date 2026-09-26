const mongoose = require("mongoose");

const courseFileDocumentSchema = new mongoose.Schema(
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
    itemKey: { type: String, required: true, trim: true, index: true },
    section: { type: String, trim: true, default: "" },
    facultyShortCode: { type: String, trim: true, default: "" },
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      default: null,
    },
    scopeKey: { type: String, trim: true, default: "" },
    band: {
      type: String,
      enum: ["", "best", "mediocre", "poor"],
      default: "",
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    studentRoll: { type: String, trim: true, default: "" },
    studentName: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
    originalFileName: { type: String, required: true, trim: true },
    storagePath: { type: String, required: true, trim: true },
    bucketName: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "application/octet-stream" },
    fileSize: { type: Number, min: 0, default: 0 },
    includeInCombined: { type: Boolean, default: true },
    sourceKind: {
      type: String,
      enum: ["upload", "generated", "lab_submission"],
      default: "upload",
    },
    sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

courseFileDocumentSchema.index({ course: 1, itemKey: 1, section: 1 });

module.exports = mongoose.model("CourseFileDocument", courseFileDocumentSchema);
