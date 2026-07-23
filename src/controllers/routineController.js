const mongoose = require("mongoose");
const Routine = require("../models/Routine");
const Enrollment = require("../models/Enrollment");
const CounsellingBooking = require("../models/CounsellingBooking");
const User = require("../models/User");
const Course = require("../models/Course");
const { sendMail } = require("../utils/mailer");
const {
  OFFICIAL_DAYS,
  OFFICIAL_TIME_SLOTS,
  PRAYER_LUNCH,
  ACTIVITY_TYPES,
  DEFAULT_ROOMS,
  cleanString,
  normalizeDays,
  normalizeWorkingDays,
  normalizeRooms,
  normalizeEntries,
  repairLegacyClassFields,
  validateRoutine,
  buildLegacyCells,
  buildCounsellingSlots,
} = require("../utils/routineRules");
const {
  generateRoutineDocument,
  generateNameplateDocument,
  buildDownloadFilename,
} = require("../utils/routineDocumentGenerator");

const DEFAULT_DAYS = OFFICIAL_DAYS.map((item) => item.id);
const DEFAULT_TIME_SLOTS = OFFICIAL_TIME_SLOTS;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function normalizeCourseDirectory(courses = []) {
  return (Array.isArray(courses) ? courses : []).map((course) => ({
    id: course._id?.toString?.() || course.id?.toString?.() || "",
    code: cleanString(course.code).toUpperCase(),
    title: cleanString(course.title),
    intake: cleanString(course.intake),
    section: cleanString(course.section),
    courseType: ["theory", "lab", "hybrid"].includes(cleanString(course.courseType).toLowerCase())
      ? cleanString(course.courseType).toLowerCase()
      : "theory",
    semester: cleanString(course.semester),
    year: Number(course.year) || null,
    shift: cleanString(course.shift),
    department: cleanString(course.department),
  }));
}

function parseLegacyCell(value, courses = []) {
  const lines = String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const activityMap = {
    CH: "CH",
    DM: "DM",
    DCW: "DCW",
    IS: "IS",
    "OBEI-W": "OBEI_W",
    OBEI_W: "OBEI_W",
    RW: "RW",
  };
  const first = lines[0].toUpperCase();
  if (activityMap[first]) return { type: activityMap[first], label: first === "OBEI_W" ? "OBEI-W" : first };

  const code = lines[0].toUpperCase();
  const room = lines[1] || "";
  const intakeSection = (lines[2] || "").split(/[\/-]/).map((item) => item.trim()).filter(Boolean);
  const course = courses.find((item) => {
    if (item.code !== code) return false;
    if (intakeSection[0] && item.intake && item.intake !== intakeSection[0]) return false;
    if (intakeSection[1] && item.section && item.section !== intakeSection[1]) return false;
    return true;
  });

  return {
    type: "CLASS",
    courseId: course?.id || "",
    courseCode: code,
    courseTitle: course?.title || "",
    intake: intakeSection[0] || course?.intake || "",
    section: intakeSection[1] || course?.section || "",
    room,
    courseType: course?.courseType || "theory",
    courseShift: course?.shift || "",
    linkedGroupId: "",
    secondLabDayConfirmed: false,
  };
}

const LEGACY_CELL_SLOT_MAP_9 = {
  slot_1: "day_0815_0945", slot_2: "day_0945_1115", slot_3: "day_1115_1245",
  slot_4: "day_1315_1445", slot_5: "day_1445_1615", slot_6: "day_1615_1745",
  slot_7: "eve_1745_1900", slot_8: "eve_1900_2015", slot_9: "eve_2015_2130",
};
const LEGACY_CELL_SLOT_MAP_7 = {
  slot_1: "day_0815_0945", slot_2: "day_1115_1245", slot_3: "day_1315_1445",
  slot_4: "day_1615_1745", slot_5: "eve_1745_1900", slot_6: "eve_1900_2015",
  slot_7: "eve_2015_2130",
};

