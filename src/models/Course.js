const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    section: {
      type: String,
    },
    semester: {
      type: String, // e.g. "Fall", "Spring"
    },
    year: {
      type: Number,
    },
       courseType: {
      type: String,
      enum: ['theory', 'lab', 'hybrid'],
      default: 'theory',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // teacher
    },
  },
  { timestamps: true }
);

const Course = mongoose.model('Course', courseSchema);

module.exports = Course;
