const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");

function parseYMD(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return { y, m, d };
}

// ✅ Always store the exact day as UTC midnight
function dateOnly(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

// ✅ Day range in UTC (safe for queries)
function dayRange(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  return { start, end };
}


// -------------------- CREATE (single period) --------------------
const createAttendance = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) {
      return res.status(401).json({ message: "Unauthorized: teacher not found" });
    }

    const { courseId, date, period, records } = req.body;

    if (!courseId || !date || !period || !Array.isArray(records)) {
      return res
        .status(400)
        .json({ message: "courseId, date, period and records are required" });
    }

    // ensure teacher owns course
    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) {
      return res.status(404).json({ message: "Course not found for this teacher" });
    }

    const docDate = dateOnly(date);
    const p = Number(period);

    // avoid duplicates
    const exists = await Attendance.findOne({
      teacher: teacherId,
      course: courseId,
      date: docDate,
      period: p,
    });

    if (exists) {
      return res
        .status(409)
        .json({ message: `Attendance already exists for Period ${p} on this date.` });
    }

    const attendance = await Attendance.create({
      teacher: teacherId,
      course: courseId,
      section: course.section,
      date: docDate,
      period: p,
      numClasses: 1, // each doc is one class now
      records: records.map((r) => ({
        roll: String(r.roll),
        present: !!r.present,
      })),
    });

    res.status(201).json(attendance);
  } catch (err) {
    console.error("createAttendance error:", err);
    res.status(500).json({ message: "Failed to save attendance" });
  }
};

// -------------------- CREATE (bulk periods) --------------------
// POST /api/attendance/bulk
// body: { courseId, date, periods?: [1,2], numClasses?:2, startPeriod?:1, records:[] }
const createAttendanceBulk = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId, date, periods, numClasses, startPeriod, records } = req.body;

    if (!courseId || !date || !Array.isArray(records)) {
      return res.status(400).json({ message: "courseId, date and records are required" });
    }

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    const docDate = dateOnly(date);

    let periodList = [];
    if (Array.isArray(periods) && periods.length) {
      periodList = periods.map(Number).filter((x) => x >= 1);
    } else {
      const n = Number(numClasses || 0);
      const sp = Number(startPeriod || 1);
      if (!n || n < 1) {
        return res.status(400).json({ message: "Provide periods[] or numClasses (>=1)" });
      }
      periodList = Array.from({ length: n }, (_, i) => sp + i);
    }

    // create docs for each period
    const toInsert = periodList.map((p) => ({
      teacher: teacherId,
      course: courseId,
      section: course.section,
      date: docDate,
      period: Number(p),
      numClasses: 1,
      records: records.map((r) => ({
        roll: String(r.roll),
        present: !!r.present,
      })),
    }));

    // insertMany with ordered:false so duplicates don't stop all inserts
    let inserted = [];
    let skipped = [];

    for (const p of periodList) {
      const ex = await Attendance.findOne({
        teacher: teacherId,
        course: courseId,
        date: docDate,
        period: Number(p),
      });
      if (ex) skipped.push(Number(p));
    }

    const insertActual = toInsert.filter((d) => !skipped.includes(d.period));

    if (insertActual.length) {
      inserted = await Attendance.insertMany(insertActual, { ordered: false });
    }

    return res.status(201).json({
      message: "Bulk attendance processed",
      createdPeriods: inserted.map((d) => d.period).sort((a, b) => a - b),
      skippedPeriods: skipped.sort((a, b) => a - b),
    });
  } catch (err) {
    console.error("createAttendanceBulk error:", err);
    return res.status(500).json({ message: "Failed to save bulk attendance" });
  }
};

