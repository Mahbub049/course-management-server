// server/src/models/Complaint.js
const mongoose = require("mongoose");

const attendanceRefSchema = new mongoose.Schema(
  {
    // store as "YYYY-MM-DD" for easy UI display/search
    date: { type: String, trim: true },   // e.g. "2026-01-10"
    period: { type: Number, min: 1, max: 20 }, // period number
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ IMPORTANT: controller already sets this; keep it for ownership checks
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    // Keep required true (no breaking changes). General issues can still be course-based.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    // optional for marks-related complaints
    assessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: false,
      default: null,
    },

    // ✅ NEW: category (marks/attendance/general)
    category: {
      type: String,
      enum: ["marks", "attendance", "general"],
      default: "marks",
    },

    // ✅ NEW: used only when category="attendance"
    attendanceRef: {
      type: attendanceRefSchema,
      default: null,
    },

    attendanceRefs: { type: [attendanceRefSchema], default: undefined },
    // An indexed key per selected session makes multi-session submissions
    // mutually exclusive, including simultaneous requests from two tabs.
    attendanceDedupKeys: { type: [String], default: undefined, select: false },
    attachments: [{
      name: { type: String, required: true },
      mimeType: { type: String, required: true },
      size: { type: Number, required: true },
      storagePath: { type: String, required: true, select: false },
    }],

    // Populated only for newly-created attendance complaints. Keeping it sparse
    // avoids deployment failures if historical attendance complaints contain duplicates.
    attendanceDedupKey: {
      type: String,
      trim: true,
      default: undefined,
      select: false,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    reply: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["open", "in_review", "resolved", "rejected"],
      default: "open",
    },
  },
  { timestamps: true }
);

// A student may report a specific attendance session only once.
// A sparse key protects new submissions atomically without forcing a migration
// or failing startup when historical records already contain duplicates.
complaintSchema.index(
  { attendanceDedupKey: 1 },
  {
    unique: true,
    sparse: true,
    name: "unique_student_attendance_complaint",
  }
);

complaintSchema.index(
  { attendanceDedupKeys: 1 },
  { unique: true, sparse: true, name: "unique_attendance_batch_sessions" }
);

module.exports = mongoose.model("Complaint", complaintSchema);
