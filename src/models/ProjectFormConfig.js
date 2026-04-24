const mongoose = require("mongoose");

const fieldConfigSchema = new mongoose.Schema(
  {
    visibleToStudent: {
      type: Boolean,
      default: true,
    },
    editableByStudent: {
      type: Boolean,
      default: true,
    },
    requiredOnGroupCreate: {
      type: Boolean,
      default: false,
    },
    requiredOnProjectUpdate: {
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
        default: () => ({
          visibleToStudent: true,
          editableByStudent: false,
          requiredOnGroupCreate: true,
          requiredOnProjectUpdate: false,
        }),
      },

      projectTitle: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: true,
        }),
      },

      projectSummary: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: false,
        }),
      },

      driveLink: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: false,
        }),
      },

      repositoryLink: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: false,
        }),
      },

      contactEmail: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: false,
        }),
      },

      additionalNote: {
        type: fieldConfigSchema,
        default: () => ({
          visibleToStudent: true,
          editableByStudent: true,
          requiredOnGroupCreate: false,
          requiredOnProjectUpdate: false,
        }),
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ProjectFormConfig",
  projectFormConfigSchema
);