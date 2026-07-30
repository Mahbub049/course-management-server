const mongoose = require("mongoose");

// Legacy values are kept so older saved records remain valid. The current
// calendar UI creates only Task, Exam and Event items.
const ALLOWED_FACULTY_EVENT_TYPES = [
  "Task",
  "Exam",
  "Event",
  "Class",
  "Meeting",
  "Reminder",
  "Deadline",
  "Payment",
  "Registration",
  "Holiday",
  "Other",
];

const ALLOWED_PRIORITIES = ["Low", "Normal", "High"];
const ALLOWED_VISIBILITY = ["personal", "university"];

const facultyCalendarEventSchema = new mongoose.Schema(
  {
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    type: {
      type: String,
      enum: ALLOWED_FACULTY_EVENT_TYPES,
      default: "Task",
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      default: null,
      index: true,
    },
    startTime: {
      type: String,
      default: "",
      trim: true,
    },
    endTime: {
      type: String,
      default: "",
      trim: true,
    },
    details: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    visibility: {
      type: String,
      enum: ALLOWED_VISIBILITY,
      default: "personal",
      index: true,
    },
    // Retained for backwards compatibility with existing records.
    priority: {
      type: String,
      enum: ALLOWED_PRIORITIES,
      default: "Normal",
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

facultyCalendarEventSchema.index({ faculty: 1, date: 1, endDate: 1 });
facultyCalendarEventSchema.index({ visibility: 1, date: 1, endDate: 1 });

module.exports = mongoose.model("FacultyCalendarEvent", facultyCalendarEventSchema);