function upgradeLegacyEntries(routine, courses) {
  if (routine?.entries && Object.keys(routine.entries).length) return routine.entries;
  const entries = {};
  const cellKeys = Object.values(routine?.cells || {}).flatMap((day) => Object.keys(day || {}));
  const legacyMap = cellKeys.includes("slot_8") || cellKeys.includes("slot_9")
    ? LEGACY_CELL_SLOT_MAP_9
    : LEGACY_CELL_SLOT_MAP_7;
  const reverseLegacy = Object.fromEntries(Object.entries(legacyMap).map(([oldId, newId]) => [newId, oldId]));

  DEFAULT_DAYS.forEach((day) => {
    entries[day] = {};
    OFFICIAL_TIME_SLOTS.forEach((slot) => {
      const oldId = reverseLegacy[slot.id];
      const value = routine?.cells?.[day]?.[slot.id] || (oldId ? routine?.cells?.[day]?.[oldId] : "");
      entries[day][slot.id] = parseLegacyCell(value, courses);
    });
  });
  return entries;
}

function inferSemesterYear(courses = []) {
  const sorted = [...courses].sort((a, b) => {
    const yearDiff = (Number(b.year) || 0) - (Number(a.year) || 0);
    if (yearDiff) return yearDiff;
    const order = { Spring: 1, Summer: 2, Fall: 3 };
    return (order[b.semester] || 0) - (order[a.semester] || 0);
  });
  return { semester: sorted[0]?.semester || "", year: sorted[0]?.year || new Date().getFullYear() };
}

async function getRoutineContext(teacherId) {
  const [teacherResult, courseResult] = await Promise.allSettled([
    User.findById(teacherId)
      .select("name email phone department designation shortCode profileImage")
      .lean(),
    Course.find({ createdBy: teacherId, archived: { $ne: true } })
      .select("code title intake section courseType semester year shift department")
      .sort({ year: -1, semester: -1, code: 1 })
      .lean(),
  ]);

  if (teacherResult.status === "rejected") console.warn("Routine profile lookup failed:", teacherResult.reason?.message);
  if (courseResult.status === "rejected") console.warn("Routine course lookup failed:", courseResult.reason?.message);

  return {
    teacher: teacherResult.status === "fulfilled" ? teacherResult.value : null,
    courses: normalizeCourseDirectory(courseResult.status === "fulfilled" ? courseResult.value : []),
  };
}

async function findRoutineRaw(teacherId) {
  const teacher = mongoose.isValidObjectId(teacherId)
    ? new mongoose.Types.ObjectId(teacherId)
    : teacherId;
  const routine = await Routine.collection.findOne({ teacher });
  if (routine || String(teacher) === String(teacherId)) return routine;
  return Routine.collection.findOne({ teacher: String(teacherId) });
}

function courseSnapshotKey(course = {}) {
  return [course.code || course.courseCode, course.intake, course.section]
    .map((value) => cleanString(value).toLowerCase())
    .join("|");
}

function applyCourseMetadata(entries, courses = []) {
  const byId = new Map(courses.map((course) => [cleanString(course.id), course]));
  const bySnapshot = new Map(courses.map((course) => [courseSnapshotKey(course), course]));
  const byCode = new Map();
  courses.forEach((course) => {
    const code = cleanString(course.code).toLowerCase();
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(course);
  });

  Object.values(entries || {}).forEach((dayEntries) => {
    Object.values(dayEntries || {}).forEach((entry) => {
      if (!entry || entry.type !== "CLASS") return;

      Object.assign(entry, repairLegacyClassFields(entry));
      const exactSnapshot = bySnapshot.get(courseSnapshotKey(entry));
      const exactId = byId.get(cleanString(entry.courseId));
      const sameCode = byCode.get(cleanString(entry.courseCode).toLowerCase()) || [];
      const partialMatch = sameCode.find((course) => {
        const intakeMatches = !entry.intake || !course.intake || cleanString(course.intake).toLowerCase() === cleanString(entry.intake).toLowerCase();
        const sectionMatches = !entry.section || !course.section || cleanString(course.section).toLowerCase() === cleanString(entry.section).toLowerCase();
        return intakeMatches && sectionMatches;
      });
      const course = exactSnapshot || exactId || partialMatch || (sameCode.length === 1 ? sameCode[0] : null);
      if (!course) return;

      // Canonicalize every cell in the pair. This repairs old routines where
      // only one auto-filled lab cell retained the courseId or where room and
      // intake/section were stored in the opposite fields.
      entry.courseId = course.id || entry.courseId || "";
      entry.courseCode = course.code || entry.courseCode || "";
      entry.courseTitle = course.title || entry.courseTitle || "";
      entry.intake = course.intake || entry.intake || "";
      entry.section = course.section || entry.section || "";
      entry.courseShift = course.shift || entry.courseShift || "";
      entry.courseType = course.courseType || entry.courseType || "theory";
    });
  });
  return entries;
}

