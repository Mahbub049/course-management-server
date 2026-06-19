const mongoose = require("mongoose");

const counsellingBookingSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    routine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Routine",
      default: null,
    },
    date: {
      type: String,
      required: true,
      trim: true,
    },
    day: {
      type: String,
      required: true,
      trim: true,
    },
    slotId: {
      type: String,
      required: true,
      trim: true,
    },
    slotLabel: {
      type: String,
      default: "",
      trim: true,
    },
    start: {
      type: String,
      default: "",
      trim: true,
    },
    end: {
      type: String,
      default: "",
      trim: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    message: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1200,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "alternate_suggested", "declined"],
      default: "pending",
      index: true,
    },
    teacherMessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1200,
    },
    alternateDate: {
      type: String,
      default: "",
      trim: true,
    },
    alternateDay: {
      type: String,
      default: "",
      trim: true,
    },
    alternateSlotId: {
      type: String,
      default: "",
      trim: true,
    },
    alternateSlotLabel: {
      type: String,
      default: "",
      trim: true,
    },
    alternateStart: {
      type: String,
      default: "",
      trim: true,
    },
    alternateEnd: {
      type: String,
      default: "",
      trim: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

counsellingBookingSchema.index({ teacher: 1, date: 1, slotId: 1, status: 1 });
counsellingBookingSchema.index({ student: 1, createdAt: -1 });

const CounsellingBooking = mongoose.model(
  "CounsellingBooking",
  counsellingBookingSchema
);

module.exports = CounsellingBooking;
