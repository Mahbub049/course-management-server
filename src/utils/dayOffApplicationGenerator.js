const fs = require("fs");
const path = require("path");
const { OFFICIAL_TIME_SLOTS } = require("./routineRules");

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "routine",
  "DayOffApplicationTemplate.docx"
);

const SLOT_MAP = Object.fromEntries(OFFICIAL_TIME_SLOTS.map((slot) => [slot.id, slot]));
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function cleanString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function xmlEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ordinalSuffix(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "th";
  const mod100 = Math.abs(numeric) % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = Math.abs(numeric) % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function ordinalIntake(value) {
  const text = cleanString(value);
  if (!text) return "";
  if (/\d(?:st|nd|rd|th)$/i.test(text)) return text;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return text;
  return `${numeric}${ordinalSuffix(numeric)}`;
}

function normalizeSection(value) {
  const text = cleanString(value);
  if (!text) return "";
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

function formatClockTime(value) {
  const text = cleanString(value);
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text.toLowerCase();
  const hour = match[1].padStart(2, "0");
  return `${hour}:${match[2]} ${match[3].toLowerCase()}`;
}

function bodyDepartment(department) {
  const text = cleanString(department, "Department of Computer Science and Engineering");
  if (/\bCSE\b/i.test(text) || /computer\s+science\s+and\s+engineering/i.test(text)) {
    return "Dept. of CSE";
  }
  if (/^department\s+of\s+/i.test(text)) {
    return text.replace(/^department\s+of\s+/i, "Dept. of ");
  }
  if (/^dept\.?\s+of\s+/i.test(text)) return text;
  return `Dept. of ${text}`;
}

function fullDepartment(department) {
  const text = cleanString(department, "Department of Computer Science and Engineering");
  if (/^CSE$/i.test(text) || /^dept\.?\s+of\s+CSE$/i.test(text) || /computer\s+science\s+and\s+engineering/i.test(text)) {
    return "Department of Computer Science and Engineering";
  }
  if (/^dept\.?\s+of\s+/i.test(text)) {
    return text.replace(/^dept\.?\s+of\s+/i, "Department of ");
  }
  if (/^department\s+of\s+/i.test(text)) return text;
  return `Department of ${text}`;
}

function programCode(department) {
  const text = cleanString(department);
  if (/\bCSE\b/i.test(text) || /computer\s+science\s+and\s+engineering/i.test(text)) return "CSE";
  const match = text.match(/\b([A-Z]{2,6})\b/);
  return match?.[1] || "CSE";
}

function programLabel(entry, routine) {
  const shift = cleanString(entry.courseShift || SLOT_MAP[entry.slotId]?.shift || "Evening");
  const shiftLabel = /^day$/i.test(shift) ? "Day Program" : "Evening Program";
  return `${programCode(routine.department)} (${shiftLabel})`;
}

function courseIdentity(entry = {}) {
  return [entry.courseId, entry.courseCode, entry.intake, entry.section]
    .map((value) => cleanString(value).toLowerCase())
    .filter(Boolean)
    .join("|");
}

function getFridayCourseGroups(routine) {
  const orderedSlots = [...OFFICIAL_TIME_SLOTS].sort((a, b) => {
    const shiftDiff = (a.shift === "Evening" ? 1 : 0) - (b.shift === "Evening" ? 1 : 0);
    if (shiftDiff) return shiftDiff;
    return Number(a.sequenceOrder || a.order || 0) - Number(b.sequenceOrder || b.order || 0);
  });
  const groups = [];
  const byKey = new Map();

  orderedSlots.forEach((slot) => {
    const entry = routine.entries?.Fri?.[slot.id];
    if (!entry || entry.type !== "CLASS") return;

    const key = courseIdentity(entry) || `${cleanString(entry.courseCode).toLowerCase()}|${slot.id}`;
    const existing = byKey.get(key);
    const placement = { ...entry, slotId: slot.id, start: slot.start, end: slot.end, slot };

    if (!existing) {
      const group = {
        key,
        entry: placement,
        first: placement,
        last: placement,
        placements: [placement],
      };
      byKey.set(key, group);
      groups.push(group);
      return;
    }

    existing.placements.push(placement);
    existing.last = placement;
  });

  return groups.map((group) => {
    // Consecutive cells of the same course represent one Friday class block.
    // Use the first slot's start and the last slot's end for BOTH theory and
    // lab courses (e.g. 03:15-04:30 + 04:30-05:45 => 03:15-05:45).
    return {
      ...group.entry,
      slotId: group.first.slotId,
      start: group.first.start,
      end: group.last.end,
      program: programLabel(group.first, routine),
      intake: cleanString(group.entry.intake),
      section: cleanString(group.entry.section),
    };
  });
}

function joinWithAnd(values = []) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function courseBaseText(course) {
  const title = cleanString(course.courseTitle);
  const codeAndTitle = title
    ? `${cleanString(course.courseCode)} (${title})`
    : cleanString(course.courseCode);
  return `${codeAndTitle} from ${formatClockTime(course.start)} to ${formatClockTime(course.end)}`;
}

function courseProgramText(course) {
  const intake = ordinalIntake(course.intake);
  const section = normalizeSection(course.section);
  const details = [
    intake ? `${intake} intake` : "",
    section ? `(Section - ${section})` : "",
  ].filter(Boolean).join(" ");
  return `${course.program}${details ? ` ${details}` : ""}`;
}

function buildFridayClassSentence(routine) {
  const courses = getFridayCourseGroups(routine);
  if (!courses.length) return { count: 0, text: "" };

  const commonProgram = courses.every((course) => course.program === courses[0].program);
  const commonIntake = courses.every((course) => cleanString(course.intake) === cleanString(courses[0].intake));
  const commonSection = courses.every((course) => cleanString(course.section) === cleanString(courses[0].section));

  let details;
  if (commonProgram && commonIntake && commonSection) {
    details = `${joinWithAnd(courses.map(courseBaseText))} with ${courseProgramText(courses[0])}`;
  } else {
    details = joinWithAnd(
      courses.map((course) => `${courseBaseText(course)} with ${courseProgramText(course)}`)
    );
  }

  return { count: courses.length, text: details };
}

function numberWord(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < NUMBER_WORDS.length) return NUMBER_WORDS[numeric];
  return String(value);
}

function parseApplicationDate(value) {
  const text = cleanString(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let year;
  let month;
  let day;

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    year = Number(map.year);
    month = Number(map.month);
    day = Number(map.day);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!valid) throw new Error("Invalid application date.");

  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date);
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day: String(day),
    suffix: ordinalSuffix(day),
    monthYear: `${monthName}, ${year}`,
  };
}

