const express = require("express");
const router = express.Router();

const {
  getLatestAcademicCalendar,
  saveAcademicCalendar,
  detectAcademicCalendarCategory,
} = require("../controllers/academicCalendarController");

const {
  authMiddleware,
  requireTeacher,
} = require("../middleware/authMiddleware");

// Logged-in teacher/student can view academic calendar
router.get("/", authMiddleware, getLatestAcademicCalendar);

// Only teacher can create/update academic calendar
router.post("/", authMiddleware, requireTeacher, saveAcademicCalendar);

// Only teacher can use category detection
router.post(
  "/detect-category",
  authMiddleware,
  requireTeacher,
  detectAcademicCalendarCategory
);

module.exports = router;