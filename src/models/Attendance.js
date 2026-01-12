// server/src/models/Attendance.js
const mongoose = require("mongoose");

const attendanceRecordSchema = new mongoose.Schema(
  {
    roll: { type: String, required: true },
    present: { type: Boolean, default: false },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    section: { type: String },

    // store date only (we still query by range to be safe)
    date: { type: Date, required: true },

    // ✅ NEW: period number (1..n). Keep optional for legacy docs.
    period: { type: Number, min: 1, max: 20 },

    // ✅ Legacy support (old system)
    // old docs may contain numClasses>1 (single doc representing multiple classes)
    numClasses: { type: Number, min: 1, max: 3, required: true },

    records: [attendanceRecordSchema],
  },
  { timestamps: true }
);

// ✅ Unique only for period-based docs (legacy docs without period won't conflict)
attendanceSchema.index(
  { teacher: 1, course: 1, date: 1, period: 1 },
  {
    unique: true,
    partialFilterExpression: { period: { $exists: true } },
  }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
