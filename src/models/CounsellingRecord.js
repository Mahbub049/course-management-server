const mongoose = require("mongoose");

const counsellingParticipantSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roll: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const counsellingRecordSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    participants: {
      type: [counsellingParticipantSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "At least one student is required.",
      },
    },
    date: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    startTime: {
      type: String,
      required: true,
      trim: true,
    },
    endTime: {
      type: String,
      default: "",
      trim: true,
    },
    venue: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2400,
    },
    sessionStatus: {
      type: String,
      enum: ["completed", "scheduled"],
      required: true,
      index: true,
    },
    courseCode: { type: String, default: "", trim: true },
    courseTitle: { type: String, default: "", trim: true },
    intake: { type: String, default: "", trim: true },
    section: { type: String, default: "", trim: true },
    semester: { type: String, default: "", trim: true, index: true },
    year: { type: Number, default: null, index: true },
    department: { type: String, default: "", trim: true },
    shift: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

counsellingRecordSchema.index({ teacher: 1, date: -1, createdAt: -1 });
counsellingRecordSchema.index({ teacher: 1, semester: 1, year: 1, course: 1 });
counsellingRecordSchema.index({ "participants.student": 1, date: -1 });

module.exports = mongoose.model("CounsellingRecord", counsellingRecordSchema);