function normalizePayload(body = {}, context = {}) {
  const days = normalizeDays(body.days);
  const workingDays = normalizeWorkingDays(body.workingDays, days);
  const rooms = normalizeRooms(body.rooms);
  const courses = context.courses || normalizeCourseDirectory(body.courses || []);
  const entries = applyCourseMetadata(normalizeEntries(body.entries, days, workingDays), courses);
  const teacher = context.teacher || {};
  const inferred = inferSemesterYear(courses);
  const semester = cleanString(body.semester, inferred.semester);
  const year = Number(body.year || inferred.year);
  const validation = validateRoutine({ days, workingDays, entries, semester, year, rooms });
  const facultyDepartment = cleanString(teacher.department || body.department, "Department of Computer Science and Engineering");

  return {
    title: "Class Routine and Weekly Activities",
    universityName: "Bangladesh University of Business and Technology (BUBT)",
    facultyName: cleanString(teacher.name || body.facultyName),
    facultyCode: cleanString(teacher.shortCode || body.facultyCode),
    designation: cleanString(teacher.designation || body.designation, "Lecturer"),
    department: facultyDepartment,
    facultyEmail: cleanString(teacher.email || body.facultyEmail),
    facultyPhone: cleanString(teacher.phone || body.facultyPhone),
    facultyProfileImage: cleanString(teacher.profileImage || body.facultyProfileImage),
    semester,
    year,
    days,
    workingDays,
    timeSlots: OFFICIAL_TIME_SLOTS,
    rooms,
    entries,
    cells: buildLegacyCells(entries, days),
    courses,
    counsellingSlots: buildCounsellingSlots(entries, workingDays),
    validation: {
      canSave: validation.canSave,
      isValid: validation.isValid,
      blockingErrors: validation.blockingErrors,
      completionErrors: validation.completionErrors,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: validation.summary,
    },
    totalWorkingHours: validation.summary.totalWorkingHours,
    sourceFileName: "",
    importedAt: new Date(),
  };
}

function routineDefaults(context = {}) {
  const inferred = inferSemesterYear(context.courses || []);
  return {
    days: DEFAULT_DAYS,
    workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu"],
    timeSlots: OFFICIAL_TIME_SLOTS,
    prayerLunch: PRAYER_LUNCH,
    activityTypes: ACTIVITY_TYPES,
    rooms: DEFAULT_ROOMS,
    semester: inferred.semester,
    year: inferred.year,
  };
}

function buildCourseInfo(booking = {}) {
  const course = booking.course && typeof booking.course === "object" ? booking.course : null;
  const courseId =
    course?._id?.toString?.() ||
    course?.id?.toString?.() ||
    (booking.course && typeof booking.course !== "object" ? booking.course.toString() : "");

  const info = {
    id: courseId,
    code: cleanString(booking.courseCode || course?.code),
    title: cleanString(booking.courseTitle || course?.title),
    intake: cleanString(booking.intake || course?.intake),
    section: cleanString(booking.section || course?.section),
  };

  return info;
}

function hasCourseInfo(courseInfo = {}) {
  return Boolean(
    courseInfo.id ||
      courseInfo.code ||
      courseInfo.title ||
      courseInfo.intake ||
      courseInfo.section
  );
}

function formatBooking(booking) {
  const student = booking.student && typeof booking.student === "object"
    ? booking.student
    : null;
  const courseInfo = buildCourseInfo(booking);
  const hasAcademicInfo = hasCourseInfo(courseInfo);

  return {
    id: booking._id.toString(),
    date: booking.date,
    day: booking.day,
    slotId: booking.slotId,
    slotLabel: booking.slotLabel || "",
    start: booking.start || "",
    end: booking.end || "",
    topic: booking.topic || "",
    message: booking.message || "",
    status: booking.status || "pending",
    teacherMessage: booking.teacherMessage || "",
    alternateDate: booking.alternateDate || "",
    alternateDay: booking.alternateDay || "",
    alternateSlotId: booking.alternateSlotId || "",
    alternateSlotLabel: booking.alternateSlotLabel || "",
    alternateStart: booking.alternateStart || "",
    alternateEnd: booking.alternateEnd || "",
    respondedAt: booking.respondedAt || null,
    createdAt: booking.createdAt || null,
    intake: courseInfo.intake,
    section: courseInfo.section,
    course: hasAcademicInfo ? courseInfo : undefined,
    student: student
      ? {
          id: student._id?.toString?.() || "",
          name: student.name || "",
          roll: student.username || "",
          profileImage: student.profileImage || "",
          intake: courseInfo.intake,
          section: courseInfo.section,
          course: hasAcademicInfo ? courseInfo : undefined,
        }
      : undefined,
  };
}

