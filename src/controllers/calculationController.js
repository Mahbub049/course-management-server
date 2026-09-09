const FacultyDutyCalculation = require("../models/FacultyDutyCalculation");
const FacultyCalculationSettings = require("../models/FacultyCalculationSettings");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TERM_ORDER = { spring: 1, summer: 2, fall: 3 };

function cleanText(value = "") {
  return String(value ?? "")
    .replace(/[\u00a0\t\f]+/g, " ")
    .replace(/[–—−]/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function safeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function safeTax(value) {
  return Math.min(100, safeMoney(value));
}

function parseSemester(semester = "") {
  const value = cleanText(semester);
  const match = value.match(/\b(Spring|Summer|Fall)\b[^0-9]*(20\d{2})/i);
  if (!match) {
    const yearOnly = value.match(/\b(20\d{2})\b/);
    const year = Number(yearOnly?.[1] || 0);
    return { year, order: 0, sort: year ? year * 10 : 0 };
  }
  const year = Number(match[2]);
  const order = TERM_ORDER[match[1].toLowerCase()] || 0;
  return { year, order, sort: year * 10 + order };
}

function parseDate(value = "") {
  const text = cleanText(value).replace(/,\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(day)?\.?$/i, "");
  if (!text) return null;

  let match = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return {
        iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        day: DAY_NAMES[date.getUTCDay()],
      };
    }
  }

  match = text.match(/^(\d{1,2})[\s\/-]+([A-Za-z]{3,9}|\d{1,2})[\s\/-]+(20\d{2})$/);
  if (!match) return null;

  const monthNames = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthToken = String(match[2]).toLowerCase();
  const month = /^\d+$/.test(monthToken) ? Number(monthToken) : monthNames[monthToken];
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day: DAY_NAMES[date.getUTCDay()],
  };
}

function timeToMinutes(value = "") {
  const text = cleanText(value).toUpperCase().replace(/\./g, ":");
  let match = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 12 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (match[3] === "PM") hour += 12;
    return hour * 60 + minute;
  }
  match = text.match(/\b([01]?\d|2[0-3]):(\d{2})\b/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeClock(value = "") {
  const text = cleanText(value).toUpperCase().replace(/\./g, ":");
  const match = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/);
  if (!match) return cleanText(value);
  return `${Number(match[1])}:${match[2]} ${match[3]}`;
}

function parseTimeRange(value = "") {
  const text = cleanText(value).replace(/\bTO\b/gi, "–");
  const matches = [...text.matchAll(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(AM|PM)/gi)];
  if (matches.length >= 2) {
    const make = (m) => `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}`;
    return { startTime: make(matches[0]), endTime: make(matches[1]) };
  }
  return { startTime: "", endTime: "" };
}

function classifyDuty(entry) {
  const parsedDate = parseDate(entry.date);
  const day = cleanText(entry.day) || parsedDate?.day || "";
  if (/^Fri(day)?$/i.test(day) || /^Sat(urday)?$/i.test(day)) return "evening";
  const startMinutes = timeToMinutes(entry.startTime || entry.time);
  return startMinutes !== null && startMinutes >= 18 * 60 ? "evening" : "day";
}

function normalizeDutyEntry(entry = {}) {
  const parsedDate = parseDate(entry.date || entry.dateText);
  const range = parseTimeRange(entry.time || "");
  const startTime = normalizeClock(entry.startTime || range.startTime);
  const endTime = normalizeClock(entry.endTime || range.endTime);
  const normalized = {
    date: parsedDate?.iso || cleanText(entry.date || entry.dateText),
    day: parsedDate?.day || cleanText(entry.day),
    startTime,
    endTime,
    time: startTime && endTime ? `${startTime}–${endTime}` : cleanText(entry.time),
    program: cleanText(entry.program),
    intake: cleanText(entry.intake),
    section: cleanText(entry.section || entry.sec),
    course: cleanText(entry.course),
    courseTeacher: cleanText(entry.courseTeacher),
    invigilators: cleanText(entry.invigilators),
    room: cleanText(entry.room),
    dutyType: "day",
  };
  normalized.dutyType = classifyDuty(normalized);
  return normalized;
}

