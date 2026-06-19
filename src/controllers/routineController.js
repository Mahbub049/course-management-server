const Routine = require("../models/Routine");
const Enrollment = require("../models/Enrollment");
const CounsellingBooking = require("../models/CounsellingBooking");

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function normalizeCounsellingSlots(counsellingSlots, days, timeSlots, cells) {
  const raw = Array.isArray(counsellingSlots) ? counsellingSlots : [];
  const daySet = new Set(days);
  const slotSet = new Set(timeSlots.map((slot) => slot.id));
  const seen = new Set();
  const result = [];

  raw.forEach((item) => {
    const day = cleanString(item?.day);
    const slotId = cleanString(item?.slotId || item?.id);
    const key = `${day}__${slotId}`;

    if (!daySet.has(day) || !slotSet.has(slotId) || seen.has(key)) return;

    // Counselling hour must be selected from a routine slot that is free from class.
    if (cleanString(cells?.[day]?.[slotId])) return;

    seen.add(key);
    result.push({ day, slotId });
  });

  return result.slice(0, 30);
}

function normalizePayload(body = {}) {
  const days = normalizeDays(body.days);
  const timeSlots = normalizeTimeSlots(body.timeSlots);
  const cells = normalizeCells(body.cells, days, timeSlots);

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
    cells,
    courses: normalizeCourses(body.courses),
    counsellingSlots: normalizeCounsellingSlots(
      body.counsellingSlots,
      days,
      timeSlots,
      cells
    ),
    sourceFileName: cleanString(body.sourceFileName),
    importedAt: body.importedAt ? new Date(body.importedAt) : new Date(),
  };
}

function formatBooking(booking) {
  const student = booking.student && typeof booking.student === "object"
    ? booking.student
    : null;

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
    student: student
      ? {
          id: student._id?.toString?.() || "",
          name: student.name || "",
          roll: student.username || "",
          profileImage: student.profileImage || "",
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

async function resolveStudentTeacher(studentId) {
  const enrollments = await Enrollment.find({ student: studentId })
    .populate({
      path: "course",
      select: "code title section archived createdBy",
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

  return {
    teacherId,
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
      section: course.section || "",
    })),
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

const getStudentCounsellingInfo = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { teacherId, teacher, courses } = await resolveStudentTeacher(studentId);

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
      Routine.findOne({ teacher: teacherId }).lean(),
      CounsellingBooking.find({ student: studentId, teacher: teacherId })
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
      bookings: bookings.map(formatBooking),
    });
  } catch (err) {
    console.error("getStudentCounsellingInfo error:", err);
    return res.status(500).json({ message: "Failed to load counselling information" });
  }
};

const createStudentCounsellingBooking = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { teacherId, teacher } = await resolveStudentTeacher(studentId);

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

    const routine = await Routine.findOne({ teacher: teacherId }).lean();
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
      Routine.findOne({ teacher: teacherId }).lean(),
      CounsellingBooking.find({ teacher: teacherId })
        .populate("student", "name username profileImage")
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    return res.json({
      counsellingSlots: formatCounsellingSlots(routine),
      timeSlots: formatRoutineTimeSlots(routine),
      bookings: bookings.map(formatBooking),
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

      const routine = await Routine.findOne({ teacher: teacherId }).lean();
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
  getMyRoutine,
  saveMyRoutine,
  getStudentCounsellingInfo,
  createStudentCounsellingBooking,
  deleteStudentCounsellingBooking,
  getTeacherCounsellingBookings,
  updateTeacherCounsellingBooking,
  deleteTeacherCounsellingBooking,
};
