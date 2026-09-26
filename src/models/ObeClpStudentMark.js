const mongoose = require('mongoose');

const clpManualEntrySchema = new mongoose.Schema(
  {
    clpKey: { type: String, required: true, trim: true },
    obtainedMarks: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const obeClpStudentMarkSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
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
      type: [clpManualEntrySchema],
      default: [],
    },

    // Optional manual override used by the Lab OBE Mark Entry grid. When null,
    // Attendance continues to follow the normal marksheet / attendance summary.
    attendanceObtainedMarks: {
      type: Number,
      default: null,
      min: 0,
      max: 5,
    },
  },
  { timestamps: true }
);

obeClpStudentMarkSchema.index({ course: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('ObeClpStudentMark', obeClpStudentMarkSchema);
