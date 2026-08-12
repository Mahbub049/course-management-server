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
  getTeacherPublicSubmissionClaims,
  releaseTeacherPublicSubmissionClaim,
  getPublicSubmissionPortal,
  getCurrentPublicSubmissionPage,
  getPublicSubmissionPage,
  getPublicDeviceSession,
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


router.get(
  '/teacher/courses/:courseId/claims',
  authMiddleware,
  requireTeacher,
  getTeacherPublicSubmissionClaims
);

router.post(
  '/teacher/courses/:courseId/claims/:claimId/release',
  authMiddleware,
  requireTeacher,
  releaseTeacherPublicSubmissionClaim
);

// Public no-login student routes.
// Keep this fixed endpoint before /:token so Express does not treat "portal" as a token.
router.get('/portal', getPublicSubmissionPortal);
router.get('/current', getCurrentPublicSubmissionPage);
router.get('/:token', getPublicSubmissionPage);
router.get('/:token/device-session', getPublicDeviceSession);
router.post('/:token/verify-roll', verifyPublicRoll);
router.get('/:token/submitted-files', getPublicSubmittedFiles);
router.post(
  '/:token/assessments/:assessmentId/submit',
  uploadLabSubmission.single('file'),
  submitPublicAssessmentFile
);

module.exports = router;
