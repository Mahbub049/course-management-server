const { BUBT_ROOM_DIRECTORY, BUBT_TIME_SLOTS } = require("../constants/bubtRoutineData");

const OFFICIAL_DAYS = [
  { id: "Sat", label: "Saturday" },
  { id: "Sun", label: "Sunday" },
  { id: "Mon", label: "Monday" },
  { id: "Tue", label: "Tuesday" },
  { id: "Wed", label: "Wednesday" },
  { id: "Thu", label: "Thursday" },
  { id: "Fri", label: "Friday" },
];

const OFFICIAL_TIME_SLOTS = BUBT_TIME_SLOTS;

const PRAYER_LUNCH = {
  id: "prayer_lunch",
  start: "12:45 PM",
  end: "01:15 PM",
  label: "12:45 PM - 01:15 PM",
  shortLabel: "P&L",
  durationMinutes: 30,
};

const ACTIVITY_TYPES = [
  { id: "CLASS", label: "Class", shortLabel: "Class", required: null },
  { id: "CH", label: "Counselling Hour", shortLabel: "CH", required: 5 },
  { id: "DM", label: "Departmental Meeting", shortLabel: "DM", required: 1 },
  { id: "DCW", label: "Departmental Committee Work", shortLabel: "DCW", required: 3 },
  { id: "IS", label: "Intake Supervision", shortLabel: "IS", required: 3 },
  { id: "OBEI_W", label: "OBE Implementation Work", shortLabel: "OBEI-W", required: 1 },
  { id: "RW", label: "Research Work", shortLabel: "RW", required: 4 },
];

const DEFAULT_ROOMS = BUBT_ROOM_DIRECTORY;

const ACTIVITY_REQUIREMENTS = {
  CH: { min: 5, max: 5, oncePerDay: true, label: "Counselling Hour" },
  DM: { min: 1, max: 1, oncePerDay: true, label: "Departmental Meeting" },
  DCW: { min: 3, max: 3, oncePerDay: true, label: "Departmental Committee Work" },
  IS: { min: 3, max: 3, oncePerDay: true, label: "Intake Supervision" },
  OBEI_W: { min: 1, max: 1, oncePerDay: true, label: "OBE Implementation Work" },
  RW: { min: 4, max: 4, oncePerDay: true, label: "Research Work" },
};

const VALID_ENTRY_TYPES = new Set(ACTIVITY_TYPES.map((item) => item.id));
const DAY_ID_SET = new Set(OFFICIAL_DAYS.map((item) => item.id));
const SLOT_ID_SET = new Set(OFFICIAL_TIME_SLOTS.map((item) => item.id));
const SLOT_MAP = Object.fromEntries(OFFICIAL_TIME_SLOTS.map((item) => [item.id, item]));

const LEGACY_SLOT_MAP_9 = {
  slot_1: "day_0815_0945",
  slot_2: "day_0945_1115",
  slot_3: "day_1115_1245",
  slot_4: "day_1315_1445",
  slot_5: "day_1445_1615",
  slot_6: "day_1615_1745",
  slot_7: "eve_1745_1900",
  slot_8: "eve_1900_2015",
  slot_9: "eve_2015_2130",
};

const LEGACY_SLOT_MAP_7 = {
  slot_1: "day_0815_0945",
  slot_2: "day_1115_1245",
  slot_3: "day_1315_1445",
  slot_4: "day_1615_1745",
  slot_5: "eve_1745_1900",
  slot_6: "eve_1900_2015",
  slot_7: "eve_2015_2130",
};

function cleanString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => cleanString(item)).filter(Boolean))];
}

function normalizeDays(days) {
  const normalized = uniqueStrings(days).filter((day) => DAY_ID_SET.has(day));
  const all = OFFICIAL_DAYS.map((item) => item.id);
  return normalized.length ? all.filter((day) => normalized.includes(day)) : all;
}

function normalizeWorkingDays(workingDays, days) {
  const daySet = new Set(days);
  return uniqueStrings(workingDays).filter((day) => daySet.has(day));
}

function inferBuilding(roomNo = "") {
  const first = cleanString(roomNo).charAt(0);
  if (first === "1") return "Building-1";
  if (first === "2") return "Martyr Sujan Mahmud Building";
  if (first === "3") return "Martyr Tahmid Abdullah Building";
  if (first === "4") return "Building-4";
  return "Custom / Legacy";
}