function getDateDayName(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(date.getTime())) return "";
  return DAY_NAMES[date.getUTCDay()] || "";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatReadableDate(dateString = "") {
  if (!dateString) return "Selected counselling date";
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function notifyTeacherAboutCounsellingRequest({ teacher, student, booking }) {
  const teacherEmail = cleanString(teacher?.email).toLowerCase();

  if (!teacherEmail || !process.env.BREVO_API_KEY) {
    return;
  }

  const portalUrl = cleanString(process.env.CLIENT_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const counsellingUrl = portalUrl ? `${portalUrl}/teacher/counselling` : "";
  const studentName = student?.name || "A student";
  const studentRoll = student?.username || "";
  const academicText = [
    booking.intake ? `Intake ${booking.intake}` : "",
    booking.section ? `Section ${booking.section}` : "",
    booking.courseCode || "",
  ].filter(Boolean).join(" · ");
  const timeText = [booking.start, booking.end].filter(Boolean).join(" - ");
  const subject = `New counselling request from ${studentName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h2 style="margin: 0 0 12px; color: #047857;">New counselling request</h2>
      <p>Dear ${escapeHtml(teacher?.name || "Teacher")},</p>
      <p>You have received a new counselling request in the Marks Portal.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; margin: 18px 0;">
        <p style="margin: 0 0 8px;"><strong>Student:</strong> ${escapeHtml(studentName)}${studentRoll ? ` (${escapeHtml(studentRoll)})` : ""}</p>
        ${academicText ? `<p style="margin: 0 0 8px;"><strong>Academic:</strong> ${escapeHtml(academicText)}</p>` : ""}
        <p style="margin: 0 0 8px;"><strong>Date:</strong> ${escapeHtml(formatReadableDate(booking.date))}</p>
        <p style="margin: 0 0 8px;"><strong>Time:</strong> ${escapeHtml(timeText || booking.slotLabel || "Selected slot")}</p>
        <p style="margin: 0 0 8px;"><strong>Topic:</strong> ${escapeHtml(booking.topic)}</p>
        ${booking.message ? `<p style="margin: 0;"><strong>Message:</strong> ${escapeHtml(booking.message)}</p>` : ""}
      </div>
      ${counsellingUrl ? `<p><a href="${escapeHtml(counsellingUrl)}" style="display: inline-block; background: #059669; color: #ffffff; padding: 10px 16px; border-radius: 10px; text-decoration: none; font-weight: 700;">Open counselling requests</a></p>` : ""}
      <p style="font-size: 13px; color: #64748b;">This is an automatic notification from BUBT Marks Portal.</p>
    </div>
  `;

  const text = [
    `Dear ${teacher?.name || "Teacher"},`,
    "You have received a new counselling request in the Marks Portal.",
    `Student: ${studentName}${studentRoll ? ` (${studentRoll})` : ""}`,
    academicText ? `Academic: ${academicText}` : "",
    `Date: ${formatReadableDate(booking.date)}`,
    `Time: ${timeText || booking.slotLabel || "Selected slot"}`,
    `Topic: ${booking.topic}`,
    booking.message ? `Message: ${booking.message}` : "",
    counsellingUrl ? `Open: ${counsellingUrl}` : "",
  ].filter(Boolean).join("\n");

  try {
    await sendMail({
      to: teacherEmail,
      subject,
      html,
      text,
    });
  } catch (error) {
    console.error("Counselling email notification failed:", error.message);
  }
}

function getSlotInfo(routine, day, slotId) {
  if (!routine || !day || !slotId) return null;

  const hasCounsellingSlot = (routine.counsellingSlots || []).some(
    (item) => item.day === day && item.slotId === slotId
  );

  if (!hasCounsellingSlot) return null;

  const classCell = cleanString(routine.cells?.[day]?.[slotId]);
  if (classCell) return null;

  const slot = (routine.timeSlots || []).find((item) => item.id === slotId);
  if (!slot) return null;

  return {
    day,
    slotId,
    slotLabel: slot.label || "",
    start: slot.start || "",
    end: slot.end || "",
  };
}

function getRoutineTimeSlot(routine, slotId) {
  const sourceSlots = routine?.timeSlots?.length ? routine.timeSlots : DEFAULT_TIME_SLOTS;
  const slot = sourceSlots.find((item) => item.id === slotId);

  if (!slot) return null;

  return {
    slotId: slot.id,
    slotLabel: slot.label || "",
    start: slot.start || "",
    end: slot.end || "",
    shift: slot.shift || "",
  };
}

function formatRoutineTimeSlots(routine) {
  const sourceSlots = routine?.timeSlots?.length ? routine.timeSlots : DEFAULT_TIME_SLOTS;

  return sourceSlots.map((slot, index) => ({
    id: slot.id || `slot_${index + 1}`,
    slotId: slot.id || `slot_${index + 1}`,
    label: slot.label || `Slot ${index + 1}`,
    slotLabel: slot.label || `Slot ${index + 1}`,
    start: slot.start || "",
    end: slot.end || "",
    shift: slot.shift || "",
  }));
}

function formatCounsellingSlots(routine) {
  if (!routine) return [];

  return (routine.counsellingSlots || [])
    .map((item) => getSlotInfo(routine, item.day, item.slotId))
    .filter(Boolean)
    .sort((a, b) => {
      const dayDiff = DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
      const aIndex = (routine.timeSlots || []).findIndex((slot) => slot.id === a.slotId);
      const bIndex = (routine.timeSlots || []).findIndex((slot) => slot.id === b.slotId);
      return aIndex - bIndex;
    });
}

function getStudentIdFromBooking(booking = {}) {
  return booking.student?._id?.toString?.() || booking.student?.toString?.() || "";
}

function getCourseSnapshot(course = {}) {
  if (!course) return null;

  return {
    id: course._id?.toString?.() || "",
    code: course.code || "",
    title: course.title || "",
    intake: course.intake || "",
    section: course.section || "",
  };
}

async function getCourseContextByStudent(studentIds = [], teacherId) {
  const uniqueStudentIds = [...new Set(studentIds.map(String).filter(Boolean))];
  if (!uniqueStudentIds.length || !teacherId) return new Map();

  const enrollments = await Enrollment.find({ student: { $in: uniqueStudentIds } })
    .populate({
      path: "course",
      select: "code title intake section archived createdBy",
    })
    .sort({ createdAt: -1 })
    .lean();

  const byStudent = new Map();
  enrollments.forEach((enrollment) => {
    const course = enrollment.course;
    if (!course || course.archived === true || String(course.createdBy) !== String(teacherId)) return;

    const studentId = enrollment.student?.toString?.() || "";
    if (!studentId || byStudent.has(studentId)) return;

    byStudent.set(studentId, getCourseSnapshot(course));
  });

  return byStudent;
}

function applyCourseContext(booking = {}, courseByStudent = new Map()) {
  const studentId = getStudentIdFromBooking(booking);
  const fallbackCourse = courseByStudent.get(studentId) || null;
  const storedCourse = booking.course && typeof booking.course === "object" ? getCourseSnapshot(booking.course) : null;
  const courseInfo = {
    ...(fallbackCourse || {}),
    ...(storedCourse || {}),
    code: cleanString(booking.courseCode || storedCourse?.code || fallbackCourse?.code),
    title: cleanString(booking.courseTitle || storedCourse?.title || fallbackCourse?.title),
    intake: cleanString(booking.intake || storedCourse?.intake || fallbackCourse?.intake),
    section: cleanString(booking.section || storedCourse?.section || fallbackCourse?.section),
  };

  return {
    ...booking,
    course: booking.course || fallbackCourse || null,
    courseCode: courseInfo.code,
    courseTitle: courseInfo.title,
    intake: courseInfo.intake,
    section: courseInfo.section,
  };
}

async function resolveStudentTeacher(studentId) {
  const enrollments = await Enrollment.find({ student: studentId })
    .populate({
      path: "course",
      select: "code title section intake archived createdBy",
      populate: {
        path: "createdBy",
        select: "name email department designation profileImage",
      },
    })
    .lean();

  const activeCourses = enrollments
    .map((item) => item.course)
    .filter((course) => course && course.archived !== true && course.createdBy);

  if (!activeCourses.length) {
    return { teacher: null, courses: [] };
  }

  const firstCourse = activeCourses[0];
  const teacher = firstCourse.createdBy;
  const teacherId = teacher?._id || teacher;
  const selectedCourse = getCourseSnapshot(firstCourse);

  return {
    teacherId,
    selectedCourse,
    teacher: teacher && typeof teacher === "object"
      ? {
          id: teacher._id?.toString?.() || String(teacherId),
          name: teacher.name || "Course Teacher",
          email: teacher.email || "",
          department: teacher.department || "",
          designation: teacher.designation || "",
          profileImage: teacher.profileImage || "",
        }
      : {
          id: String(teacherId),
          name: "Course Teacher",
          email: "",
          department: "",
          designation: "",
          profileImage: "",
        },
    courses: activeCourses.map((course) => ({
      id: course._id.toString(),
      code: course.code || "",
      title: course.title || "",
      intake: course.intake || "",
      section: course.section || "",
    })),
  };
}

const getRoutineReferenceData = async (_req, res) => {
  return res.json({
    universityName: "Bangladesh University of Business and Technology (BUBT)",
    days: OFFICIAL_DAYS,
    timeSlots: OFFICIAL_TIME_SLOTS,
    prayerLunch: PRAYER_LUNCH,
    rooms: DEFAULT_ROOMS,
    buildings: [...new Set(DEFAULT_ROOMS.map((room) => room.buildingName))],
    roomTypes: [...new Set(DEFAULT_ROOMS.map((room) => room.roomTitle))],
  });
};

const getMyRoutine = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const [routineDoc, context] = await Promise.all([
      findRoutineRaw(teacherId),
      getRoutineContext(teacherId),
    ]);

    const defaults = routineDefaults(context);
    const profile = {
      name: context.teacher?.name || "",
      email: context.teacher?.email || "",
      phone: context.teacher?.phone || "",
      department: context.teacher?.department || "",
      designation: context.teacher?.designation || "",
      shortCode: context.teacher?.shortCode || "",
      profileImage: context.teacher?.profileImage || "",
    };

    if (!routineDoc) {
      return res.json({ routine: null, defaults, profile, courses: context.courses });
    }

    const source = {
      ...routineDoc,
      entries: upgradeLegacyEntries(routineDoc, context.courses),
      courses: context.courses,
      rooms: routineDoc.rooms?.length ? routineDoc.rooms : DEFAULT_ROOMS,
      days: routineDoc.days?.length ? routineDoc.days : DEFAULT_DAYS,
      workingDays: routineDoc.workingDays?.length
        ? routineDoc.workingDays
        : ["Sun", "Mon", "Tue", "Wed", "Thu"],
      semester: routineDoc.semester || defaults.semester,
      year: routineDoc.year || defaults.year,
      facultyPhone: routineDoc.facultyPhone || context.teacher?.phone || "",
    };
    const routine = normalizePayload(source, context);
    routine._id = routineDoc._id;
    routine.createdAt = routineDoc.createdAt;
    routine.updatedAt = routineDoc.updatedAt;

    return res.json({ routine, defaults, profile, courses: context.courses });
  } catch (err) {
    console.error("getMyRoutine error:", err);
    return res.status(500).json({ message: "Failed to load routine" });
  }
};

