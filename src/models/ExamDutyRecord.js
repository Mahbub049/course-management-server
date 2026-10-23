const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamDutySession', required: true, index: true },
  fingerprint: { type: String, required: true },
  date: { type: String, required: true },
  day: { type: String, default: '' },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  time: { type: String, default: '' },
  program: { type: String, default: '' },
  intake: { type: String, default: '' },
  section: { type: String, default: '' },
  course: { type: String, default: '' },
  courseTeacher: { type: String, default: '' },
  invigilators: { type: String, default: '' },
  invigilatorCodes: { type: [String], default: [], index: true },
  room: { type: String, default: '' },
  category: { type: String, enum: ['exam', 'reserved', 'support'], default: 'exam' },
  sourceFile: { type: String, default: '' },
  sourcePage: { type: Number, default: 0 },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ session: 1, fingerprint: 1 }, { unique: true });
schema.index({ session: 1, date: 1, startTime: 1 });
schema.index({ session: 1, invigilatorCodes: 1 });
module.exports = mongoose.model('ExamDutyRecord', schema);
