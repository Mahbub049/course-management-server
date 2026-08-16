const mongoose = require("mongoose");

const mcqFieldSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "Marking Category" },
    options: {
      type: [String],
      default: ["High", "Medium", "Low"],
    },
    entryMode: { type: String, enum: ["group", "individual"] },
  },
  { _id: false }
);

const blankFieldSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "Marks" },
    entryMode: { type: String, enum: ["group", "individual"] },
  },
  { _id: false }
);

const checkboxFieldSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "Completed" },
    entryMode: { type: String, enum: ["group", "individual"] },
  },
  { _id: false }
);

const notebookSettingsSchema = new mongoose.Schema(
  {
    groupWise: { type: Boolean, default: false },
    groupMarkMode: {
      type: String,
      enum: ["group", "individual"],
      default: "group",
    },
    feedbackEntryMode: {
      type: String,
      enum: ["group", "individual"],
    },
    includeRoll: { type: Boolean, default: true },
    includeName: { type: Boolean, default: true },
    includeFeedback: { type: Boolean, default: true },
    includeMcq: { type: Boolean, default: true },
    includeCheckbox: { type: Boolean, default: false },
    includeBlankFields: { type: Boolean, default: false },
    includeTotal: { type: Boolean, default: false },
    columnOrder: { type: [String], default: [] },
    mcqLabel: { type: String, trim: true, default: "Marking Category" },
    mcqOptions: {
      type: [String],
      default: ["High", "Medium", "Low"],
    },
    mcqFields: {
      type: [mcqFieldSchema],
      default: () => [
        {
          id: "mcq_1",
          label: "Marking Category",
          options: ["High", "Medium", "Low"],
        },
      ],
    },
    checkboxFields: {
      type: [checkboxFieldSchema],
      default: () => [
        {
          id: "checkbox_1",
          label: "Completed",
        },
      ],
    },
    blankFields: {
      type: [blankFieldSchema],
      default: () => [
        {
          id: "blank_1",
          label: "Marks",
        },
      ],
    },
  },
  { _id: false }
);

const evaluationRowSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    courseLabel: { type: String, trim: true, default: "" },
    roll: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    selectedOption: { type: String, trim: true, default: "" },
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    checkboxValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    blankValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    feedback: { type: String, default: "" },
  },
  { _id: false }
);

const groupMemberSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    roll: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    checkboxValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    blankValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    feedback: { type: String, default: "" },
  },
  { _id: false }
);

const groupRowSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: "" },
    groupName: { type: String, trim: true, default: "" },
    members: { type: [groupMemberSchema], default: [] },
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    checkboxValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    blankValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    feedback: { type: String, default: "" },
  },
  { _id: false }
);

const markSyncMappingSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, required: true },
    sourceType: {
      type: String,
      enum: ["blank", "total"],
      default: "blank",
    },
    sourceFieldId: { type: String, trim: true, default: "" },
    sourceLabel: { type: String, trim: true, default: "" },
    targetAssessment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: true,
    },
    targetComponentKey: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const notebookNoteSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    courseScope: {
      type: String,
      enum: ["single", "all"],
      default: "single",
      index: true,
    },
    scopeSemester: { type: String, trim: true, default: "" },
    scopeYear: { type: String, trim: true, default: "" },
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Untitled Note",
    },
    type: {
      type: String,
      enum: ["evaluation", "simple"],
      required: true,
      default: "simple",
      index: true,
    },
    date: {
      type: String,
      trim: true,
      default: "",
    },
    time: {
      type: String,
      trim: true,
      default: "",
    },
    settings: {
      type: notebookSettingsSchema,
      default: () => ({}),
    },
    evaluationRows: {
      type: [evaluationRowSchema],
      default: [],
    },
    groupRows: {
      type: [groupRowSchema],
      default: [],
    },
    markSyncMappings: {
      type: [markSyncMappingSchema],
      default: [],
    },
    content: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

notebookNoteSchema.index({ teacher: 1, updatedAt: -1 });

module.exports = mongoose.model("NotebookNote", notebookNoteSchema);
