// server/src/routes/complaintRoute.js

const express = require('express');
const router = express.Router();

const {
  authMiddleware,
  requireStudent,
  requireTeacher,
} = require('../middleware/authMiddleware');

const {
  createStudentComplaint,
  getStudentComplaints,
  getTeacherComplaints,
  replyToComplaint,
  resolveAttendanceComplaint,
} = require('../controllers/complaintController');

// STUDENT routes
router.post(
  '/student',
  authMiddleware,
  requireStudent,
  createStudentComplaint
);

router.get('/student', authMiddleware, requireStudent, getStudentComplaints);

// TEACHER routes
router.get('/teacher', authMiddleware, requireTeacher, getTeacherComplaints);

router.post(
  '/teacher/:id/resolve-attendance',
  authMiddleware,
  requireTeacher,
  resolveAttendanceComplaint
);

router.put(
  '/teacher/:id',
  authMiddleware,
  requireTeacher,
  replyToComplaint
);

module.exports = router;
