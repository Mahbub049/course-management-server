const mongoose = require('mongoose');

const courseOutcomeSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    statement: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

courseOutcomeSchema.index({ course: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('CourseOutcome', courseOutcomeSchema);
