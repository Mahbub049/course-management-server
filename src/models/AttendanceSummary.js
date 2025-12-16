const mongoose = require("mongoose");

const AttendanceSummarySchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    totalClasses: { type: Number, default: 0 },
    attendedClasses: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 }, // 0-100
    marks: { type: Number, default: 0 }, // 0-5

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // teacher
  },
  { timestamps: true }
);

AttendanceSummarySchema.index({ course: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("AttendanceSummary", AttendanceSummarySchema);
