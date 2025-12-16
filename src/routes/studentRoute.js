const express = require('express');
const router = express.Router();

const {
  getStudentCourses,
  getStudentCourseDetails,
} = require('../controllers/studentController');

const {
  authMiddleware,
  requireStudent,
} = require('../middleware/authMiddleware');

router.use(authMiddleware, requireStudent);

// List all courses for logged-in student
router.get('/courses', getStudentCourses);

// Course details + marks
router.get('/courses/:courseId', getStudentCourseDetails);

module.exports = router;
