// server/src/controllers/attendanceController.js

const Attendance = require("../models/Attendance");
const Course = require("../models/Course");

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
    const course = await Course.findOne({ _id: courseId, teacher: teacherId });
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

module.exports = { createAttendance };
