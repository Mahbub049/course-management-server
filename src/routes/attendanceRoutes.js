const express = require("express");
const router = express.Router();

const {
  createAttendance,
  createAttendanceBulk,
  getAttendanceSheet,
  getStudentAttendanceSheet,
  getAttendanceByDay,
  updateAttendanceByDay,
} = require("../controllers/attendanceController");

const {
  authMiddleware,
  requireTeacher,
  requireStudent,
} = require("../middleware/authMiddleware");

// Single-period create
router.post("/", authMiddleware, requireTeacher, createAttendance);

// Bulk-period create
router.post("/bulk", authMiddleware, requireTeacher, createAttendanceBulk);

router.get("/sheet", authMiddleware, requireTeacher, getAttendanceSheet);
router.get("/student-sheet", authMiddleware, requireStudent, getStudentAttendanceSheet);

// Teacher: load existing attendance of a day (period-wise)
router.get("/day", authMiddleware, requireTeacher, getAttendanceByDay);

// Teacher: update existing attendance of a day (period-wise)
router.put("/day", authMiddleware, requireTeacher, updateAttendanceByDay);

module.exports = router;
