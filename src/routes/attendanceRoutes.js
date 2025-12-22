const express = require("express");
const router = express.Router();

const {
    createAttendance,
    getAttendanceSheet,
    getStudentAttendanceSheet,
    getAttendanceByDay,
    updateAttendanceByDay,
} = require("../controllers/attendanceController");

const { authMiddleware, requireTeacher, requireStudent } = require("../middleware/authMiddleware");

router.post("/", authMiddleware, requireTeacher, createAttendance);
router.get("/sheet", authMiddleware, requireTeacher, getAttendanceSheet);
router.get("/student-sheet", authMiddleware, requireStudent, getStudentAttendanceSheet);
// Teacher: load existing attendance of a day
router.get("/day", authMiddleware, requireTeacher, getAttendanceByDay);

// Teacher: update existing attendance of a day
router.put("/day", authMiddleware, requireTeacher, updateAttendanceByDay);


module.exports = router;
