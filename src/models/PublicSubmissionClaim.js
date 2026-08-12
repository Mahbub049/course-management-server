const mongoose = require('mongoose');

const publicSubmissionClaimSchema = new mongoose.Schema(
  {
    publicSubmissionLink: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublicSubmissionLink',
      required: true,
      index: true,
    },
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
      index: true,
    },
    // SHA-256 of the random browser/device token. The raw token is never stored.
    deviceIdHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userAgent: {
      type: String,
      default: '',
      trim: true,
    },
    ipAddress: {
      type: String,
      default: '',
      trim: true,
    },
    claimedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Usually the assessment deadline. Null means the lock lasts until the
    // assessment is manually closed or a teacher releases the device.
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
    releasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// One live roll per device for an assessment.
publicSubmissionClaimSchema.index(
  { assessment: 1, deviceIdHash: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'uniq_active_public_submission_device',
  }
);

// One live device per student/roll for an assessment.
publicSubmissionClaimSchema.index(
  { assessment: 1, student: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'uniq_active_public_submission_student',
  }
);

module.exports = mongoose.model('PublicSubmissionClaim', publicSubmissionClaimSchema);
