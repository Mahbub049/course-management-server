const mongoose = require('mongoose');

const phaseSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    marks: {
      type: Number,
      required: true,
      min: 0,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const projectComponentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    marks: {
      type: Number,
      required: true,
      min: 0,
    },
    entryMode: {
      type: String,
      enum: ['single', 'phased'],
      default: 'single',
    },
    phases: {
      type: [phaseSchema],
      default: [],
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const examQuestionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    marks: {
      type: Number,
      required: true,
      min: 0,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const labFinalConfigSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ['project_only', 'lab_exam_only', 'mixed'],
      default: 'lab_exam_only',
    },
    totalMarks: {
      type: Number,
      default: 40,
      min: 0,
    },

    projectMarks: {
      type: Number,
      default: 0,
      min: 0,
    },
    labExamMarks: {
      type: Number,
      default: 0,
      min: 0,
    },

    projectComponents: {
      type: [projectComponentSchema],
      default: [],
    },

    examQuestions: {
      type: [examQuestionSchema],
      default: [],
    },
  },
  { _id: false }
);

const assessmentSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    fullMarks: {
      type: Number,
      required: true,
      min: 0,
    },

    order: {
      type: Number,
      default: 0,
    },

    structureType: {
      type: String,
      enum: ['regular', 'lab_final'],
      default: 'regular',
    },

    labFinalConfig: {
      type: labFinalConfigSchema,
      default: null,
    },

    isPublished: {
      type: Boolean,
      default: false,
    },

    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

assessmentSchema.index({ course: 1, name: 1 }, { unique: false });

const Assessment = mongoose.model('Assessment', assessmentSchema);

module.exports = Assessment;