const express = require("express");
const router = express.Router();

const {
  getStudentCourses,
  getStudentCourseDetails,
  getStudentCourseMaterials,
} = require("../controllers/studentController");

const {
  getStudentProjectGroups,
  createStudentProjectGroup,
  updateStudentProjectInfo,
} = require("../controllers/projectGroupController");

const {
  getStudentProjectFormConfig,
} = require("../controllers/projectFormController");

const {
  getStudentProjectPhases,
} = require("../controllers/projectPhaseController");

const {
  getStudentProjectSubmissions,
  submitStudentProjectPhase,
} = require("../controllers/projectSubmissionController");

const {
  getStudentProjectEvaluations,
} = require("../controllers/projectEvaluationController");

const {
  getStudentProjectTotalSummary,
} = require("../controllers/projectFinalSyncController");

const {
  authMiddleware,
  requireStudent,
} = require("../middleware/authMiddleware");

router.use(authMiddleware, requireStudent);

router.get("/courses", getStudentCourses);
router.get("/courses/:courseId", getStudentCourseDetails);
router.get("/courses/:courseId/materials", getStudentCourseMaterials);

router.get("/courses/:courseId/project-form", getStudentProjectFormConfig);

router.get("/courses/:courseId/project-groups", getStudentProjectGroups);
router.post("/courses/:courseId/project-groups", createStudentProjectGroup);
router.put("/courses/:courseId/project-info", updateStudentProjectInfo);

router.get("/courses/:courseId/project-phases", getStudentProjectPhases);

router.get("/courses/:courseId/project-submissions", getStudentProjectSubmissions);
router.post("/courses/:courseId/project-submissions/:phaseId", submitStudentProjectPhase);

router.get("/courses/:courseId/project-evaluations", getStudentProjectEvaluations);

router.get("/courses/:courseId/project-total-summary", getStudentProjectTotalSummary);

module.exports = router;