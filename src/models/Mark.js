const mongoose = require('mongoose');

const subMarkSchema = new mongoose.Schema(
  {
    key: {
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

const markSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      required: true,
    },

    obtainedMarks: {
      type: Number,
      required: true,
      min: 0,
    },

    subMarks: {
      type: [subMarkSchema],
      default: [],
    },
  },
  { timestamps: true }
);

markSchema.index({ course: 1, student: 1, assessment: 1 }, { unique: true });

const Mark = mongoose.model('Mark', markSchema);

module.exports = Mark;