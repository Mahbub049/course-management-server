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
    date: { type: Date, required: true },
    numClasses: { type: Number, min: 1, max: 3, required: true },
    records: [attendanceRecordSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
