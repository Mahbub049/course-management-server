const express = require("express");
const router = express.Router();

const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");

// Controllers
const {
  createCourse,
  getCourses,
  getCourseById,
  deleteCourse,
  updateCourse,
} = require("../controllers/courseController");

const {
  addStudentToCourse,
  bulkAddStudentsToCourse,
  getCourseStudents,
  removeStudentFromCourse,
  removeAllStudentsFromCourse,
  resetStudentPassword,
  resetAllStudentPasswords,
  exportCourseStudents,
  sendPasswordsByEmail,
} = require("../controllers/enrollmentController");

const {
  getAssessmentsForCourse,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  publishAssessment,
} = require("../controllers/assessmentController");

const { getMarksForCourse, saveMarksForCourse } = require("../controllers/markController");

const {
  getAttendanceSummary,
  saveAttendanceSummary,
  getAttendanceSummaryFromSheet,
} = require("../controllers/attendanceSummaryController");

const {
  getTeacherCourseMaterials,
  createCourseMaterial,
  updateCourseMaterial,
  deleteCourseMaterial,
} = require("../controllers/courseMaterialController");

const {
  getTeacherProjectGroups,
  createTeacherProjectGroup,
  updateTeacherProjectGroup,
  deleteTeacherProjectGroup,
} = require("../controllers/projectGroupController");

const {
  getTeacherProjectPhases,
  createProjectPhase,
  updateProjectPhase,
  deleteProjectPhase,
} = require("../controllers/projectPhaseController");

const {
  getTeacherProjectSubmissions,
} = require("../controllers/projectSubmissionController");


const {
  getTeacherProjectEvaluations,
  saveProjectEvaluation,
} = require("../controllers/projectEvaluationController");

const {
  getTeacherProjectSyncState,
  saveTeacherProjectSyncConfig,
  runProjectFinalSync,
} = require("../controllers/projectFinalSyncController");

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

router.put("/:id", ...teacherOnly, updateCourse);


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

router.post("/:courseId/students/reset-password-all", ...teacherOnly, resetAllStudentPasswords);
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


router.post("/:courseId/assessments/:assessmentId/publish", ...teacherOnly, publishAssessment);


// ===================================================
// ✅ COURSE MATERIALS
// ===================================================
router.get("/:courseId/materials", ...teacherOnly, getTeacherCourseMaterials);
router.post("/:courseId/materials", ...teacherOnly, createCourseMaterial);
router.put("/materials/:materialId", ...teacherOnly, updateCourseMaterial);
router.delete("/materials/:materialId", ...teacherOnly, deleteCourseMaterial);


// ===================================================
// ✅ PROJECT GROUPS (Teacher)
// ===================================================
router.get("/:courseId/project-groups", ...teacherOnly, getTeacherProjectGroups);
router.post("/:courseId/project-groups", ...teacherOnly, createTeacherProjectGroup);
router.put("/:courseId/project-groups/:groupId", ...teacherOnly, updateTeacherProjectGroup);
router.delete("/:courseId/project-groups/:groupId", ...teacherOnly, deleteTeacherProjectGroup);


// ===================================================
// ✅ PROJECT PHASES (Teacher)
// ===================================================
router.get("/:courseId/project-phases", ...teacherOnly, getTeacherProjectPhases);
router.post("/:courseId/project-phases", ...teacherOnly, createProjectPhase);
router.put("/:courseId/project-phases/:phaseId", ...teacherOnly, updateProjectPhase);
router.delete("/:courseId/project-phases/:phaseId", ...teacherOnly, deleteProjectPhase);

router.get("/:courseId/project-submissions", ...teacherOnly, getTeacherProjectSubmissions);


router.get("/:courseId/project-evaluations", ...teacherOnly, getTeacherProjectEvaluations);
router.post("/:courseId/project-evaluations/:phaseId", ...teacherOnly, saveProjectEvaluation);


router.get("/:courseId/project-sync", ...teacherOnly, getTeacherProjectSyncState);
router.put("/:courseId/project-sync", ...teacherOnly, saveTeacherProjectSyncConfig);
router.post("/:courseId/project-sync/run", ...teacherOnly, runProjectFinalSync);
module.exports = router;

