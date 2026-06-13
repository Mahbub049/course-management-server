const mongoose = require("mongoose");

const ALLOWED_FACULTY_EVENT_TYPES = [
  "Class",
  "Exam",
  "Meeting",
  "Task",
  "Reminder",
  "Deadline",
  "Payment",
  "Registration",
  "Holiday",
  "Event",
  "Other",
];

const ALLOWED_PRIORITIES = ["Low", "Normal", "High"];

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
    },
    priority: {
      type: String,
      enum: ALLOWED_PRIORITIES,
      default: "Normal",
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

facultyCalendarEventSchema.index({ faculty: 1, date: 1 });

module.exports = mongoose.model("FacultyCalendarEvent", facultyCalendarEventSchema);