function replaceTokens(xml, replacements = {}) {
  let output = xml;
  Object.entries(replacements).forEach(([token, value]) => {
    output = output.split(token).join(xmlEscape(value));
  });
  return output;
}

async function generateDayOffApplicationDocument({ routine, dayOffLabel, applicationDate }) {
  const friday = buildFridayClassSentence(routine);
  if (!friday.count) throw new Error("No Friday classes were found in the saved routine.");

  const date = parseApplicationDate(applicationDate);
  const bodyBeforeDay = [
    `I would like to state that I am ${cleanString(routine.facultyName)}, ${cleanString(routine.designation, "Lecturer")}, ${bodyDepartment(routine.department)} at your esteemed university.`,
    `On Friday I have ${numberWord(friday.count)} ${friday.count === 1 ? "class" : "classes"}, ${friday.text}.`,
    "But I have no classes scheduled on",
  ].join(" ");

  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));
  const documentPath = "word/document.xml";
  let xml = await zip.file(documentPath).async("string");
  xml = replaceTokens(xml, {
    "{{DATE_DAY}}": date.day,
    "{{DATE_SUFFIX}}": date.suffix,
    "{{DATE_MONTH_YEAR}}": date.monthYear,
    "{{DAY_OFF}}": cleanString(dayOffLabel),
    "{{BODY_BEFORE_DAY}}": bodyBeforeDay,
    "{{FACULTY_NAME}}": cleanString(routine.facultyName),
    "{{DESIGNATION}}": cleanString(routine.designation, "Lecturer"),
    "{{FACULTY_EMAIL}}": cleanString(routine.facultyEmail),
    "{{DEPARTMENT_FULL}}": fullDepartment(routine.department),
  });

  zip.file(documentPath, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function safeFilenamePart(value = "") {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Faculty";
}

function buildDayOffApplicationFilename(routine, dayOffLabel, applicationDate) {
  const code = safeFilenamePart(routine.facultyCode || routine.facultyName || "Faculty");
  const day = safeFilenamePart(dayOffLabel || "Day_Off");
  const date = parseApplicationDate(applicationDate).iso;
  return `${code}_Day_Off_Application_${day}_${date}.docx`;
}

module.exports = {
  generateDayOffApplicationDocument,
  buildDayOffApplicationFilename,
  buildFridayClassSentence,
  getFridayCourseGroups,
};