function normalizeRoom(raw) {
  if (typeof raw === "string") {
    const roomNo = cleanString(raw);
    return roomNo
      ? { buildingName: inferBuilding(roomNo), roomNo, roomTitle: "", liftLevel: null }
      : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const roomNo = cleanString(raw.roomNo || raw.number || raw.value);
  if (!roomNo) return null;
  const liftValue = raw.liftLevel;
  const liftLevel = liftValue === "" || liftValue === null || liftValue === undefined
    ? null
    : Number(liftValue);
  return {
    buildingName: cleanString(raw.buildingName || raw.building, inferBuilding(roomNo)),
    roomNo,
    roomTitle: cleanString(raw.roomTitle || raw.title),
    liftLevel: Number.isFinite(liftLevel) ? liftLevel : null,
  };
}

function roomKey(room) {
  return normalizeRoom(room)?.roomNo || "";
}

function normalizeRooms(rooms) {
  const source = Array.isArray(rooms) && rooms.length ? rooms : DEFAULT_ROOMS;
  const seen = new Set();
  return source
    .map(normalizeRoom)
    .filter(Boolean)
    .filter((room) => {
      const key = room.roomNo.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }));
}

function legacySlotMap(entries = {}) {
  const keys = Object.values(entries || {}).flatMap((day) => Object.keys(day || {}));
  return keys.includes("slot_8") || keys.includes("slot_9") ? LEGACY_SLOT_MAP_9 : LEGACY_SLOT_MAP_7;
}

function extractPrefixedRoom(value) {
  const text = cleanString(value);
  const match = text.match(/^R(?:OOM)?\s*[:#-]\s*(.+)$/i);
  return match ? cleanString(match[1]) : "";
}

function parseIntakeSection(value) {
  const text = cleanString(value);
  const match = text.match(/^([^\s\/-]+)\s*[\/-]\s*([^\s\/-]+)$/);
  if (!match) return null;
  return { intake: cleanString(match[1]), section: cleanString(match[2]) };
}

function repairLegacyClassFields(raw = {}) {
  const repaired = { ...raw };
  let room = cleanString(raw.room);
  let intake = cleanString(raw.intake);
  let section = cleanString(raw.section);

  const prefixedRoom = extractPrefixedRoom(room);
  if (prefixedRoom) room = prefixedRoom;

  // Some older routine versions stored the cell's second line (intake-section)
  // in `room`, and the third line (R:room) in `intake` or `section`.
  const roomFromMetadata = extractPrefixedRoom(intake) || extractPrefixedRoom(section);
  const intakeSectionFromRoom = parseIntakeSection(room);
  if (roomFromMetadata && intakeSectionFromRoom) {
    room = roomFromMetadata;
    intake = intakeSectionFromRoom.intake;
    section = intakeSectionFromRoom.section;
  } else {
    // Also accept a combined intake/section value left by older imports.
    const combined = !section ? parseIntakeSection(intake) : null;
    if (combined) {
      intake = combined.intake;
      section = combined.section;
    }
  }

  repaired.room = room;
  repaired.intake = intake;
  repaired.section = section;
  return repaired;
}

function normalizeEntry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const type = cleanString(raw.type).toUpperCase();
  if (!VALID_ENTRY_TYPES.has(type)) return null;

  if (type !== "CLASS") {
    return {
      type,
      label: ACTIVITY_TYPES.find((item) => item.id === type)?.shortLabel || type,
    };
  }

  const repaired = repairLegacyClassFields(raw);
  const courseType = ["theory", "lab", "hybrid"].includes(cleanString(repaired.courseType).toLowerCase())
    ? cleanString(repaired.courseType).toLowerCase()
    : "theory";
  const courseShift = ["day", "evening"].includes(cleanString(repaired.courseShift || repaired.shift).toLowerCase())
    ? cleanString(repaired.courseShift || repaired.shift).toLowerCase() === "day" ? "Day" : "Evening"
    : "";

  return {
    type: "CLASS",
    courseId: cleanString(repaired.courseId),
    courseCode: cleanString(repaired.courseCode).toUpperCase(),
    courseTitle: cleanString(repaired.courseTitle),
    intake: cleanString(repaired.intake),
    section: cleanString(repaired.section),
    room: cleanString(repaired.room),
    courseType,
    courseShift,
    linkedGroupId: cleanString(repaired.linkedGroupId),
    secondLabDayConfirmed: Boolean(repaired.secondLabDayConfirmed),
    specialSameDayConfirmed: Boolean(repaired.specialSameDayConfirmed),
    specialLabSplitConfirmed: Boolean(repaired.specialLabSplitConfirmed || repaired.secondLabDayConfirmed),
  };
}

function normalizeEntries(entries, days, workingDays) {
  const result = {};
  const raw = entries && typeof entries === "object" ? entries : {};
  const workingSet = new Set(workingDays);
  const oldMap = legacySlotMap(raw);
  const reverseLegacy = Object.fromEntries(Object.entries(oldMap).map(([oldId, newId]) => [newId, oldId]));

  days.forEach((day) => {
    result[day] = {};
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      if (!workingSet.has(day)) {
        result[day][slot.id] = null;
        return;
      }
      const oldId = reverseLegacy[slot.id];
      result[day][slot.id] = normalizeEntry(raw?.[day]?.[slot.id] || (oldId ? raw?.[day]?.[oldId] : null));
    });
  });

  return result;
}

