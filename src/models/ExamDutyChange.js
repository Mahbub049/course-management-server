const mongoose = require('mongoose');

// Reversible assignment overrides. The published PDF records are never edited.
const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutySession', required: true, index: true },
  kind: { type: String, enum: ['exchange', 'transfer'], required: true },
  fromRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutyRecord', required: true },
  toRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutyRecord', default: null },
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Null is intentional when the faculty shortcode has no portal account yet.
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  fromCode: { type: String, required: true },
  toCode: { type: String, required: true },
  status: { type: String, enum: ['active', 'reverted'], default: 'active', index: true },
  // A unique multikey index prevents the same faculty+original duty from being
  // exchanged/transferred twice (even when PDFs contained legacy duplicate rows).
  locks: { type: [String], required: true },
  conflictAcknowledged: { type: Boolean, default: false },
  revertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revertedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ session: 1, locks: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'active' },
  name: 'one_active_change_per_faculty_duty',
});
// Code indexes let unregistered faculty assignments become visible immediately
// when an account is created with the same shortcode.
schema.index({ session: 1, fromCode: 1, status: 1 });
schema.index({ session: 1, toCode: 1, status: 1 });
schema.index({ session: 1, fromUser: 1, status: 1 });
schema.index({ session: 1, toUser: 1, status: 1 });
module.exports = mongoose.model('ExamDutyChange', schema);
