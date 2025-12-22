const Course = require("../models/Course");
const AttendanceSummary = require("../models/AttendanceSummary");
const Attendance = require("../models/Attendance");
const Enrollment = require("../models/Enrollment");


// ✅ NEW imports
const Assessment = require("../models/Assessment");
const Mark = require("../models/Mark");

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const calcPercentage = (total, attended) => {
  const t = Number(total || 0);
  const a = Number(attended || 0);
  if (t <= 0) return 0;
  const p = (a / t) * 100;
  return Math.max(0, Math.min(100, p));
};

const calcMarks = (percentage) => {
  const p = Number(percentage || 0);
  if (p >= 90) return 5;
  if (p >= 80) return 4;
  if (p >= 70) return 3;
  if (p >= 60) return 2;
  if (p >= 50) return 1;
  return 0;
};

// ✅ helper: ensure Attendance assessment exists
const ensureAttendanceAssessment = async (courseId) => {
  // Try by name first (case-insensitive)
  let a = await Assessment.findOne({
    course: courseId,
    name: { $regex: /^attendance$/i },
  });

  // If not found, create it
  if (!a) {
    a = await Assessment.create({
      course: courseId,
      name: "Attendance",
      fullMarks: 5,
      order: 999,
    });
  }

  return a;
};

// GET /api/courses/:courseId/attendance-summary
const getAttendanceSummary = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    const rows = await AttendanceSummary.find({ course: courseId }).select(
      "student totalClasses attendedClasses percentage marks"
    );

    res.json(rows);
  } catch (err) {
    console.error("Get attendance summary error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /api/courses/:courseId/attendance-summary/from-sheet
const getAttendanceSummaryFromSheet = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    // ✅ all daily attendance entries for this course by this teacher
    const daily = await Attendance.find({
      course: courseId,
      teacher: req.user.userId,
    }).select("date numClasses records");

    // ✅ total classes = sum of numClasses of all days
    const totalClasses = daily.reduce(
      (sum, d) => sum + Number(d.numClasses || 0),
      0
    );

    // ✅ roll => attendedClasses count (weighted by numClasses per day)
    const attendedByRoll = new Map();

    daily.forEach((d) => {
      const n = Number(d.numClasses || 0);
      (d.records || []).forEach((r) => {
        if (!r?.roll) return;
        if (!r.present) return;

        const roll = String(r.roll);
        attendedByRoll.set(roll, (attendedByRoll.get(roll) || 0) + n);
      });
    });

    // ✅ map roll -> studentId using Enrollment (Enrollment.student -> User)
    const enrollments = await Enrollment.find({ course: courseId })
      .populate("student", "username") // username = roll
      .select("student");

    const rollToStudentId = new Map();
    enrollments.forEach((e) => {
      const roll = e?.student?.username ? String(e.student.username) : null;
      if (roll) rollToStudentId.set(roll, String(e.student._id));
    });

    // ✅ build records array for the frontend
    const records = [];
    for (const [roll, attendedClasses] of attendedByRoll.entries()) {
      const studentId = rollToStudentId.get(roll);
      if (!studentId) continue; // roll not enrolled / mismatch
      records.push({
        studentId,
        attendedClasses: Number(attendedClasses || 0),
      });
    }

    return res.json({ totalClasses, records });
  } catch (err) {
    console.error("getAttendanceSummaryFromSheet error", err);
    return res.status(500).json({ message: "Server error" });
  }
};


// POST /api/courses/:courseId/attendance-summary
// body: { records: [{ studentId, totalClasses, attendedClasses }] }
const saveAttendanceSummary = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { records } = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ message: "records must be an array" });
    }

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cleaned = records
      .map((r) => ({
        studentId: r.studentId || r.student,
        totalClasses: Number(r.totalClasses || 0),
        attendedClasses: Number(r.attendedClasses || 0),
      }))
      .filter((r) => r.studentId);

    // ✅ Bulk write AttendanceSummary as you already do
    const bulkOps = cleaned.map((r) => {
      const percentage = calcPercentage(r.totalClasses, r.attendedClasses);
      const marks = calcMarks(percentage);

      return {
        updateOne: {
          filter: { course: courseId, student: r.studentId },
          update: {
            $set: {
              course: courseId,
              student: r.studentId,
              totalClasses: r.totalClasses,
              attendedClasses: r.attendedClasses,
              percentage,
              marks,
              updatedBy: req.user.userId,
            },
          },
          upsert: true,
        },
      };
    });

    if (bulkOps.length) await AttendanceSummary.bulkWrite(bulkOps);

    // ✅ NEW: also store Attendance marks in Mark collection
    // so student course page can show it.
    if (cleaned.length) {
      const attendanceAssessment = await ensureAttendanceAssessment(courseId);

      const markBulkOps = cleaned.map((r) => {
        const percentage = calcPercentage(r.totalClasses, r.attendedClasses);
        const marks = calcMarks(percentage);

        return {
          updateOne: {
            filter: {
              course: courseId,
              student: r.studentId,
              assessment: attendanceAssessment._id,
            },
            update: {
              $set: {
                course: courseId,
                student: r.studentId,
                assessment: attendanceAssessment._id,
                obtainedMarks: marks,
              },
            },
            upsert: true,
          },
        };
      });

      await Mark.bulkWrite(markBulkOps);
    }

    res.json({ message: "Attendance saved successfully" });
  } catch (err) {
    console.error("Save attendance summary error", err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAttendanceSummary,
  saveAttendanceSummary,
  getAttendanceSummaryFromSheet,
};
