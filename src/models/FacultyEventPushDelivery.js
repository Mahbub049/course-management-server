const mongoose = require("mongoose");

const facultyEventPushDeliverySchema = new mongoose.Schema(
  {
    deliveryKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      maxlength: 500,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FacultyCalendarEvent",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    offsetMinutes: {
      type: Number,
      required: true,
    },
    eventVersion: {
      type: String,
      required: true,
      maxlength: 80,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "no-device"],
      default: "pending",
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: "",
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

facultyEventPushDeliverySchema.index({ event: 1, user: 1, offsetMinutes: 1 });

module.exports = mongoose.model(
  "FacultyEventPushDelivery",
  facultyEventPushDeliverySchema
);
