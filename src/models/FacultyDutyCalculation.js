const mongoose = require("mongoose");

const dutyEntrySchema = new mongoose.Schema(
  {
    date: { type: String, trim: true, required: true },
    day: { type: String, trim: true, default: "" },
    startTime: { type: String, trim: true, default: "" },
    endTime: { type: String, trim: true, default: "" },
    time: { type: String, trim: true, default: "" },
    program: { type: String, trim: true, default: "" },
    intake: { type: String, trim: true, default: "" },
    section: { type: String, trim: true, default: "" },
    course: { type: String, trim: true, default: "" },
    courseTeacher: { type: String, trim: true, default: "" },
    invigilators: { type: String, trim: true, default: "" },
    room: { type: String, trim: true, default: "" },
    dutyType: {
      type: String,
      enum: ["day", "evening"],
      required: true,
      default: "day",
    },
  },
  { _id: true }
);

const facultyDutyCalculationSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    semester: { type: String, trim: true, required: true },
    examType: { type: String, trim: true, required: true },
    semesterYear: { type: Number, default: 0 },
    semesterOrder: { type: Number, default: 0 },
    semesterSort: { type: Number, default: 0, index: true },
    sourceFileName: { type: String, trim: true, default: "" },
    duties: { type: [dutyEntrySchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "received"],
      default: "pending",
      index: true,
    },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

facultyDutyCalculationSchema.index(
  { teacher: 1, semester: 1, examType: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "FacultyDutyCalculation",
  facultyDutyCalculationSchema
);