// -------------------- SHEET (teacher) --------------------
// Now returns sessions (date+period) instead of dates[] only
const getAttendanceSheet = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ message: "courseId is required" });

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    const attendanceDocs = await Attendance.find({
      teacher: teacherId,
      course: course._id,
    }).sort({ date: 1, period: 1 });

    // ✅ Build sessions = [{key,date,period,label}]
    // Legacy docs: if no period, expand numClasses -> periods 1..numClasses
    const sessions = [];
    const expanded = []; // {dateStr, period, records}

    attendanceDocs.forEach((a) => {
      const dStr = a.date.toISOString().slice(0, 10);

      if (a.period && Number(a.period) >= 1) {
        expanded.push({ dateStr: dStr, period: Number(a.period), records: a.records || [] });
      } else {
        const n = Number(a.numClasses || 1);
        for (let p = 1; p <= n; p++) {
          expanded.push({ dateStr: dStr, period: p, records: a.records || [] });
        }
      }
    });

    // sort expanded by date then period
    expanded.sort((a, b) => {
      if (a.dateStr < b.dateStr) return -1;
      if (a.dateStr > b.dateStr) return 1;
      return a.period - b.period;
    });

    expanded.forEach((x) => {
      const key = `${x.dateStr}|P${x.period}`;
      sessions.push({
        key,
        date: x.dateStr,
        period: x.period,
        label: `${x.dateStr} (P${x.period})`,
      });
    });

    // students
    const enrollments = await Enrollment.find({ course: course._id })
      .populate("student", "username name")
      .sort({ "student.username": 1 });

    let students = enrollments.map((e) => ({
      roll: String(e.student.username),
      name: e.student.name,
    }));

    // fallback if enrollments empty but attendance exists
    if (!students.length) {
      const rollSet = new Set();
      expanded.forEach((x) => {
        (x.records || []).forEach((r) => r?.roll && rollSet.add(String(r.roll)));
      });
      students = Array.from(rollSet).sort().map((roll) => ({ roll, name: "" }));
    }

    // matrix[roll][sessionKey] = boolean
    const matrix = {};
    students.forEach((s) => (matrix[s.roll] = {}));

    expanded.forEach((x) => {
      const key = `${x.dateStr}|P${x.period}`;
      (x.records || []).forEach((r) => {
        const roll = String(r.roll);
        if (!matrix[roll]) matrix[roll] = {};
        matrix[roll][key] = !!r.present;
      });
    });

    return res.json({
      course: {
        id: course._id,
        code: course.code,
        title: course.title,
        section: course.section,
        year: course.year,
        semester: course.semester,
      },
      students,
      sessions,
      matrix,
    });
  } catch (err) {
    console.error("getAttendanceSheet error:", err);
    return res.status(500).json({ message: "Failed to generate attendance sheet" });
  }
};

// -------------------- SHEET (student) --------------------
const getStudentAttendanceSheet = async (req, res) => {
  try {
    const studentId = req.user?.userId || req.user?.id;
    if (!studentId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ message: "courseId is required" });

    const studentUser = await User.findById(studentId).select("username name role");
    if (!studentUser || studentUser.role !== "student") {
      return res.status(403).json({ message: "Student access only" });
    }

    const roll = String(studentUser.username);

    const enrolled = await Enrollment.findOne({ course: courseId, student: studentId });
    if (!enrolled) return res.status(403).json({ message: "You are not enrolled in this course" });

    const course = await Course.findById(courseId).select("code title section year semester courseType");
    if (!course) return res.status(404).json({ message: "Course not found" });

    const attendanceDocs = await Attendance.find({ course: courseId })
      .select("date period numClasses records")
      .sort({ date: 1, period: 1 });

    // expand legacy
    const expanded = [];
    attendanceDocs.forEach((a) => {
      const dStr = a.date.toISOString().slice(0, 10);
      if (a.period && Number(a.period) >= 1) {
        expanded.push({ dateStr: dStr, period: Number(a.period), records: a.records || [] });
      } else {
        const n = Number(a.numClasses || 1);
        for (let p = 1; p <= n; p++) {
          expanded.push({ dateStr: dStr, period: p, records: a.records || [] });
        }
      }
    });

    expanded.sort((a, b) => {
      if (a.dateStr < b.dateStr) return -1;
      if (a.dateStr > b.dateStr) return 1;
      return a.period - b.period;
    });

    const rows = expanded.map((x) => {
      const rec = (x.records || []).find((r) => String(r.roll) === roll);
      const present = !!rec?.present;
      return {
        date: x.dateStr,
        period: x.period,
        status: present ? "P" : "A",
      };
    });

    const totalClasses = rows.length;
    const totalPresent = rows.reduce((sum, r) => sum + (r.status === "P" ? 1 : 0), 0);
    const percentage = totalClasses > 0 ? Number(((totalPresent / totalClasses) * 100).toFixed(2)) : 0;

    return res.json({
      course,
      student: { roll, name: studentUser.name },
      rows,
      totalPresent,
      totalClasses,
      percentage,
    });
  } catch (err) {
    console.error("getStudentAttendanceSheet error:", err);
    return res.status(500).json({ message: "Failed to fetch attendance sheet" });
  }
};

