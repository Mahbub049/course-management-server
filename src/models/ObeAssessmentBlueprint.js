const mongoose = require('mongoose');

const blueprintItemSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    marks: {
      type: Number,
      required: true,
      min: 0,
    },
    coCode: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const obeAssessmentBlueprintSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    assessmentName: {
      type: String,
      required: true,
      trim: true,
    },
    assessmentType: {
      type: String,
      enum: ['ct', 'assignment', 'mid', 'final', 'presentation', 'viva', 'lab', 'custom'],
      default: 'custom',
    },
    totalMarks: {
      type: Number,
      required: true,
      min: 0,
    },
    order: {
      type: Number,
      default: 0,
    },
    items: {
      type: [blueprintItemSchema],
      default: [],
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

obeAssessmentBlueprintSchema.index({ course: 1, assessmentName: 1 }, { unique: true });

module.exports = mongoose.model('ObeAssessmentBlueprint', obeAssessmentBlueprintSchema);
