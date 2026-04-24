const mongoose = require('mongoose');

const poSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
    },
    statement: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const psoSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
    },
    statement: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const mappingSchema = new mongoose.Schema(
  {
    coCode: {
      type: String,
      required: true,
      trim: true,
    },
    targetType: {
      type: String,
      enum: ['PO', 'PSO'],
      required: true,
    },
    targetCode: {
      type: String,
      required: true,
      trim: true,
    },
    strength: {
      type: Number,
      enum: [1, 2, 3],
      required: true,
    },
  },
  { _id: false }
);

const attainmentLevelSchema = new mongoose.Schema(
  {
    min: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    max: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    level: {
      type: Number,
      required: true,
      min: 0,
      max: 4,
    },
  },
  { _id: false }
);

const courseObeConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      unique: true,
      index: true,
    },
    thresholdPercent: {
      type: Number,
      default: 40,
      min: 0,
      max: 100,
    },
    poStatements: {
      type: [poSchema],
      default: [],
    },
    psoStatements: {
      type: [psoSchema],
      default: [],
    },
    mappings: {
      type: [mappingSchema],
      default: [],
    },
    attainmentLevels: {
      type: [attainmentLevelSchema],
      default: [
        { min: 70, max: 100, level: 4 },
        { min: 60, max: 69.99, level: 3 },
        { min: 50, max: 59.99, level: 2 },
        { min: 40, max: 49.99, level: 1 },
        { min: 0, max: 39.99, level: 0 },
      ],
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CourseObeConfig', courseObeConfigSchema);
