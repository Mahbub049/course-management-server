const mongoose = require('mongoose');

const assessmentSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    name: {
      type: String, // e.g. CT1, CT2, Mid, Final, Attendance, Assignment, Presentation
      required: true,
      trim: true,
    },
    fullMarks: {
      type: Number,
      required: true,
    },
    order: {
      type: Number, // for sorting (optional)
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// we allow duplicate names technically, but we’ll enforce logic in controller
assessmentSchema.index({ course: 1, name: 1 }, { unique: false });

const Assessment = mongoose.model('Assessment', assessmentSchema);

module.exports = Assessment;
