const mongoose = require('mongoose');

const publicSubmissionLinkSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      unique: true,
      index: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
      default: 'Public Submission Link',
    },
    instructions: {
      type: String,
      trim: true,
      default: '',
    },
    assessmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Assessment',
      },
    ],
    isActive: {
      type: Boolean,
      default: false,
    },
    // Marks this course as the single page opened by the shared /submit address.
    // The controller keeps this exclusive; course-specific token links remain separate.
    showOnPortal: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Optional schedule for automatically showing/hiding the course on /submit.
    portalVisibleFrom: {
      type: Date,
      default: null,
    },
    portalVisibleUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PublicSubmissionLink', publicSubmissionLinkSchema);