const saveMyRoutine = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const context = await getRoutineContext(teacherId);
    const update = normalizePayload(req.body, context);

    if (!update.validation.canSave) {
      return res.status(400).json({
        message: "Please correct the highlighted routine conflicts before saving.",
        validation: update.validation,
      });
    }

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

async function downloadMyRoutineDocument(req, res, kind) {
  try {
    const teacherId = req.user.userId;
    const [routineDoc, context] = await Promise.all([
      findRoutineRaw(teacherId),
      getRoutineContext(teacherId),
    ]);

    if (!routineDoc) return res.status(404).json({ message: "Create and save the routine first." });

    const routine = normalizePayload(
      {
        ...routineDoc,
        entries: upgradeLegacyEntries(routineDoc, context.courses),
        courses: context.courses,
      },
      context
    );

    if (!routine.validation.isValid) {
      return res.status(409).json({
        message: "The saved routine does not meet all weekly rules.",
        validation: routine.validation,
      });
    }

    const buffer = kind === "nameplate"
      ? await generateNameplateDocument(routine)
      : await generateRoutineDocument(routine);
    const filename = buildDownloadFilename(routine, kind);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    console.error(`download ${kind} routine document error:`, err);
    return res.status(500).json({ message: "Failed to generate the Word document." });
  }
}

