const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  season: { type: String, required: true, enum: ['Spring', 'Summer', 'Fall'] },
  year: { type: Number, required: true, min: 2020, max: 2100 },
  examType: { type: String, required: true, enum: ['Mid Term', 'Final', 'Supplementary Mid', 'Supplementary Final', 'Improvement', 'Other'] },
  name: { type: String, trim: true, maxlength: 120, required: true },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sourceFiles: [{ name: String, importedAt: Date, importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, rows: Number }],
}, { timestamps: true });
schema.index({ season: 1, year: 1, examType: 1 }, { unique: true });
module.exports = mongoose.model('ExamDutySession', schema);
