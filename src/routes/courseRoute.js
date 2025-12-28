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
  resetStudentPassword,
  exportCourseStudents,
} = require("../controllers/enrollmentController");

const {
  getAssessmentsForCourse,
  createAssessment,
  updateAssessment,
  deleteAssessment,
} = require("../controllers/assessmentController");

const {
  getMarksForCourse,
  saveMarksForCourse,
} = require("../controllers/markController");

const {
  getAttendanceSummary,
  saveAttendanceSummary,
  getAttendanceSummaryFromSheet, // ✅ ADD
} = require("../controllers/attendanceSummaryController");


// ✅ Helper middleware chain (order matters!)
const teacherOnly = [authMiddleware, requireTeacher];

// ===================================================
// ✅ COURSES
// ===================================================
router.get("/", ...teacherOnly, getCourses);
router.get(
  "/:courseId/students/export",
  ...teacherOnly,
  exportCourseStudents
);

router.post("/", ...teacherOnly, createCourse);
router.get("/:id", ...teacherOnly, getCourseById);

router.delete("/:id", ...teacherOnly, deleteCourse);

// ===================================================
// ✅ STUDENTS (Enrollment)
// ===================================================
router.post("/:courseId/students", ...teacherOnly, addStudentToCourse);
router.post("/:courseId/students/bulk", ...teacherOnly, bulkAddStudentsToCourse);
router.get("/:courseId/students", ...teacherOnly, getCourseStudents);

router.delete(
  "/:courseId/students/:enrollmentId",
  ...teacherOnly,
  removeStudentFromCourse
);

router.post(
  "/:courseId/students/:studentId/reset-password",
  ...teacherOnly,
  resetStudentPassword
);

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
// ✅ ATTENDANCE SUMMARY  (THIS WAS MISSING)
// ===================================================
router.get("/:courseId/attendance-summary", ...teacherOnly, getAttendanceSummary);
router.post("/:courseId/attendance-summary", ...teacherOnly, saveAttendanceSummary);

router.get(
  "/:courseId/attendance-summary/from-sheet",
  ...teacherOnly,
  getAttendanceSummaryFromSheet
);

module.exports = router;
