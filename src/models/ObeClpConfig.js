const mongoose = require('mongoose');

const clpItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0 },
    coCode: { type: String, required: true, trim: true },

    // Legacy single-source field is kept so existing saved configurations continue
    // to load without a migration. New configurations use sourceAssessments.
    sourceAssessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      default: null,
    },
    sourceAssessments: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Assessment',
        },
      ],
      default: [],
    },

    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const obeClpConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      unique: true,
      index: true,
    },
    attendanceCoCode: {
      type: String,
      default: 'CO3',
      trim: true,
    },
    items: {
      type: [clpItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ObeClpConfig', obeClpConfigSchema);