// -------------------- GET (day + period) --------------------
// GET /api/attendance/day?courseId=...&date=YYYY-MM-DD&period=1
const getAttendanceByDay = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId, date, period } = req.query;
    if (!courseId || !date) {
      return res.status(400).json({ message: "courseId and date are required" });
    }

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    const { start, end } = dayRange(date);

    // If period provided -> fetch that period doc
    if (period) {
      const p = Number(period);
      const doc = await Attendance.findOne({
        teacher: teacherId,
        course: courseId,
        date: { $gte: start, $lte: end },
        period: p,
      }).select("date period records");

      if (!doc) {
        return res.status(404).json({ message: `No attendance found for Period ${p} on this date` });
      }

      return res.json({
        date: doc.date.toISOString().slice(0, 10),
        period: doc.period,
        records: doc.records || [],
      });
    }

    // Legacy fallback: find old doc without period
    const legacy = await Attendance.findOne({
      teacher: teacherId,
      course: courseId,
      date: { $gte: start, $lte: end },
      period: { $exists: false },
    }).select("date numClasses records");

    if (!legacy) {
      return res.status(404).json({ message: "No attendance found for this date" });
    }

    return res.json({
      date: legacy.date.toISOString().slice(0, 10),
      period: 1,
      legacy: true,
      numClasses: Number(legacy.numClasses || 1),
      records: legacy.records || [],
    });
  } catch (err) {
    console.error("getAttendanceByDay error:", err);
    return res.status(500).json({ message: "Failed to fetch attendance" });
  }
};

// -------------------- UPDATE (day + period) --------------------
// PUT /api/attendance/day  body: { courseId, date, period, records }
const updateAttendanceByDay = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId, date, period, records } = req.body;
    if (!courseId || !date || !period || !Array.isArray(records)) {
      return res.status(400).json({ message: "courseId, date, period and records are required" });
    }

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    const { start, end } = dayRange(date);
    const p = Number(period);

    const doc = await Attendance.findOne({
      teacher: teacherId,
      course: courseId,
      date: { $gte: start, $lte: end },
      period: p,
    });

    if (!doc) {
      return res.status(404).json({ message: `No attendance found for Period ${p} on this date` });
    }

    doc.records = records.map((r) => ({
      roll: String(r.roll),
      present: !!r.present,
    }));

    await doc.save();

    return res.json({
      message: "Attendance updated successfully",
      date: doc.date.toISOString().slice(0, 10),
      period: doc.period,
      records: doc.records,
    });
  } catch (err) {
    console.error("updateAttendanceByDay error:", err);
    return res.status(500).json({ message: "Failed to update attendance" });
  }
};

module.exports = {
  createAttendance,
  createAttendanceBulk,
  getAttendanceSheet,
  getStudentAttendanceSheet,
  getAttendanceByDay,
  updateAttendanceByDay,
};
