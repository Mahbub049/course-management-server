const mongoose = require("mongoose");

const facultyCalculationSettingsSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    dayDutyRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    eveningDutyRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    taxRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "FacultyCalculationSettings",
  facultyCalculationSettingsSchema
);