function normalizeDuties(input = []) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map(normalizeDutyEntry)
    .filter((entry) => entry.date && (entry.time || entry.startTime))
    .filter((entry) => {
      const key = [entry.date, entry.startTime, entry.endTime, entry.room, entry.course]
        .map((part) => String(part || "").toLowerCase())
        .join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function getSettings(teacherId) {
  const settings = await FacultyCalculationSettings.findOne({ teacher: teacherId }).lean();
  return {
    dayDutyRate: safeMoney(settings?.dayDutyRate),
    eveningDutyRate: safeMoney(settings?.eveningDutyRate),
    taxRate: safeTax(settings?.taxRate),
  };
}

function buildBilling(duties, settings) {
  const list = Array.isArray(duties) ? duties : [];
  const dayDuties = list.filter((duty) => duty.dutyType === "day").length;
  const eveningDuties = list.filter((duty) => duty.dutyType === "evening").length;
  const dayAmount = safeMoney(dayDuties * settings.dayDutyRate);
  const eveningAmount = safeMoney(eveningDuties * settings.eveningDutyRate);
  const gross = safeMoney(dayAmount + eveningAmount);
  const taxAmount = safeMoney(gross * (settings.taxRate / 100));
  const total = safeMoney(gross - taxAmount);
  return {
    dayDuties,
    eveningDuties,
    dayDutyRate: settings.dayDutyRate,
    eveningDutyRate: settings.eveningDutyRate,
    dayAmount,
    eveningAmount,
    gross,
    taxRate: settings.taxRate,
    taxAmount,
    total,
  };
}

function serializeCalculation(doc, settings, { includeDuties = false } = {}) {
  const item = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: item._id,
    semester: item.semester,
    examType: item.examType,
    sourceFileName: item.sourceFileName || "",
    status: item.status || "pending",
    receivedAt: item.receivedAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    billing: buildBilling(item.duties, settings),
    ...(includeDuties ? { duties: item.duties || [] } : {}),
  };
}

async function getCalculationBootstrap(req, res) {
  try {
    const [settings, pendingCount, receivedCount] = await Promise.all([
      getSettings(req.user.userId),
      FacultyDutyCalculation.countDocuments({ teacher: req.user.userId, status: "pending" }),
      FacultyDutyCalculation.countDocuments({ teacher: req.user.userId, status: "received" }),
    ]);
    return res.json({ settings, pendingCount, receivedCount });
  } catch (error) {
    console.error("Calculation bootstrap error:", error);
    return res.status(500).json({ message: "Could not load calculation settings." });
  }
}

async function listDutyCalculations(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 10;
    const [settings, total, docs] = await Promise.all([
      getSettings(req.user.userId),
      FacultyDutyCalculation.countDocuments({ teacher: req.user.userId }),
      FacultyDutyCalculation.find({ teacher: req.user.userId })
        .sort({ semesterSort: -1, updatedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      items: docs.map((doc) => serializeCalculation(doc, settings)),
      settings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("List duty calculations error:", error);
    return res.status(500).json({ message: "Could not load duty calculations." });
  }
}

async function getDutyCalculation(req, res) {
  try {
    const [settings, doc] = await Promise.all([
      getSettings(req.user.userId),
      FacultyDutyCalculation.findOne({ _id: req.params.id, teacher: req.user.userId }).lean(),
    ]);
    if (!doc) return res.status(404).json({ message: "Duty calculation not found." });
    return res.json({ item: serializeCalculation(doc, settings, { includeDuties: true }) });
  } catch (error) {
    console.error("Get duty calculation error:", error);
    return res.status(500).json({ message: "Could not load the duty list." });
  }
}

async function createDutyCalculation(req, res) {
  try {
    const semester = cleanText(req.body.semester);
    const examType = cleanText(req.body.examType);
    if (!semester || !examType) {
      return res.status(400).json({ message: "Semester and exam type are required." });
    }
    const duties = normalizeDuties(req.body.duties);
    if (!duties.length) {
      return res.status(400).json({ message: "No valid duty rows were found to save." });
    }
    const semesterMeta = parseSemester(semester);
    const doc = await FacultyDutyCalculation.create({
      teacher: req.user.userId,
      semester,
      examType,
      semesterYear: semesterMeta.year,
      semesterOrder: semesterMeta.order,
      semesterSort: semesterMeta.sort,
      sourceFileName: cleanText(req.body.sourceFileName),
      duties,
    });
    const settings = await getSettings(req.user.userId);
    return res.status(201).json({ item: serializeCalculation(doc, settings, { includeDuties: true }) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "A duty calculation already exists for this semester and exam type. Open that row and edit its OCR data instead.",
      });
    }
    console.error("Create duty calculation error:", error);
    return res.status(500).json({ message: "Could not save the duty calculation." });
  }
}

async function updateDutyCalculation(req, res) {
  try {
    const doc = await FacultyDutyCalculation.findOne({ _id: req.params.id, teacher: req.user.userId });
    if (!doc) return res.status(404).json({ message: "Duty calculation not found." });

    if (req.body.semester !== undefined) doc.semester = cleanText(req.body.semester);
    if (req.body.examType !== undefined) doc.examType = cleanText(req.body.examType);
    if (!doc.semester || !doc.examType) {
      return res.status(400).json({ message: "Semester and exam type are required." });
    }
    if (req.body.duties !== undefined) {
      const duties = normalizeDuties(req.body.duties);
      if (!duties.length) return res.status(400).json({ message: "At least one valid duty is required." });
      doc.duties = duties;
    }
    const meta = parseSemester(doc.semester);
    doc.semesterYear = meta.year;
    doc.semesterOrder = meta.order;
    doc.semesterSort = meta.sort;
    await doc.save();
    const settings = await getSettings(req.user.userId);
    return res.json({ item: serializeCalculation(doc, settings, { includeDuties: true }) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "That semester and exam type already exists." });
    }
    console.error("Update duty calculation error:", error);
    return res.status(500).json({ message: "Could not update the duty calculation." });
  }
}

async function updateReceivedStatus(req, res) {
  try {
    const received = req.body.received !== false;
    const doc = await FacultyDutyCalculation.findOneAndUpdate(
      { _id: req.params.id, teacher: req.user.userId },
      { status: received ? "received" : "pending", receivedAt: received ? new Date() : null },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Duty calculation not found." });
    const settings = await getSettings(req.user.userId);
    return res.json({ item: serializeCalculation(doc, settings) });
  } catch (error) {
    console.error("Update received status error:", error);
    return res.status(500).json({ message: "Could not update bill status." });
  }
}

async function updateCalculationSettings(req, res) {
  try {
    const settings = {
      dayDutyRate: safeMoney(req.body.dayDutyRate),
      eveningDutyRate: safeMoney(req.body.eveningDutyRate),
      taxRate: safeTax(req.body.taxRate),
    };
    const saved = await FacultyCalculationSettings.findOneAndUpdate(
      { teacher: req.user.userId },
      { $set: settings, $setOnInsert: { teacher: req.user.userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({
      settings: {
        dayDutyRate: safeMoney(saved.dayDutyRate),
        eveningDutyRate: safeMoney(saved.eveningDutyRate),
        taxRate: safeTax(saved.taxRate),
      },
    });
  } catch (error) {
    console.error("Update calculation settings error:", error);
    return res.status(500).json({ message: "Could not save billing settings." });
  }
}

module.exports = {
  getCalculationBootstrap,
  listDutyCalculations,
  getDutyCalculation,
  createDutyCalculation,
  updateDutyCalculation,
  updateReceivedStatus,
  updateCalculationSettings,
};
