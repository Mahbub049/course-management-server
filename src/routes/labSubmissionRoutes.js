const express = require("express");
const router = express.Router();

const {
  authMiddleware,
  requireTeacher,
  requireStudent,
} = require("../middleware/authMiddleware");

const {
  uploadLabSubmission,
} = require("../middleware/submissionUploadMiddleware");

const {
  createTeacherSubmissionAssessment,
  getTeacherSubmissionAssessments,
  updateTeacherSubmissionAssessment,
  deleteTeacherSubmissionAssessment,
  getTeacherAssessmentSubmissions,
  markSubmissionChecked,
  saveAllSubmissionMarks,
  syncAllSubmissionMarksToAssessment,
  downloadAllTeacherAssessmentSubmissions,
  getStudentSubmissionAssessments,
  getStudentCourseSubmissionAssessments,
  submitStudentAssessmentFile,
} = require("../controllers/labSubmissionController");

// ---------------- TEACHER ----------------

router.post(
  "/teacher/courses/:courseId/assessments",
  authMiddleware,
  requireTeacher,
  createTeacherSubmissionAssessment
);

router.get(
  "/teacher/courses/:courseId/assessments",
  authMiddleware,
  requireTeacher,
  getTeacherSubmissionAssessments
);

router.patch(
  "/teacher/courses/:courseId/assessments/:assessmentId",
  authMiddleware,
  requireTeacher,
  updateTeacherSubmissionAssessment
);

router.delete(
  "/teacher/courses/:courseId/assessments/:assessmentId",
  authMiddleware,
  requireTeacher,
  deleteTeacherSubmissionAssessment
);

router.get(
  "/teacher/courses/:courseId/assessments/:assessmentId/submissions",
  authMiddleware,
  requireTeacher,
  getTeacherAssessmentSubmissions
);

router.get(
  "/teacher/courses/:courseId/assessments/:assessmentId/download-all",
  authMiddleware,
  requireTeacher,
  downloadAllTeacherAssessmentSubmissions
);

router.patch(
  "/teacher/submissions/:submissionId",
  authMiddleware,
  requireTeacher,
  markSubmissionChecked
);

router.post(
  "/teacher/courses/:courseId/assessments/:assessmentId/save-all-marks",
  authMiddleware,
  requireTeacher,
  saveAllSubmissionMarks
);

router.post(
  "/teacher/courses/:courseId/assessments/:assessmentId/sync-marks",
  authMiddleware,
  requireTeacher,
  syncAllSubmissionMarksToAssessment
);

// ---------------- STUDENT ----------------

router.get(
  "/student/assessments",
  authMiddleware,
  requireStudent,
  getStudentSubmissionAssessments
);

router.get(
  "/student/courses/:courseId/assessments",
  authMiddleware,
  requireStudent,
  getStudentCourseSubmissionAssessments
);

router.post(
  "/student/assessments/:assessmentId/submit",
  authMiddleware,
  requireStudent,
  uploadLabSubmission.single("file"),
  submitStudentAssessmentFile
);

module.exports = router;