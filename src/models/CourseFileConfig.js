const mongoose = require("mongoose");

const sectionSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, trim: true },
    shortCode: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const selectionSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, required: true, trim: true },
    band: { type: String, enum: ["best", "mediocre", "poor"], required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    included: { type: Boolean, default: false },
  },
  { _id: false }
);


const answerScriptRecordRowSchema = new mongoose.Schema(
  {
    band: { type: String, enum: ["best", "mediocre", "poor"], required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    studentRoll: { type: String, trim: true, default: "" },
    studentName: { type: String, trim: true, default: "" },
    scriptSerialNo: { type: String, trim: true, default: "" },
    scoreDisplay: { type: String, trim: true, default: "" },
    remarks: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const courseFileConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      unique: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    setupCompleted: { type: Boolean, default: false },
    sections: { type: [sectionSchema], default: [] },

    // Theory course: include the attendance PDF generated from this portal for
    // the faculty's own section unless a manual replacement is uploaded.
    autoAttendanceEnabled: { type: Boolean, default: true },

    // Lab course mapping controls. Teachers can include/exclude assessments
    // instead of relying only on name matching.
    labReportAssessmentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Assessment" },
    ],
    continuousLabAssessmentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Assessment" },
    ],
    projectReportAssessmentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Assessment" },
    ],
    labMappingsInitialized: { type: Boolean, default: false },

    selections: { type: [selectionSchema], default: [] },

    supplementary: {
      includeMidSelectionSheet: { type: Boolean, default: true },
      includeFinalSelectionSheet: { type: Boolean, default: true },
      includeMidSignature: { type: Boolean, default: false },
      includeFinalSignature: { type: Boolean, default: false },
    },

    // Editable copies of the supplied Mid/Final selected-answer-script record.
    // Empty arrays mean the record is generated from the current suggestions.
    answerScriptRecords: {
      mid: { type: [answerScriptRecordRowSchema], default: [] },
      final: { type: [answerScriptRecordRowSchema], default: [] },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CourseFileConfig", courseFileConfigSchema);