function entryCourseKey(entry = {}) {
  const snapshot = [entry.courseCode, entry.intake, entry.section]
    .map(cleanString)
    .join("|");
  // Course code + intake + section is the stable identity of a teaching
  // assignment. Older saved pairs may have a courseId in only one cell.
  return snapshot.replace(/\|/g, "") ? snapshot.toLowerCase() : cleanString(entry.courseId).toLowerCase();
}

function buildLegacyCells(entries, days) {
  const cells = {};
  days.forEach((day) => {
    cells[day] = {};
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      const entry = entries?.[day]?.[slot.id];
      if (!entry || entry.type === "CH") {
        cells[day][slot.id] = "";
      } else if (entry.type === "CLASS") {
        cells[day][slot.id] = [entry.courseCode, entry.room, [entry.intake, entry.section].filter(Boolean).join("/")]
          .filter(Boolean)
          .join("\n");
      } else {
        cells[day][slot.id] = entry.label || entry.type;
      }
    });
  });
  return cells;
}

function buildCounsellingSlots(entries, workingDays) {
  const result = [];
  workingDays.forEach((day) => {
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      if (entries?.[day]?.[slot.id]?.type === "CH") result.push({ day, slotId: slot.id });
    });
  });
  return result;
}

function isSlotAvailableForDay(slotOrId, day) {
  const slot = typeof slotOrId === "string" ? SLOT_MAP[slotOrId] : slotOrId;
  if (!slot) return false;
  if (slot.shift !== "Evening") return true;
  if (day === "Fri") return true;
  return Number(slot.sequenceOrder) >= 7;
}

function getNextLabSlot(slotId, day = "") {
  const nextId = SLOT_MAP[slotId]?.nextSlotId;
  const next = nextId ? SLOT_MAP[nextId] || null : null;
  if (!next) return null;
  return !day || isSlotAvailableForDay(next, day) ? next : null;
}

function calculateRoutineSummary({ days, workingDays, entries }) {
  const activityCounts = { CH: 0, DM: 0, DCW: 0, IS: 0, OBEI_W: 0, RW: 0 };
  let occupiedMinutes = 0;
  let classSlots = 0;
  let activitySlots = 0;

  const workingSet = new Set(workingDays);
  days.forEach((day) => {
    if (!workingSet.has(day)) return;
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      const entry = entries?.[day]?.[slot.id];
      if (!entry) return;
      occupiedMinutes += slot.durationMinutes;
      if (entry.type === "CLASS") classSlots += 1;
      else if (activityCounts[entry.type] !== undefined) {
        activityCounts[entry.type] += 1;
        activitySlots += 1;
      }
    });
  });

  const prayerLunchMinutes = workingSet.size * PRAYER_LUNCH.durationMinutes;
  const totalMinutes = occupiedMinutes + prayerLunchMinutes;

  return {
    occupiedMinutes,
    prayerLunchMinutes,
    totalMinutes,
    totalWorkingHours: Number((totalMinutes / 60).toFixed(2)),
    classSlots,
    activitySlots,
    activityCounts,
  };
}

