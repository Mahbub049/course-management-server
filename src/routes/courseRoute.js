const express = require("express");
const router = express.Router();

const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");

// Controllers
const {
  createCourse,
  getCourses,
  getCourseById,
  deleteCourse,
} = require("../controllers/courseController");

const {
  addStudentToCourse,
  bulkAddStudentsToCourse,
  getCourseStudents,
  removeStudentFromCourse,
  removeAllStudentsFromCourse, // ✅ NEW
  resetStudentPassword,
  exportCourseStudents,
  sendPasswordsByEmail,
} = require("../controllers/enrollmentController");

const {
  getAssessmentsForCourse,
  createAssessment,
  updateAssessment,
  deleteAssessment,
} = require("../controllers/assessmentController");

const { getMarksForCourse, saveMarksForCourse } = require("../controllers/markController");

const {
  getAttendanceSummary,
  saveAttendanceSummary,
  getAttendanceSummaryFromSheet,
} = require("../controllers/attendanceSummaryController");

// ✅ Helper middleware chain (order matters!)
const teacherOnly = [authMiddleware, requireTeacher];

// ===================================================
// ✅ COURSES
// ===================================================
router.get("/", ...teacherOnly, getCourses);
router.get("/:courseId/students/export", ...teacherOnly, exportCourseStudents);

router.post("/", ...teacherOnly, createCourse);
router.post("/:courseId/students/send-password-emails", ...teacherOnly, sendPasswordsByEmail);

router.get("/:id", ...teacherOnly, getCourseById);

router.delete("/:id", ...teacherOnly, deleteCourse);

// ===================================================
// ✅ STUDENTS (Enrollment)
// ===================================================
router.post("/:courseId/students", ...teacherOnly, addStudentToCourse);
router.post("/:courseId/students/bulk", ...teacherOnly, bulkAddStudentsToCourse);
router.get("/:courseId/students", ...teacherOnly, getCourseStudents);

// ✅ NEW: remove all students in a course (must be above /:enrollmentId route?)
// This is safe because /students/:enrollmentId has extra segment.
router.delete("/:courseId/students", ...teacherOnly, removeAllStudentsFromCourse);

router.delete("/:courseId/students/:enrollmentId", ...teacherOnly, removeStudentFromCourse);

router.post("/:courseId/students/:studentId/reset-password", ...teacherOnly, resetStudentPassword);

// ===================================================
// ✅ ASSESSMENTS
// ===================================================
router.get("/:courseId/assessments", ...teacherOnly, getAssessmentsForCourse);
router.post("/:courseId/assessments", ...teacherOnly, createAssessment);
router.put("/assessments/:assessmentId", ...teacherOnly, updateAssessment);
router.delete("/assessments/:assessmentId", ...teacherOnly, deleteAssessment);

// ===================================================
// ✅ MARKS
// ===================================================
router.get("/:courseId/marks", ...teacherOnly, getMarksForCourse);
router.post("/:courseId/marks", ...teacherOnly, saveMarksForCourse);

// ===================================================
// ✅ ATTENDANCE SUMMARY
// ===================================================
router.get("/:courseId/attendance-summary", ...teacherOnly, getAttendanceSummary);
router.post("/:courseId/attendance-summary", ...teacherOnly, saveAttendanceSummary);

router.get("/:courseId/attendance-summary/from-sheet", ...teacherOnly, getAttendanceSummaryFromSheet);

module.exports = router;
