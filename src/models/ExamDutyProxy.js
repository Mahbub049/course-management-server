const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutySession', required: true, index: true },
  record: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutyRecord', required: true },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  originalCode: { type: String, required: true },
  conflictAcknowledged: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ acceptedBy: 1, record: 1 }, { unique: true });
module.exports = mongoose.model('ExamDutyProxy', schema);
