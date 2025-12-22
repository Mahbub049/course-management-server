const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");

const createAttendance = async (req, res) => {
  try {
    // ✅ After auth middleware, req.user MUST exist
    const teacherId = req.user?.userId || req.user?.id;

    if (!teacherId) {
      return res.status(401).json({ message: "Unauthorized: teacher not found" });
    }

    const { courseId, date, numClasses, records } = req.body;

    if (!courseId || !date || !numClasses || !Array.isArray(records)) {
      return res
        .status(400)
        .json({ message: "courseId, date, numClasses and records are required" });
    }

    // ✅ Ensure teacher owns this course
    const course = await Course.findOne({
      _id: courseId,
      createdBy: teacherId,
    });

    if (!course) {
      return res.status(404).json({ message: "Course not found for this teacher" });
    }

    const attendance = await Attendance.create({
      teacher: teacherId,
      course: courseId,
      section: course.section,
      date: new Date(date),
      numClasses: Number(numClasses),
      records: records.map((r) => ({
        roll: r.roll,
        present: !!r.present,
      })),
    });

    res.status(201).json(attendance);
  } catch (err) {
    console.error("createAttendance error:", err);
    res.status(500).json({ message: "Failed to save attendance" });
  }
};

const getAttendanceSheet = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ message: "courseId is required" });
    }

    // ✅ Ensure course belongs to teacher
    const course = await Course.findOne({
      _id: courseId,
      createdBy: teacherId,
    });

    if (!course) {
      return res.status(404).json({ message: "Course not found for this teacher" });
    }

    const attendanceDocs = await Attendance.find({
      teacher: teacherId,
      course: course._id,
    }).sort({ date: 1 });

    const dates = attendanceDocs.map((a) => ({
      date: a.date.toISOString().slice(0, 10),
      numClasses: a.numClasses,
    }));

    const enrollments = await Enrollment.find({ course: course._id })
      .populate("student", "username name")
      .sort({ "student.username": 1 });

    let students = enrollments.map((e) => ({
      roll: String(e.student.username),
      name: e.student.name,
    }));

    // fallback safety
    if (!students.length) {
      const rollSet = new Set();
      attendanceDocs.forEach((a) => {
        (a.records || []).forEach((r) => r?.roll && rollSet.add(String(r.roll)));
      });
      students = Array.from(rollSet)
        .sort()
        .map((roll) => ({ roll, name: "" }));
    }

    const matrix = {};
    students.forEach((s) => (matrix[s.roll] = {}));

    attendanceDocs.forEach((a) => {
      const d = a.date.toISOString().slice(0, 10);
      (a.records || []).forEach((r) => {
        if (!matrix[r.roll]) matrix[r.roll] = {};
        matrix[r.roll][d] = !!r.present;
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
      dates,
      matrix,
    });
  } catch (err) {
    console.error("getAttendanceSheet error:", err);
    return res.status(500).json({ message: "Failed to generate attendance sheet" });
  }
};

// ✅ NEW: Student can view ONLY his own attendance sheet for a course
// GET /api/attendance/student-sheet?courseId=...
const getStudentAttendanceSheet = async (req, res) => {
  try {
    const studentId = req.user?.userId || req.user?.id;
    if (!studentId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ message: "courseId is required" });

    // ✅ ensure student exists + get roll from User.username
    const studentUser = await User.findById(studentId).select("username name role");
    if (!studentUser || studentUser.role !== "student") {
      return res.status(403).json({ message: "Student access only" });
    }

    const roll = String(studentUser.username);

    // ✅ ensure the student is enrolled in this course
    const enrolled = await Enrollment.findOne({ course: courseId, student: studentId });
    if (!enrolled) {
      return res.status(403).json({ message: "You are not enrolled in this course" });
    }

    const course = await Course.findById(courseId).select("code title section year semester courseType");
    if (!course) return res.status(404).json({ message: "Course not found" });

    const attendanceDocs = await Attendance.find({ course: courseId })
      .select("date numClasses records")
      .sort({ date: 1 });

    const rows = attendanceDocs.map((a) => {
      const d = a.date.toISOString().slice(0, 10);
      const num = Number(a.numClasses || 0);

      const rec = (a.records || []).find((r) => String(r.roll) === roll);
      const present = !!rec?.present;

      return {
        date: d,
        numClasses: num,
        status: present ? "P" : "A",
      };
    });

    const totalClasses = rows.reduce((sum, r) => sum + r.numClasses, 0);
    const totalPresent = rows.reduce((sum, r) => sum + (r.status === "P" ? r.numClasses : 0), 0);
    const percentage = totalClasses > 0 ? Number(((totalPresent / totalClasses) * 100).toFixed(2)) : 0;

    return res.json({
      course,
      student: { roll, name: studentUser.name },
      rows, // date-wise P/A only for this student
      totalPresent,
      totalClasses,
      percentage,
    });
  } catch (err) {
    console.error("getStudentAttendanceSheet error:", err);
    return res.status(500).json({ message: "Failed to fetch attendance sheet" });
  }
};


// ✅ NEW: get a particular day attendance (for update UI)
// GET /api/attendance/day?courseId=...&date=YYYY-MM-DD
const getAttendanceByDay = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId, date } = req.query;
    if (!courseId || !date) {
      return res.status(400).json({ message: "courseId and date are required" });
    }

    // ensure teacher owns course
    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    // match that day range (avoid timezone mismatch)
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const doc = await Attendance.findOne({
      teacher: teacherId,
      course: courseId,
      date: { $gte: start, $lte: end },
    }).select("date numClasses records");

    if (!doc) {
      return res.status(404).json({ message: "No attendance found for this date" });
    }

    return res.json({
      date: doc.date.toISOString().slice(0, 10),
      numClasses: Number(doc.numClasses || 0),
      records: doc.records || [],
    });
  } catch (err) {
    console.error("getAttendanceByDay error:", err);
    return res.status(500).json({ message: "Failed to fetch attendance" });
  }
};

// ✅ NEW: update a particular day attendance (overwrite)
// PUT /api/attendance/day
const updateAttendanceByDay = async (req, res) => {
  try {
    const teacherId = req.user?.userId || req.user?.id;
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const { courseId, date, numClasses, records } = req.body;
    if (!courseId || !date || !numClasses || !Array.isArray(records)) {
      return res
        .status(400)
        .json({ message: "courseId, date, numClasses and records are required" });
    }

    // ensure teacher owns course
    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) return res.status(404).json({ message: "Course not found for this teacher" });

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const doc = await Attendance.findOne({
      teacher: teacherId,
      course: courseId,
      date: { $gte: start, $lte: end },
    });

    if (!doc) {
      return res.status(404).json({ message: "No attendance found for this date" });
    }

    doc.numClasses = Number(numClasses);
    doc.records = records.map((r) => ({
      roll: String(r.roll),
      present: !!r.present,
    }));

    await doc.save();

    return res.json({
      message: "Attendance updated successfully",
      date: doc.date.toISOString().slice(0, 10),
      numClasses: doc.numClasses,
      records: doc.records,
    });
  } catch (err) {
    console.error("updateAttendanceByDay error:", err);
    return res.status(500).json({ message: "Failed to update attendance" });
  }
};




module.exports = { createAttendance, getAttendanceSheet, getStudentAttendanceSheet , getAttendanceByDay, updateAttendanceByDay,};