const downloadMyClassRoutine = (req, res) => downloadMyRoutineDocument(req, res, "routine");
const downloadMyFacultyNameplate = (req, res) => downloadMyRoutineDocument(req, res, "nameplate");

const getStudentCounsellingInfo = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { teacherId, teacher, courses, selectedCourse } = await resolveStudentTeacher(studentId);

    if (!teacherId) {
      return res.json({
        teacher: null,
        courses: [],
        routine: null,
        counsellingSlots: [],
        bookings: [],
      });
    }

    const [routine, bookings] = await Promise.all([
      findRoutineRaw(teacherId),
      CounsellingBooking.find({ student: studentId, teacher: teacherId })
        .populate("course", "code title intake section")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    return res.json({
      teacher,
      courses,
      routine: routine
        ? {
            id: routine._id.toString(),
            title: routine.title || "Class Routine",
            facultyName: routine.facultyName || teacher?.name || "",
            days: routine.days || [],
            timeSlots: routine.timeSlots || [],
          }
        : null,
      counsellingSlots: formatCounsellingSlots(routine),
      bookings: bookings.map((booking) =>
        formatBooking(applyCourseContext(booking, new Map([[String(studentId), selectedCourse]])))
      ),
    });
  } catch (err) {
    console.error("getStudentCounsellingInfo error:", err);
    return res.status(500).json({ message: "Failed to load counselling information" });
  }
};

