const express = require("express");
const router = express.Router();

const {
  getLatestAcademicCalendar,
  saveAcademicCalendar,
  detectAcademicCalendarCategory,
  getFacultyCalendarEvents,
  createFacultyCalendarEvent,
  updateFacultyCalendarEvent,
  deleteFacultyCalendarEvent,
} = require("../controllers/academicCalendarController");

const {
  authMiddleware,
  requireTeacher,
} = require("../middleware/authMiddleware");


// Personal faculty calendar events/tasks. These are private to each logged-in teacher.
router.get(
  "/faculty-events",
  authMiddleware,
  requireTeacher,
  getFacultyCalendarEvents
);

router.post(
  "/faculty-events",
  authMiddleware,
  requireTeacher,
  createFacultyCalendarEvent
);

router.put(
  "/faculty-events/:eventId",
  authMiddleware,
  requireTeacher,
  updateFacultyCalendarEvent
);

router.delete(
  "/faculty-events/:eventId",
  authMiddleware,
  requireTeacher,
  deleteFacultyCalendarEvent
);

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