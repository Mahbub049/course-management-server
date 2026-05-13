const mongoose = require("mongoose");

const timeSlotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    start: { type: String, default: "", trim: true },
    end: { type: String, default: "", trim: true },
    shift: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const courseDirectorySchema = new mongoose.Schema(
  {
    code: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    intake: { type: String, default: "", trim: true },
    section: { type: String, default: "", trim: true },
    program: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const routineSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    title: { type: String, default: "Class Routine", trim: true },
    universityName: {
      type: String,
      default: "Bangladesh University of Business and Technology (BUBT)",
      trim: true,
    },
    facultyName: { type: String, default: "", trim: true },
    facultyCode: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    buildingNote: { type: String, default: "", trim: true },
    revision: { type: String, default: "", trim: true },
    lastModifiedText: { type: String, default: "", trim: true },
    days: {
      type: [String],
      default: ["Mon", "Tue", "Wed", "Thu"],
    },
    timeSlots: {
      type: [timeSlotSchema],
      default: [],
    },
    // Shape: { Mon: { slot_1: "ICT 1101\n66-7\nR: 4704" } }
    cells: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    courses: {
      type: [courseDirectorySchema],
      default: [],
    },
    sourceFileName: { type: String, default: "", trim: true },
    importedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Routine = mongoose.model("Routine", routineSchema);

module.exports = Routine;