const createStudentCounsellingBooking = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { teacherId, teacher, selectedCourse } = await resolveStudentTeacher(studentId);

    if (!teacherId) {
      return res.status(404).json({ message: "No course teacher found for this student" });
    }

    const date = cleanString(req.body?.date);
    const slotId = cleanString(req.body?.slotId);
    const topic = cleanString(req.body?.topic);
    const message = cleanString(req.body?.message);

    if (!date || !slotId || !topic) {
      return res.status(400).json({ message: "Date, time slot and topic are required" });
    }

    if (date < todayString()) {
      return res.status(400).json({ message: "Please select today or a future date" });
    }

    const day = getDateDayName(date);
    if (!day) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const routine = await findRoutineRaw(teacherId);
    const slotInfo = getSlotInfo(routine, day, slotId);

    if (!slotInfo) {
      return res.status(400).json({ message: "Selected time is not available for counselling" });
    }

    const existing = await CounsellingBooking.findOne({
      teacher: teacherId,
      student: studentId,
      date,
      slotId,
      status: { $in: ["pending", "approved", "alternate_suggested"] },
    }).lean();

    if (existing) {
      return res.status(409).json({
        message: "You already have a booking request for this date and time slot",
      });
    }

    const booking = await CounsellingBooking.create({
      teacher: teacherId,
      student: studentId,
      routine: routine?._id || null,
      course: selectedCourse?.id || null,
      courseCode: selectedCourse?.code || "",
      courseTitle: selectedCourse?.title || "",
      intake: selectedCourse?.intake || "",
      section: selectedCourse?.section || "",
      date,
      day,
      slotId,
      slotLabel: slotInfo.slotLabel,
      start: slotInfo.start,
      end: slotInfo.end,
      topic,
      message,
      status: "pending",
    });

    const student = await User.findById(studentId)
      .select("name username email")
      .lean();

    notifyTeacherAboutCounsellingRequest({
      teacher,
      student,
      booking: booking.toObject(),
    });

    return res.status(201).json({
      message: "Counselling request submitted",
      teacher,
      booking: formatBooking(booking.toObject()),
    });
  } catch (err) {
    console.error("createStudentCounsellingBooking error:", err);
    return res.status(500).json({ message: "Failed to submit counselling request" });
  }
};

const deleteStudentCounsellingBooking = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { bookingId } = req.params;

    const booking = await CounsellingBooking.findOne({
      _id: bookingId,
      student: studentId,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking request not found" });
    }

    if (booking.status !== "pending") {
      return res.status(403).json({
        message: "Only pending counselling requests can be deleted",
      });
    }

    await booking.deleteOne();

    return res.json({ message: "Counselling request deleted" });
  } catch (err) {
    console.error("deleteStudentCounsellingBooking error:", err);
    return res.status(500).json({ message: "Failed to delete counselling request" });
  }
};

