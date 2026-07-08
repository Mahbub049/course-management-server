const express = require('express');
const router = express.Router();

const {
  authMiddleware,
  requireTeacher,
} = require('../middleware/authMiddleware');

const {
  uploadLabSubmission,
} = require('../middleware/submissionUploadMiddleware');

const {
  getTeacherPublicSubmissionLink,
  updateTeacherPublicSubmissionLink,
  getPublicSubmissionPage,
  verifyPublicRoll,
  getPublicSubmittedFiles,
  submitPublicAssessmentFile,
} = require('../controllers/publicLabSubmissionController');

// Teacher controls the public link from the existing course submission page.
router.get(
  '/teacher/courses/:courseId/link',
  authMiddleware,
  requireTeacher,
  getTeacherPublicSubmissionLink
);

router.patch(
  '/teacher/courses/:courseId/link',
  authMiddleware,
  requireTeacher,
  updateTeacherPublicSubmissionLink
);

// Public no-login student routes.
router.get('/:token', getPublicSubmissionPage);
router.post('/:token/verify-roll', verifyPublicRoll);
router.get('/:token/submitted-files', getPublicSubmittedFiles);
router.post(
  '/:token/assessments/:assessmentId/submit',
  uploadLabSubmission.single('file'),
  submitPublicAssessmentFile
);

module.exports = router;
