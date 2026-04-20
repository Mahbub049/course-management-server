const mongoose = require("mongoose");

const fieldConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    required: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const projectFormConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      unique: true,
      index: true,
    },

    fields: {
      groupName: {
        type: fieldConfigSchema,
        default: () => ({ enabled: true, required: true }),
      },

      projectTitle: {
        type: fieldConfigSchema,
        default: () => ({ enabled: true, required: true }),
      },

      projectSummary: {
        type: fieldConfigSchema,
        default: () => ({ enabled: true, required: false }),
      },

      driveLink: {
        type: fieldConfigSchema,
        default: () => ({ enabled: true, required: false }),
      },

      repositoryLink: {
        type: fieldConfigSchema,
        default: () => ({ enabled: false, required: false }),
      },

      contactEmail: {
        type: fieldConfigSchema,
        default: () => ({ enabled: true, required: false }),
      },

      note: {
        type: fieldConfigSchema,
        default: () => ({ enabled: false, required: false }),
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ProjectFormConfig",
  projectFormConfigSchema
);