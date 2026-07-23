const mongoose = require("mongoose");

const timeSlotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    start: { type: String, default: "", trim: true },
    end: { type: String, default: "", trim: true },
    shift: { type: String, default: "", trim: true },
    durationMinutes: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    sequenceOrder: { type: Number, default: 0 },
    nextSlotId: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const counsellingSlotSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, trim: true },
    slotId: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const courseDirectorySchema = new mongoose.Schema(
  {
    id: { type: String, default: "", trim: true },
    code: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    intake: { type: String, default: "", trim: true },
    section: { type: String, default: "", trim: true },
    courseType: {
      type: String,
      enum: ["theory", "lab", "hybrid"],
      default: "theory",
    },
    semester: { type: String, default: "", trim: true },
    year: { type: Number, default: null },
    shift: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
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
    title: { type: String, default: "Class Routine and Weekly Activities", trim: true },
    universityName: {
      type: String,
      default: "Bangladesh University of Business and Technology (BUBT)",
      trim: true,
    },
    facultyName: { type: String, default: "", trim: true },
    facultyCode: { type: String, default: "", trim: true },
    designation: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true },
    facultyEmail: { type: String, default: "", trim: true },
    facultyPhone: { type: String, default: "", trim: true },
    facultyProfileImage: { type: String, default: "", trim: true },
    semester: { type: String, default: "", trim: true },
    year: { type: Number, default: null },
    days: {
      type: [String],
      default: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    workingDays: {
      type: [String],
      default: ["Sun", "Mon", "Tue", "Wed", "Thu"],
    },
    timeSlots: {
      type: [timeSlotSchema],
      default: [],
    },
    // Mixed keeps old string-based room lists readable while new routines store
    // building, room type and lift-level metadata for each room.
    rooms: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    entries: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Backward-compatible text cells used by counselling and older clients.
    cells: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    courses: {
      type: [courseDirectorySchema],
      default: [],
    },
    counsellingSlots: {
      type: [counsellingSlotSchema],
      default: [],
    },
    validation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    totalWorkingHours: { type: Number, default: 0 },
    sourceFileName: { type: String, default: "", trim: true },
    importedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Routine", routineSchema);
