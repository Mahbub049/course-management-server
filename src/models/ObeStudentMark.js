const mongoose = require('mongoose');

const obeStudentMarkEntrySchema = new mongoose.Schema(
  {
    itemKey: {
      type: String,
      required: true,
      trim: true,
    },
    obtainedMarks: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const obeStudentMarkSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    blueprint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ObeAssessmentBlueprint',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    entries: {
      type: [obeStudentMarkEntrySchema],
      default: [],
    },
    totalMarks: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

obeStudentMarkSchema.index({ course: 1, blueprint: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('ObeStudentMark', obeStudentMarkSchema);