function validateRoutine({ days, workingDays, entries, semester, year, rooms }) {
  const blockingErrors = [];
  const completionErrors = [];
  const warnings = [];
  const summary = calculateRoutineSummary({ days, workingDays, entries });

  if (!cleanString(semester)) completionErrors.push("Select the semester.");
  if (!Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 2100) completionErrors.push("Select a valid year.");
  if (workingDays.length !== 5) completionErrors.push("Exactly five working days must be selected.");

  const workingSet = new Set(workingDays);
  days.forEach((day) => {
    const perDay = {};
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      const entry = entries?.[day]?.[slot.id];
      if (!entry) return;
      if (!workingSet.has(day)) blockingErrors.push(`${day} is an off day and cannot contain activities.`);
      if (entry.type !== "CLASS") perDay[entry.type] = (perDay[entry.type] || 0) + 1;
      if (!isSlotAvailableForDay(slot, day)) {
        blockingErrors.push(`${slot.label} is not an available Evening slot on ${day}.`);
      }
    });

    Object.entries(perDay).forEach(([type, count]) => {
      if (ACTIVITY_REQUIREMENTS[type]?.oncePerDay && count > 1) {
        blockingErrors.push(`${ACTIVITY_REQUIREMENTS[type].label} can be selected only once on ${day}.`);
      }
    });

    if (workingSet.has(day) && (perDay.CH || 0) !== 1) completionErrors.push(`Add exactly one Counselling Hour on ${day}.`);
  });

  Object.entries(ACTIVITY_REQUIREMENTS).forEach(([type, rule]) => {
    const count = summary.activityCounts[type] || 0;
    if (count < rule.min) completionErrors.push(`${rule.label} requires ${rule.min} slot${rule.min === 1 ? "" : "s"} per week (currently ${count}).`);
    if (rule.max !== null && count > rule.max) blockingErrors.push(`${rule.label} can have only ${rule.max} slot${rule.max === 1 ? "" : "s"} per week.`);
  });

  if (summary.totalWorkingHours < 35) {
    completionErrors.push(`Total working time, including fixed P&L, must be at least 35 hours (currently ${summary.totalWorkingHours}).`);
  }

  const roomSet = new Set(normalizeRooms(rooms).map((room) => room.roomNo));
  const courseOccurrences = new Map();

  workingDays.forEach((day) => {
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      const entry = entries?.[day]?.[slot.id];
      if (!entry || entry.type !== "CLASS") return;

      if (!entry.courseCode) blockingErrors.push(`A course must be selected for ${day}, ${slot.label}.`);
      if (!entry.room) blockingErrors.push(`Select a room for ${entry.courseCode || "the class"} on ${day}.`);
      if (entry.room && !roomSet.has(entry.room)) warnings.push(`${entry.room} is not in the saved room directory.`);
      if (entry.courseShift && entry.courseShift !== slot.shift) {
        blockingErrors.push(`${entry.courseCode || "Course"} is a ${entry.courseShift} course and cannot use the ${slot.shift} slot ${slot.label}.`);
      }

      const key = entryCourseKey(entry);
      if (!courseOccurrences.has(key)) courseOccurrences.set(key, []);
      courseOccurrences.get(key).push({ day, slot, entry });
    });
  });

  courseOccurrences.forEach((placements) => {
    const sample = placements[0]?.entry || {};
    const courseLabel = [sample.courseCode, sample.intake, sample.section].filter(Boolean).join(" · ") || "Course";
    if (placements.length > 2) blockingErrors.push(`${courseLabel} can have only two class slots in a week.`);
    if (placements.length < 2) completionErrors.push(`${courseLabel} requires two class slots per week (currently ${placements.length}).`);

    const byDay = new Map();
    placements.forEach((item) => {
      if (!byDay.has(item.day)) byDay.set(item.day, []);
      byDay.get(item.day).push(item);
    });

    if (sample.courseType === "lab") {
      if (placements.length === 2 && byDay.size === 1) {
        const values = [...byDay.values()][0].sort((a, b) => a.slot.order - b.slot.order);
        if (getNextLabSlot(values[0]?.slot?.id, values[0]?.day)?.id !== values[1]?.slot?.id) {
          blockingErrors.push(`${courseLabel} lab must occupy two valid consecutive slots when held on the same day.`);
        }
      }
      if (placements.length === 2 && byDay.size === 2) {
        const confirmed = placements.every(({ entry }) => Boolean(entry.specialLabSplitConfirmed));
        if (!confirmed) blockingErrors.push(`${courseLabel} lab is split across two days without special-condition confirmation.`);
      }
    } else if (String(sample.courseShift || "").toLowerCase() === "day") {
      byDay.forEach((values, day) => {
        if (values.length > 1 && !values.some(({ entry }) => entry.specialSameDayConfirmed)) {
          blockingErrors.push(`${courseLabel} has two Day-batch classes on ${day} without special-condition confirmation.`);
        }
      });
    }
  });

  const uniqueBlocking = [...new Set(blockingErrors)];
  const uniqueCompletion = [...new Set(completionErrors)];
  const errors = [...new Set([...uniqueBlocking, ...uniqueCompletion])];
  return {
    canSave: uniqueBlocking.length === 0,
    isValid: errors.length === 0,
    blockingErrors: uniqueBlocking,
    completionErrors: uniqueCompletion,
    errors,
    warnings: [...new Set(warnings)],
    summary,
  };
}

function getVisibleSlotIds(entries, workingDays) {
  return OFFICIAL_TIME_SLOTS.filter((slot) =>
    workingDays.some((day) => Boolean(entries?.[day]?.[slot.id]))
  ).map((slot) => slot.id);
}

module.exports = {
  OFFICIAL_DAYS,
  OFFICIAL_TIME_SLOTS,
  PRAYER_LUNCH,
  ACTIVITY_TYPES,
  ACTIVITY_REQUIREMENTS,
  DEFAULT_ROOMS,
  cleanString,
  normalizeDays,
  normalizeWorkingDays,
  normalizeRoom,
  normalizeRooms,
  roomKey,
  normalizeEntries,
  repairLegacyClassFields,
  entryCourseKey,
  calculateRoutineSummary,
  validateRoutine,
  buildLegacyCells,
  buildCounsellingSlots,
  getNextLabSlot,
  isSlotAvailableForDay,
  getVisibleSlotIds,
};
