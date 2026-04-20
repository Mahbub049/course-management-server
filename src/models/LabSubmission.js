const mongoose = require('mongoose');

const labSubmissionSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    assessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roll: {
      type: String,
      required: true,
      trim: true,
    },
    originalFileName: {
      type: String,
      required: true,
      trim: true,
    },
    storedFileName: {
      type: String,
      required: true,
      trim: true,
    },
    filePath: {
      type: String,
      required: true,
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      default: '',
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['submitted', 'checked'],
      default: 'submitted',
    },
    teacherNote: {
      type: String,
      trim: true,
      default: '',
    },
    awardedMarks: {
      type: Number,
      default: null,
      min: 0,
    },
    syncedToMarks: {
      type: Boolean,
      default: false,
    },
    syncedAt: {
      type: Date,
      default: null,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    checkedAt: {
      type: Date,
      default: null,
    },
    storageDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

labSubmissionSchema.index({ assessment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('LabSubmission', labSubmissionSchema);