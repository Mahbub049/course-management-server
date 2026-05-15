const mongoose = require("mongoose");

const ALLOWED_EVENT_CATEGORIES = [
  "Holiday",
  "Exam",
  "Payment",
  "Registration",
  "Class",
  "Result",
  "Event",
  "Attendance",
  "Other",
];

const ALLOWED_SUMMARY_TYPES = ["Exam", "Payment", "Class", "Other"];

const academicCalendarEventSchema = new mongoose.Schema(
  {
    dateText: {
      type: String,
      required: true,
      trim: true,
    },
    dayText: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      enum: ALLOWED_EVENT_CATEGORIES,
      default: "Other",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    isHighlighted: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const academicCalendarSummarySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ALLOWED_SUMMARY_TYPES,
      default: "Other",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    dateText: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: true }
);

const academicCalendarSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Academic Calendar",
    },
    semester: {
      type: String,
      default: "",
      trim: true,
    },
    academicYear: {
      type: String,
      default: "",
      trim: true,
    },
    sourceFileName: {
      type: String,
      default: "",
      trim: true,
    },
    events: [academicCalendarEventSchema],
    summaries: [academicCalendarSummarySchema],
    published: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AcademicCalendar", academicCalendarSchema);