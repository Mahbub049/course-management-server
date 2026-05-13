const Routine = require("../models/Routine");

const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu"];

const DEFAULT_TIME_SLOTS = [
  { id: "slot_1", label: "08:15 AM to\n09:45 AM\n(Day)", start: "08:15 AM", end: "09:45 AM", shift: "Day" },
  { id: "slot_2", label: "11:15 AM to\n12:45 PM\n(Day)", start: "11:15 AM", end: "12:45 PM", shift: "Day" },
  { id: "slot_3", label: "01:15 PM to\n02:45 PM\n(Day)", start: "01:15 PM", end: "02:45 PM", shift: "Day" },
  { id: "slot_4", label: "04:15 PM to\n05:45 PM\n(Day)", start: "04:15 PM", end: "05:45 PM", shift: "Day" },
  { id: "slot_5", label: "05:45 PM to\n07:00 PM\n(EVE)", start: "05:45 PM", end: "07:00 PM", shift: "EVE" },
  { id: "slot_6", label: "07:00 PM to\n08:15 PM\n(EVE)", start: "07:00 PM", end: "08:15 PM", shift: "EVE" },
  { id: "slot_7", label: "08:15 PM to\n09:30 PM\n(EVE)", start: "08:15 PM", end: "09:30 PM", shift: "EVE" },
];

function cleanString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeDays(days) {
  const arr = Array.isArray(days) ? days : DEFAULT_DAYS;
  return arr.map((d) => cleanString(d)).filter(Boolean).slice(0, 7);
}

function normalizeTimeSlots(timeSlots) {
  const arr = Array.isArray(timeSlots) && timeSlots.length ? timeSlots : DEFAULT_TIME_SLOTS;

  return arr
    .map((slot, index) => {
      const id = cleanString(slot?.id, `slot_${index + 1}`).replace(/\s+/g, "_");
      const label = cleanString(slot?.label, `Slot ${index + 1}`);
      return {
        id,
        label,
        start: cleanString(slot?.start),
        end: cleanString(slot?.end),
        shift: cleanString(slot?.shift),
      };
    })
    .filter((slot) => slot.id && slot.label)
    .slice(0, 12);
}

function normalizeCells(cells, days, timeSlots) {
  const safeCells = {};
  const raw = cells && typeof cells === "object" ? cells : {};

  days.forEach((day) => {
    safeCells[day] = {};
    timeSlots.forEach((slot) => {
      safeCells[day][slot.id] = cleanString(raw?.[day]?.[slot.id]);
    });
  });

  return safeCells;
}

function normalizeCourses(courses) {
  const arr = Array.isArray(courses) ? courses : [];
  return arr
    .map((course) => ({
      code: cleanString(course?.code),
      title: cleanString(course?.title),
      intake: cleanString(course?.intake),
      section: cleanString(course?.section),
      program: cleanString(course?.program),
    }))
    .filter((course) => course.code || course.title || course.intake || course.section || course.program)
    .slice(0, 50);
}

function normalizePayload(body = {}) {
  const days = normalizeDays(body.days);
  const timeSlots = normalizeTimeSlots(body.timeSlots);

  return {
    title: cleanString(body.title, "Class Routine"),
    universityName: cleanString(
      body.universityName,
      "Bangladesh University of Business and Technology (BUBT)"
    ),
    facultyName: cleanString(body.facultyName),
    facultyCode: cleanString(body.facultyCode),
    department: cleanString(body.department),
    buildingNote: cleanString(body.buildingNote),
    revision: cleanString(body.revision),
    lastModifiedText: cleanString(body.lastModifiedText),
    days,
    timeSlots,
    cells: normalizeCells(body.cells, days, timeSlots),
    courses: normalizeCourses(body.courses),
    sourceFileName: cleanString(body.sourceFileName),
    importedAt: body.importedAt ? new Date(body.importedAt) : new Date(),
  };
}

const getMyRoutine = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const routine = await Routine.findOne({ teacher: teacherId }).lean();

    if (!routine) {
      return res.json({
        routine: null,
        defaults: {
          days: DEFAULT_DAYS,
          timeSlots: DEFAULT_TIME_SLOTS,
        },
      });
    }

    return res.json({ routine });
  } catch (err) {
    console.error("getMyRoutine error:", err);
    return res.status(500).json({ message: "Failed to load routine" });
  }
};

const saveMyRoutine = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const update = normalizePayload(req.body);

    const routine = await Routine.findOneAndUpdate(
      { teacher: teacherId },
      { $set: { ...update, teacher: teacherId } },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    return res.json({ message: "Routine saved successfully", routine });
  } catch (err) {
    console.error("saveMyRoutine error:", err);
    return res.status(500).json({ message: "Failed to save routine" });
  }
};

module.exports = {
  getMyRoutine,
  saveMyRoutine,
};