const getTeacherCounsellingBookings = async (req, res) => {
  try {
    const teacherId = req.user.userId;

    const [routine, bookings] = await Promise.all([
      findRoutineRaw(teacherId),
      CounsellingBooking.find({ teacher: teacherId })
        .populate("student", "name username profileImage")
        .populate("course", "code title intake section")
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    const studentIds = bookings.map(getStudentIdFromBooking).filter(Boolean);
    const courseByStudent = await getCourseContextByStudent(studentIds, teacherId);
    const formattedBookings = bookings.map((booking) =>
      formatBooking(applyCourseContext(booking, courseByStudent))
    );

    return res.json({
      counsellingSlots: formatCounsellingSlots(routine),
      timeSlots: formatRoutineTimeSlots(routine),
      bookings: formattedBookings,
    });
  } catch (err) {
    console.error("getTeacherCounsellingBookings error:", err);
    return res.status(500).json({ message: "Failed to load counselling bookings" });
  }
};

const updateTeacherCounsellingBooking = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { bookingId } = req.params;
    const action = cleanString(req.body?.action || req.body?.status);
    const teacherMessage = cleanString(req.body?.teacherMessage);

    const booking = await CounsellingBooking.findOne({ _id: bookingId, teacher: teacherId });

    if (!booking) {
      return res.status(404).json({ message: "Booking request not found" });
    }

    if (action === "approved") {
      booking.status = "approved";
      booking.teacherMessage = teacherMessage;
      booking.respondedAt = new Date();
    } else if (action === "declined") {
      booking.status = "declined";
      booking.teacherMessage = teacherMessage;
      booking.respondedAt = new Date();
    } else if (action === "alternate_suggested") {
      const alternateDate = cleanString(req.body?.alternateDate);
      const alternateSlotId = cleanString(req.body?.alternateSlotId);

      if (!alternateDate || !alternateSlotId) {
        return res.status(400).json({
          message: "Alternate date and time slot are required",
        });
      }

      if (alternateDate < todayString()) {
        return res.status(400).json({ message: "Please select today or a future alternate date" });
      }

      const alternateDay = getDateDayName(alternateDate);
      if (!alternateDay) {
        return res.status(400).json({ message: "Invalid alternate date format" });
      }

      const routine = await findRoutineRaw(teacherId);
      const alternateSlot = getRoutineTimeSlot(routine, alternateSlotId);

      if (!alternateSlot) {
        return res.status(400).json({ message: "Alternate time slot was not found in the routine time slots" });
      }

      booking.status = "alternate_suggested";
      booking.teacherMessage = teacherMessage;
      booking.alternateDate = alternateDate;
      booking.alternateDay = alternateDay;
      booking.alternateSlotId = alternateSlotId;
      booking.alternateSlotLabel = alternateSlot.slotLabel;
      booking.alternateStart = alternateSlot.start;
      booking.alternateEnd = alternateSlot.end;
      booking.respondedAt = new Date();
    } else {
      return res.status(400).json({ message: "Invalid booking action" });
    }

    await booking.save();
    await booking.populate("student", "name username profileImage");
    await booking.populate("course", "code title intake section");

    return res.json({
      message: "Counselling booking updated",
      booking: formatBooking(booking.toObject()),
    });
  } catch (err) {
    console.error("updateTeacherCounsellingBooking error:", err);
    return res.status(500).json({ message: "Failed to update counselling booking" });
  }
};


const deleteTeacherCounsellingBooking = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { bookingId } = req.params;

    const booking = await CounsellingBooking.findOne({
      _id: bookingId,
      teacher: teacherId,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking request not found" });
    }

    await booking.deleteOne();

    return res.json({ message: "Counselling booking deleted" });
  } catch (err) {
    console.error("deleteTeacherCounsellingBooking error:", err);
    return res.status(500).json({ message: "Failed to delete counselling booking" });
  }
};

module.exports = {
  getRoutineReferenceData,
  getMyRoutine,
  saveMyRoutine,
  downloadMyClassRoutine,
  downloadMyFacultyNameplate,
  getStudentCounsellingInfo,
  createStudentCounsellingBooking,
  deleteStudentCounsellingBooking,
  getTeacherCounsellingBookings,
  updateTeacherCounsellingBooking,
  deleteTeacherCounsellingBooking,
};
