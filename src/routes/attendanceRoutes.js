const express = require("express");
const router = express.Router();

const { createAttendance } = require("../controllers/attendanceController");
const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");

router.post("/", authMiddleware, requireTeacher, createAttendance);

module.exports = router;
