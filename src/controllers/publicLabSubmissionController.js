const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');

const Assessment = require('../models/Assessment');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const LabSubmission = require('../models/LabSubmission');
const PublicSubmissionLink = require('../models/PublicSubmissionLink');
const PublicSubmissionClaim = require('../models/PublicSubmissionClaim');
const User = require('../models/User');

const {
  buildSubmissionStoragePath,
  uploadSubmissionBuffer,
  deleteSubmissionObject,
  createSubmissionSignedUrl,
} = require('../utils/labSubmissionStorage');
const { buildSubmissionIntegrity } = require('../utils/submissionIntegrity');

const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'json',
  'md',
  'xml',
  'zip',
  'png',
  'jpg',
  'jpeg',
  'c',
  'cpp',
  'java',
  'sql',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'html',
  'css',
  'php',
  'sh',
];

const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_+-]{0,15}$/;

function sanitizeExtension(value = '') {
  const ext = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');

  return EXTENSION_PATTERN.test(ext) ? ext : '';
}

function normalizeAllowedExtensions(value) {
  if (!Array.isArray(value)) return DEFAULT_ALLOWED_EXTENSIONS;

  const cleaned = value.map((item) => sanitizeExtension(item)).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length ? unique : DEFAULT_ALLOWED_EXTENSIONS;
}

function isAssessmentEligibleForStudent(assessment, studentId) {
  const cfg = assessment?.submissionConfig || {};
  if (String(cfg.eligibilityMode || '').toLowerCase() !== 'selected') return true;

  const targetId = String(studentId || '');
  const selectedIds = Array.isArray(cfg.eligibleStudents)
    ? cfg.eligibleStudents.map((id) => String(id || '')).filter(Boolean)
    : [];

  return selectedIds.includes(targetId);
}

function filterEligibleAssessments(assessments, studentId) {
  return (Array.isArray(assessments) ? assessments : []).filter((assessment) =>
    isAssessmentEligibleForStudent(assessment, studentId)
  );
}

function getFileExtension(fileName = '') {
  return path.extname(fileName || '').toLowerCase().replace(/^\./, '');
}

function formatAllowedExtensions(value) {
  return normalizeAllowedExtensions(value)
    .map((item) => item.toUpperCase())
    .join(', ');
}

function getValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasSubmissionDueDatePassed(cfg = {}) {
  const dueDate = getValidDate(cfg?.dueDate);
  if (!dueDate) return false;
  return Date.now() > dueDate.getTime();
}

function isSubmissionCurrentlyOpen(cfg = {}) {
  if (cfg?.submissionsOpen === false) return false;
  if (hasSubmissionDueDatePassed(cfg)) return false;
  return true;
}

function getSubmissionClosedReason(cfg = {}) {
  if (cfg?.submissionsOpen === false) return 'manual';
  if (hasSubmissionDueDatePassed(cfg)) return 'due_date_passed';
  return null;
}

function normalizeResourceUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch (_err) {
    return '';
  }
}

function normalizeResourceTitle(value) {
  const title = String(value || '').trim();
  return title || 'View Resource';
}

function normalizeAssessment(assessment, submission = null) {
  const cfg = assessment?.submissionConfig || {};
  const dueDatePassed = hasSubmissionDueDatePassed(cfg);
  const submissionsOpen = isSubmissionCurrentlyOpen(cfg);

  let submissionData = null;
  if (submission) {
    submissionData = {
      id: submission._id.toString(),
      originalFileName: submission.originalFileName,
      fileUrl: submission.fileUrl,
      submittedAt: submission.submittedAt,
      status: submission.status,
      teacherNote: submission.teacherNote || '',
      source: submission.source || 'student-login',
    };
  }

  return {
    id: assessment._id.toString(),
    _id: assessment._id.toString(),
    course: assessment.course?.toString?.() || assessment.course,
    name: assessment.name,
    fullMarks: Number(assessment.fullMarks || 0),
    structureType: assessment.structureType,
    dueDate: cfg.dueDate || null,
    instructions: cfg.instructions || '',
    maxFileSizeMB: Number(cfg.maxFileSizeMB || 10),
    allowedExtensions: normalizeAllowedExtensions(cfg.allowedExtensions),
    allowResubmission: cfg.allowResubmission !== false,
    resourceTitle: cfg.resourceUrl ? normalizeResourceTitle(cfg.resourceTitle) : '',
    resourceUrl: normalizeResourceUrl(cfg.resourceUrl),
    submissionsOpen,
    dueDatePassed,
    closedReason: getSubmissionClosedReason(cfg),
    submission: submissionData,
  };
}

function normalizeCourse(course) {
  return {
    id: course._id.toString(),
    code: course.code || '',
    title: course.title || '',
    section: course.section || '',
    intake: course.intake || '',
    semester: course.semester || '',
    year: course.year || '',
    courseType: course.courseType || '',
  };
}

function normalizeTeacher(teacher) {
  return {
    id: teacher?._id?.toString?.() || '',
    name: teacher?.name || '',
    department: teacher?.department || '',
    designation: teacher?.designation || '',
  };
}

function normalizeLink(link) {
  return {
    id: link._id.toString(),
    token: link.token,
    title: link.title || 'Public Submission Link',
    instructions: link.instructions || '',
    isActive: !!link.isActive,
    showOnPortal: link.showOnPortal !== false,
    portalVisibleFrom: link.portalVisibleFrom || null,
    portalVisibleUntil: link.portalVisibleUntil || null,
    assessmentIds: (link.assessmentIds || []).map((id) => id.toString()),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function parseOptionalDate(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isPortalListingVisible(link, now = new Date()) {
  if (!link?.isActive || link.showOnPortal === false) return false;

  const from = getValidDate(link.portalVisibleFrom);
  const until = getValidDate(link.portalVisibleUntil);

  if (from && now < from) return false;
  if (until && now > until) return false;
  return true;
}

function normalizeSlugPart(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

function buildCoursePublicSlug(course = {}) {
  const code = normalizeSlugPart(course.code || 'course');
  const intake = normalizeSlugPart(course.intake);
  const section = normalizeSlugPart(course.section);

  const parts = [code];

  if (intake) parts.push(`i${intake}`);
  if (section) parts.push(`s${section}`);

  const slug = parts.join('');
  return slug || `course${crypto.randomBytes(2).toString('hex')}`;
}

function isOldRandomToken(value = '') {
  return /^[a-f0-9]{32,}$/i.test(String(value || '').trim());
}

async function createUniqueCourseSlug(course, currentLinkId = null) {
  const base = buildCoursePublicSlug(course);
  const currentId = currentLinkId?.toString?.() || String(currentLinkId || '');

  for (let counter = 0; counter <= 20; counter += 1) {
    const candidate = counter === 0 ? base : `${base}${counter + 1}`;
    const existing = await PublicSubmissionLink.findOne({ token: candidate }).select('_id');

    if (!existing || existing._id.toString() === currentId) {
      return candidate;
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}${crypto.randomBytes(2).toString('hex')}`;
    const existing = await PublicSubmissionLink.findOne({ token: candidate }).select('_id');

    if (!existing || existing._id.toString() === currentId) {
      return candidate;
    }
  }

  return `${base}${Date.now().toString(36).slice(-4)}`;
}

async function ensureTeacherCourse(courseId, teacherId) {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
}

async function getOrCreateCourseLink(course, teacherId) {
  let link = await PublicSubmissionLink.findOne({ course: course._id });

  if (!link) {
    link = await PublicSubmissionLink.create({
      course: course._id,
      teacher: teacherId,
      token: await createUniqueCourseSlug(course),
      title: `${course.code || 'Course'} Public Submission`,
      instructions: '',
      assessmentIds: [],
      isActive: false,
      showOnPortal: false,
      portalVisibleFrom: null,
      portalVisibleUntil: null,
    });

    return link;
  }

  if (isOldRandomToken(link.token)) {
    link.token = await createUniqueCourseSlug(course, link._id);
    await link.save();
  }

  return link;
}

async function getSelectedAssessments(link, courseId) {
  const selectedIds = (link.assessmentIds || [])
    .map((id) => id.toString())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (!selectedIds.length) return [];

  return Assessment.find({
    _id: { $in: selectedIds },
    course: courseId,
    structureType: 'lab_submission',
  }).sort({ order: 1, createdAt: -1 });
}

async function findStudentEnrollmentByRoll(courseId, roll) {
  const normalizedRoll = String(roll || '').trim();
  if (!normalizedRoll) return null;

  const exactStudent = await User.findOne({
    role: 'student',
    username: normalizedRoll,
  });

  if (exactStudent) {
    const enrollment = await Enrollment.findOne({
      course: courseId,
      student: exactStudent._id,
    }).populate('course');

    if (enrollment) return { enrollment, student: exactStudent };
  }

  const canUseShortRoll = /^\d{3,4}$/.test(normalizedRoll);
  if (!canUseShortRoll) return null;

  const courseEnrollments = await Enrollment.find({ course: courseId })
    .populate('student')
    .populate('course');

  const matches = courseEnrollments.filter((enrollment) => {
    const student = enrollment?.student;
    if (!student || student.role !== 'student') return false;
    return String(student.username || '').trim().endsWith(normalizedRoll);
  });

  if (!matches.length) return null;

  if (matches.length > 1) {
    return {
      ambiguous: true,
      enteredRoll: normalizedRoll,
      matchedRolls: matches
        .map((item) => item?.student?.username)
        .filter(Boolean)
        .slice(0, 8),
    };
  }

  return {
    enrollment: matches[0],
    student: matches[0].student,
  };
}


function getPublicDeviceId(req) {
  return String(
    req?.body?.deviceId ||
      req?.query?.deviceId ||
      req?.headers?.['x-public-submission-device'] ||
      ''
  ).trim();
}

function isValidPublicDeviceId(value) {
  return /^[A-Za-z0-9._:-]{20,200}$/.test(String(value || '').trim());
}

function hashPublicDeviceId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getRequestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || '';
}

function getAssessmentLockExpiry(assessment) {
  const dueDate = getValidDate(assessment?.submissionConfig?.dueDate);
  return dueDate || null;
}

function isAssessmentOpenForClaim(assessment) {
  return Boolean(assessment && isSubmissionCurrentlyOpen(assessment.submissionConfig || {}));
}

async function deactivateExpiredAssessmentClaims(assessmentId) {
  if (!assessmentId) return;

  await PublicSubmissionClaim.updateMany(
    {
      assessment: assessmentId,
      active: true,
      expiresAt: { $ne: null, $lte: new Date() },
    },
    {
      $set: { active: false },
    }
  );
}

function isPublicSubmissionClaimLive(claim, nowValue = Date.now()) {
  if (!claim?.active) return false;

  const expiry = getValidDate(claim.expiresAt);
  if (expiry && expiry.getTime() <= nowValue) return false;

  // When the assessment is populated, respect a teacher/manual close as well.
  // If it is not populated (for example after the public link selection changes),
  // the saved server-side expiry remains the source of truth.
  if (claim.assessment && claim.assessment.submissionConfig) {
    return isAssessmentOpenForClaim(claim.assessment);
  }

  return true;
}

async function findLiveCourseDeviceClaims(courseId, deviceIdHash) {
  const claims = await PublicSubmissionClaim.find({
    course: courseId,
    deviceIdHash,
    active: true,
  })
    .populate('assessment', 'name submissionConfig')
    .sort({ claimedAt: 1 });

  return claims.filter((claim) => isPublicSubmissionClaimLive(claim));
}

async function findLiveCourseStudentClaims(courseId, studentId) {
  const claims = await PublicSubmissionClaim.find({
    course: courseId,
    student: studentId,
    active: true,
  })
    .populate('assessment', 'name submissionConfig')
    .sort({ claimedAt: 1 });

  return claims.filter((claim) => isPublicSubmissionClaimLive(claim));
}

async function ensureAssessmentClaim({ req, link, assessment, student, deviceId }) {
  if (!isValidPublicDeviceId(deviceId)) {
    const error = new Error('This browser could not be identified. Refresh the page and try again.');
    error.status = 400;
    error.code = 'DEVICE_ID_REQUIRED';
    throw error;
  }

  if (!isAssessmentOpenForClaim(assessment)) return null;

  // An assessment may be reused or reopened after an earlier deadline. Expired
  // active rows must not block the new session or make a refreshed browser look unlocked.
  await deactivateExpiredAssessmentClaims(assessment._id);

  const deviceIdHash = hashPublicDeviceId(deviceId);
  const assessmentId = assessment._id;
  const courseId = link.course._id || link.course;

  // A browser/PC remains owned by the same roll for the whole live submission
  // window, even if the teacher changes the public-link token or switches to a
  // different assessment that overlaps with the first one.
  const [liveDeviceClaims, liveStudentClaims] = await Promise.all([
    findLiveCourseDeviceClaims(courseId, deviceIdHash),
    findLiveCourseStudentClaims(courseId, student._id),
  ]);

  const foreignDeviceClaim = liveDeviceClaims.find(
    (claim) => String(claim.student) !== String(student._id)
  );
  if (foreignDeviceClaim) {
    const error = new Error(
      `This browser is already locked to roll ${foreignDeviceClaim.roll} until the current submission session ends.`
    );
    error.status = 409;
    error.code = 'DEVICE_LOCKED';
    error.lockedRoll = foreignDeviceClaim.roll;
    throw error;
  }

  const foreignStudentClaim = liveStudentClaims.find(
    (claim) => claim.deviceIdHash !== deviceIdHash
  );
  if (foreignStudentClaim) {
    const error = new Error(
      'This roll is already locked to another browser/device until the current submission session ends. Ask the teacher to release the lock if needed.'
    );
    error.status = 409;
    error.code = 'ROLL_LOCKED';
    throw error;
  }

  const deviceClaim = await PublicSubmissionClaim.findOne({
    assessment: assessmentId,
    deviceIdHash,
    active: true,
  });

  if (deviceClaim && String(deviceClaim.student) !== String(student._id)) {
    const error = new Error(
      `This browser is already locked to roll ${deviceClaim.roll} for this submission session.`
    );
    error.status = 409;
    error.code = 'DEVICE_LOCKED';
    error.lockedRoll = deviceClaim.roll;
    throw error;
  }

  const studentClaim = await PublicSubmissionClaim.findOne({
    assessment: assessmentId,
    student: student._id,
    active: true,
  });

  if (studentClaim && studentClaim.deviceIdHash !== deviceIdHash) {
    const error = new Error(
      'This roll is already locked to another browser/device for this submission session. Ask the teacher to release the lock if the previous computer cannot be used.'
    );
    error.status = 409;
    error.code = 'ROLL_LOCKED';
    throw error;
  }

  if (deviceClaim) return deviceClaim;
  if (studentClaim) return studentClaim;

  try {
    return await PublicSubmissionClaim.create({
      publicSubmissionLink: link._id,
      course: link.course._id || link.course,
      assessment: assessmentId,
      student: student._id,
      roll: student.username || '',
      deviceIdHash,
      userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500),
      ipAddress: String(getRequestIp(req) || '').slice(0, 120),
      claimedAt: new Date(),
      expiresAt: getAssessmentLockExpiry(assessment),
      active: true,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;

    // A simultaneous request may have created the lock first. Re-check it and
    // return a clear conflict rather than surfacing a database duplicate error.
    const racedDeviceClaim = await PublicSubmissionClaim.findOne({
      assessment: assessmentId,
      deviceIdHash,
      active: true,
    });
    if (racedDeviceClaim && String(racedDeviceClaim.student) === String(student._id)) {
      return racedDeviceClaim;
    }
    if (racedDeviceClaim) {
      const conflict = new Error(
        `This browser is already locked to roll ${racedDeviceClaim.roll} for this submission session.`
      );
      conflict.status = 409;
      conflict.code = 'DEVICE_LOCKED';
      conflict.lockedRoll = racedDeviceClaim.roll;
      throw conflict;
    }

    const racedStudentClaim = await PublicSubmissionClaim.findOne({
      assessment: assessmentId,
      student: student._id,
      active: true,
    });
    if (racedStudentClaim && racedStudentClaim.deviceIdHash === deviceIdHash) {
      return racedStudentClaim;
    }

    const conflict = new Error(
      'This roll is already locked to another browser/device for this submission session.'
    );
    conflict.status = 409;
    conflict.code = 'ROLL_LOCKED';
    throw conflict;
  }
}

async function ensureClaimsForOpenAssessments({ req, link, assessments, student, deviceId }) {
  const openAssessments = assessments.filter(isAssessmentOpenForClaim);
  const claims = [];

  // Validate all existing conflicts before creating anything so a student does
  // not end up with a partial set of locks when multiple tasks are open.
  const deviceIdHash = hashPublicDeviceId(deviceId);
  if (!isValidPublicDeviceId(deviceId)) {
    const error = new Error('This browser could not be identified. Refresh the page and try again.');
    error.status = 400;
    error.code = 'DEVICE_ID_REQUIRED';
    throw error;
  }

  for (const assessment of openAssessments) {
    await deactivateExpiredAssessmentClaims(assessment._id);

    const [deviceClaim, studentClaim] = await Promise.all([
      PublicSubmissionClaim.findOne({ assessment: assessment._id, deviceIdHash, active: true }),
      PublicSubmissionClaim.findOne({ assessment: assessment._id, student: student._id, active: true }),
    ]);

    if (deviceClaim && String(deviceClaim.student) !== String(student._id)) {
      const error = new Error(
        `This browser is already locked to roll ${deviceClaim.roll} until the current submission session ends.`
      );
      error.status = 409;
      error.code = 'DEVICE_LOCKED';
      error.lockedRoll = deviceClaim.roll;
      throw error;
    }

    if (studentClaim && studentClaim.deviceIdHash !== deviceIdHash) {
      const error = new Error(
        'This roll is already locked to another browser/device until the current submission session ends. Ask the teacher to release the lock if needed.'
      );
      error.status = 409;
      error.code = 'ROLL_LOCKED';
      throw error;
    }
  }

  // Claim only the session that ends first. This is important for exam slots
  // that can overlap: verifying a Slot-1 student must not automatically reserve
  // the same PC for a later Slot-2 assessment merely because Slot 2 is already
  // visible. Uploading another assessment will create its own claim only when
  // that student actually submits to it.
  const sessionAssessment = [...openAssessments].sort((a, b) => {
    const aDue = getValidDate(a?.submissionConfig?.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDue = getValidDate(b?.submissionConfig?.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  })[0];

  if (sessionAssessment) {
    const claim = await ensureAssessmentClaim({
      req,
      link,
      assessment: sessionAssessment,
      student,
      deviceId,
    });
    if (claim) claims.push(claim);
  }

  return claims;
}

function normalizeDeviceLock(claims = [], assessments = []) {
  if (!claims.length) return null;

  const assessmentMap = new Map(assessments.map((item) => [String(item._id), item]));
  const liveClaims = claims.filter((claim) => {
    if (!claim?.active) return false;

    const mappedAssessment = assessmentMap.get(String(claim.assessment?._id || claim.assessment));
    if (mappedAssessment) return isAssessmentOpenForClaim(mappedAssessment);

    return isPublicSubmissionClaimLive(claim);
  });

  if (!liveClaims.length) return null;

  const dueDates = liveClaims
    .map((claim) => {
      const claimExpiry = getValidDate(claim.expiresAt);
      if (claimExpiry) return claimExpiry;

      const mappedAssessment = assessmentMap.get(String(claim.assessment?._id || claim.assessment));
      return getValidDate(mappedAssessment?.submissionConfig?.dueDate);
    })
    .filter(Boolean)
    .map((date) => date.getTime());

  return {
    locked: true,
    claimedAt: new Date(
      liveClaims.reduce((min, claim) => {
        const value = getValidDate(claim.claimedAt)?.getTime() || Date.now();
        return Math.min(min, value);
      }, Number.MAX_SAFE_INTEGER)
    ),
    lockedUntil:
      dueDates.length === liveClaims.length
        ? new Date(Math.max(...dueDates))
        : null,
    assessmentIds: liveClaims.map((claim) =>
      String(claim.assessment?._id || claim.assessment)
    ),
  };
}

async function buildStudentAssessmentResponse({ link, student, assessments }) {
  const submissions = await LabSubmission.find({
    course: link.course._id || link.course,
    student: student._id,
    assessment: { $in: assessments.map((item) => item._id) },
  });

  const submissionMap = Object.fromEntries(
    submissions.map((item) => [String(item.assessment), item])
  );

  return attachSignedUrlsToAssessments(assessments, submissionMap);
}

async function removeFileIfExists(filePath) {
  try {
    if (filePath) await deleteSubmissionObject(filePath);
  } catch (err) {
    console.error('Old public submission file delete failed:', err.message);
  }
}

async function attachSignedUrlsToAssessments(assessments, submissionMap) {
  return Promise.all(
    assessments.map(async (assessment) => {
      const sub = submissionMap[String(assessment._id)] || null;
      const normalized = normalizeAssessment(assessment, sub);

      if (sub?.filePath && normalized.submission) {
        try {
          normalized.submission.downloadUrl = await createSubmissionSignedUrl(sub.filePath);
        } catch (err) {
          console.error('Public signed URL generation failed:', err.message);
          normalized.submission.downloadUrl = '';
        }
      }

      return normalized;
    })
  );
}

// ---------------- TEACHER ----------------

const getTeacherPublicSubmissionLink = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const link = await getOrCreateCourseLink(course, req.user.userId);

    return res.json({
      link: normalizeLink(link),
    });
  } catch (err) {
    console.error('getTeacherPublicSubmissionLink error', err);
    return res.status(500).json({ message: 'Failed to load public submission link.' });
  }
};

const updateTeacherPublicSubmissionLink = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      isActive,
      showOnPortal,
      portalVisibleFrom,
      portalVisibleUntil,
      assessmentIds = [],
      title,
      instructions,
    } = req.body || {};

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const link = await getOrCreateCourseLink(course, req.user.userId);

    const cleanIds = Array.isArray(assessmentIds)
      ? Array.from(
        new Set(
          assessmentIds
            .map((id) => String(id || '').trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
        )
      )
      : [];

    const validAssessments = cleanIds.length
      ? await Assessment.find({
        _id: { $in: cleanIds },
        course: courseId,
        structureType: 'lab_submission',
      }).select('_id')
      : [];

    link.assessmentIds = validAssessments.map((item) => item._id);

    const requestedActive =
      isActive !== undefined ? !!isActive : !!link.isActive;
    const requestedAsMainSubmitPage =
      showOnPortal !== undefined ? !!showOnPortal : link.showOnPortal === true;

    // The shared /submit address can point to only one course at a time.
    // Choosing this course as the main page also enables its public link.
    link.showOnPortal = requestedAsMainSubmitPage;
    link.isActive = requestedAsMainSubmitPage ? true : requestedActive;

    if (!link.isActive) {
      link.showOnPortal = false;
    }

    const parsedVisibleFrom = parseOptionalDate(portalVisibleFrom);
    const parsedVisibleUntil = parseOptionalDate(portalVisibleUntil);

    if (portalVisibleFrom !== undefined && parsedVisibleFrom === undefined) {
      return res.status(400).json({ message: 'The portal start date/time is invalid.' });
    }

    if (portalVisibleUntil !== undefined && parsedVisibleUntil === undefined) {
      return res.status(400).json({ message: 'The portal end date/time is invalid.' });
    }

    if (parsedVisibleFrom !== undefined) {
      link.portalVisibleFrom = parsedVisibleFrom;
    }

    if (parsedVisibleUntil !== undefined) {
      link.portalVisibleUntil = parsedVisibleUntil;
    }

    const effectiveFrom = getValidDate(link.portalVisibleFrom);
    const effectiveUntil = getValidDate(link.portalVisibleUntil);
    if (effectiveFrom && effectiveUntil && effectiveFrom > effectiveUntil) {
      return res.status(400).json({
        message: 'The portal end date/time must be later than the start date/time.',
      });
    }

    if (title !== undefined) {
      link.title = String(title || '').trim() || `${course.code || 'Course'} Public Submission`;
    }

    if (instructions !== undefined) {
      link.instructions = String(instructions || '').trim();
    }

    if (link.showOnPortal) {
      // Make the shared /submit destination exclusive while preserving every
      // course-specific token link and its public-upload enabled state.
      await PublicSubmissionLink.updateMany(
        { _id: { $ne: link._id }, showOnPortal: { $ne: false } },
        { $set: { showOnPortal: false } }
      );
    }

    await link.save();

    return res.json({
      message: 'Public submission link updated successfully.',
      link: normalizeLink(link),
    });
  } catch (err) {
    console.error('updateTeacherPublicSubmissionLink error', err);
    return res.status(500).json({ message: 'Failed to update public submission link.' });
  }
};


const getTeacherPublicSubmissionClaims = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: 'Course not found.' });

    // Show every still-live lock for the course, not only locks tied to the
    // assessment currently selected on /submit. This keeps Teacher Release
    // available when the public portal is switched between exam slots.
    const claims = await PublicSubmissionClaim.find({
      course: course._id,
      active: true,
    })
      .populate('assessment', 'name submissionConfig')
      .populate('student', 'name username')
      .sort({ claimedAt: -1 });

    const groups = new Map();
    for (const claim of claims) {
      if (!isPublicSubmissionClaimLive(claim)) continue;

      const key = `${claim.deviceIdHash}:${String(claim.student?._id || claim.student)}`;
      const claimDueDate =
        claim.expiresAt || claim.assessment?.submissionConfig?.dueDate || null;

      if (!groups.has(key)) {
        groups.set(key, {
          id: claim._id.toString(),
          student: {
            id: claim.student?._id?.toString?.() || String(claim.student || ''),
            name: claim.student?.name || '',
            roll: claim.student?.username || claim.roll || '',
          },
          roll: claim.roll || claim.student?.username || '',
          deviceRef: claim.deviceIdHash.slice(0, 8).toUpperCase(),
          claimedAt: claim.claimedAt,
          lockedUntil: claimDueDate,
          hasOpenEndedLock: !claimDueDate,
          assessments: [],
        });
      }

      const group = groups.get(key);
      group.assessments.push({
        id: claim.assessment?._id?.toString?.() || String(claim.assessment || ''),
        name: claim.assessment?.name || 'Submission',
        dueDate: claimDueDate,
      });

      if (new Date(claim.claimedAt).getTime() < new Date(group.claimedAt).getTime()) {
        group.claimedAt = claim.claimedAt;
      }

      if (!claimDueDate) {
        group.hasOpenEndedLock = true;
        group.lockedUntil = null;
      } else if (!group.hasOpenEndedLock) {
        if (!group.lockedUntil || new Date(claimDueDate) > new Date(group.lockedUntil)) {
          group.lockedUntil = claimDueDate;
        }
      }
    }

    return res.json({ claims: Array.from(groups.values()) });
  } catch (err) {
    console.error('getTeacherPublicSubmissionClaims error', err);
    return res.status(500).json({ message: 'Failed to load active submission device locks.' });
  }
};

const releaseTeacherPublicSubmissionClaim = async (req, res) => {
  try {
    const { courseId, claimId } = req.params;
    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: 'Course not found.' });

    const claim = await PublicSubmissionClaim.findOne({
      _id: claimId,
      course: course._id,
      active: true,
    });

    if (!claim) {
      return res.status(404).json({ message: 'Active device lock not found.' });
    }

    const result = await PublicSubmissionClaim.updateMany(
      {
        course: course._id,
        student: claim.student,
        deviceIdHash: claim.deviceIdHash,
        active: true,
      },
      {
        $set: {
          active: false,
          releasedAt: new Date(),
          releasedBy: req.user.userId,
        },
      }
    );

    return res.json({
      message: 'Submission device lock released successfully.',
      releasedCount: Number(result.modifiedCount || 0),
    });
  } catch (err) {
    console.error('releaseTeacherPublicSubmissionClaim error', err);
    return res.status(500).json({ message: 'Failed to release the submission device lock.' });
  }
};

// ---------------- PUBLIC STUDENT ACCESS ----------------

const getPublicSubmissionPortal = async (_req, res) => {
  try {
    const now = new Date();
    const links = await PublicSubmissionLink.find({
      isActive: true,
      showOnPortal: { $ne: false },
    })
      .populate('course')
      .populate('teacher', 'name department designation')
      .sort({ updatedAt: -1 });

    const portalRows = await Promise.all(
      links.map(async (link) => {
        if (!link.course || link.course.archived === true || !isPortalListingVisible(link, now)) {
          return null;
        }

        const assessments = await getSelectedAssessments(link, link.course._id);
        if (!assessments.length) return null;

        const normalizedAssessments = assessments.map((assessment) => normalizeAssessment(assessment));
        const openAssessments = normalizedAssessments.filter((assessment) => assessment.submissionsOpen);
        const upcomingDeadlines = normalizedAssessments
          .map((assessment) => getValidDate(assessment.dueDate))
          .filter((date) => date && date >= now)
          .sort((a, b) => a - b);

        return {
          token: link.token,
          title: link.title || `${link.course.code || 'Course'} Public Submission`,
          instructions: link.instructions || '',
          course: normalizeCourse(link.course),
          teacher: normalizeTeacher(link.teacher),
          assessmentCount: normalizedAssessments.length,
          openAssessmentCount: openAssessments.length,
          nextDeadline: upcomingDeadlines[0] || null,
          assessments: normalizedAssessments.map((assessment) => ({
            id: assessment.id,
            name: assessment.name,
            fullMarks: assessment.fullMarks,
            dueDate: assessment.dueDate,
            submissionsOpen: assessment.submissionsOpen,
            dueDatePassed: assessment.dueDatePassed,
          })),
        };
      })
    );

    const courses = portalRows
      .filter(Boolean)
      .sort((a, b) => {
        const aOpen = a.openAssessmentCount > 0 ? 0 : 1;
        const bOpen = b.openAssessmentCount > 0 ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;

        const aDeadline = a.nextDeadline ? new Date(a.nextDeadline).getTime() : Number.MAX_SAFE_INTEGER;
        const bDeadline = b.nextDeadline ? new Date(b.nextDeadline).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDeadline !== bDeadline) return aDeadline - bDeadline;

        return String(a.course?.code || '').localeCompare(String(b.course?.code || ''));
      });

    return res.json({
      portalTitle: 'BUBT Public Submission Portal',
      generatedAt: now,
      courses,
    });
  } catch (err) {
    console.error('getPublicSubmissionPortal error', err);
    return res.status(500).json({ message: 'Failed to load the public submission portal.' });
  }
};

const getCurrentPublicSubmissionPage = async (_req, res) => {
  try {
    const now = new Date();

    // New settings keep this exclusive. Sorting also gives a safe fallback for
    // older databases where more than one record may still be marked for /submit.
    const candidates = await PublicSubmissionLink.find({
      isActive: true,
      showOnPortal: true,
    })
      .populate('course')
      .populate('teacher', 'name department designation')
      .sort({ updatedAt: -1 });

    for (const link of candidates) {
      if (!link.course || link.course.archived === true || !isPortalListingVisible(link, now)) {
        continue;
      }

      const assessments = await getSelectedAssessments(link, link.course._id);
      if (!assessments.length) continue;

      return res.json({
        link: normalizeLink(link),
        course: normalizeCourse(link.course),
        teacher: normalizeTeacher(link.teacher),
        assessments: assessments.map((assessment) => normalizeAssessment(assessment)),
      });
    }

    return res.status(404).json({
      message: 'No course is currently selected for the /submit page.',
    });
  } catch (err) {
    console.error('getCurrentPublicSubmissionPage error', err);
    return res.status(500).json({ message: 'Failed to load the current public submission page.' });
  }
};

const getPublicSubmissionPage = async (req, res) => {
  try {
    const { token } = req.params;

    const link = await PublicSubmissionLink.findOne({ token })
      .populate('course')
      .populate('teacher', 'name department designation');

    if (!link || !link.course || link.course.archived === true) {
      return res.status(404).json({ message: 'Public submission link not found.' });
    }

    if (!link.isActive) {
      return res.status(403).json({ message: 'This public submission link is currently disabled.' });
    }

    const assessments = await getSelectedAssessments(link, link.course._id);

    return res.json({
      link: normalizeLink(link),
      course: normalizeCourse(link.course),
      teacher: normalizeTeacher(link.teacher),
      assessments: assessments.map((assessment) => normalizeAssessment(assessment)),
    });
  } catch (err) {
    console.error('getPublicSubmissionPage error', err);
    return res.status(500).json({ message: 'Failed to load public submission page.' });
  }
};

const verifyPublicRoll = async (req, res) => {
  try {
    const { token } = req.params;
    const { roll } = req.body || {};
    const deviceId = getPublicDeviceId(req);

    const link = await PublicSubmissionLink.findOne({ token }).populate('course');

    if (!link || !link.course || link.course.archived === true) {
      return res.status(404).json({ message: 'Public submission link not found.' });
    }

    if (!link.isActive) {
      return res.status(403).json({ message: 'This public submission link is currently disabled.' });
    }

    const result = await findStudentEnrollmentByRoll(link.course._id, roll);
    if (result?.ambiguous) {
      return res.status(409).json({
        message: 'Multiple students matched these last digits. Please enter the full roll number.',
        matchedRolls: result.matchedRolls || [],
      });
    }
    if (!result) {
      return res.status(404).json({ message: 'Roll number was not found in this course.' });
    }

    const assessments = await getSelectedAssessments(link, link.course._id);
    const eligibleAssessments = filterEligibleAssessments(
      assessments,
      result.student._id
    );

    if (!eligibleAssessments.length) {
      return res.status(403).json({
        message: 'No public submission assessment is assigned to this roll number.',
      });
    }

    const claims = await ensureClaimsForOpenAssessments({
      req,
      link,
      assessments: eligibleAssessments,
      student: result.student,
      deviceId,
    });

    const assessmentRows = await buildStudentAssessmentResponse({
      link,
      student: result.student,
      assessments: eligibleAssessments,
    });

    return res.json({
      student: {
        id: result.student._id.toString(),
        name: result.student.name || '',
        roll: result.student.username || '',
      },
      deviceLock: normalizeDeviceLock(claims, assessments),
      assessments: assessmentRows,
    });
  } catch (err) {
    console.error('verifyPublicRoll error', err);
    return res.status(err?.status || 500).json({
      message: err?.status ? err.message : 'Failed to verify roll number.',
      code: err?.code || undefined,
      lockedRoll: err?.lockedRoll || undefined,
    });
  }
};

const getPublicDeviceSession = async (req, res) => {
  try {
    const { token } = req.params;
    const deviceId = getPublicDeviceId(req);

    if (!isValidPublicDeviceId(deviceId)) {
      return res.json({ locked: false, released: false });
    }

    const link = await PublicSubmissionLink.findOne({ token }).populate('course');
    if (!link || !link.course || link.course.archived === true || !link.isActive) {
      return res.json({ locked: false, released: false });
    }

    const assessments = await getSelectedAssessments(link, link.course._id);
    const deviceIdHash = hashPublicDeviceId(deviceId);

    // Restore by COURSE + DEVICE, not by the current public-link record. The
    // teacher can edit/recreate/switch the /submit link while an exam is active;
    // that must not make an already-claimed PC look new after a refresh.
    const allClaims = await PublicSubmissionClaim.find({
      course: link.course._id,
      deviceIdHash,
      active: true,
    })
      .populate('assessment', 'name submissionConfig')
      .sort({ claimedAt: 1 });

    const claims = allClaims.filter((claim) => isPublicSubmissionClaimLive(claim));

    if (!claims.length) {
      const releasedClaim = await PublicSubmissionClaim.findOne({
        course: link.course._id,
        deviceIdHash,
        active: false,
        releasedAt: { $ne: null },
      }).sort({ releasedAt: -1 });

      return res.json({
        locked: false,
        released: Boolean(releasedClaim),
        releasedAt: releasedClaim?.releasedAt || null,
      });
    }

    // The oldest live claim owns the browser until that session ends. This also
    // handles old data safely if multiple claims were accidentally created.
    const canonicalClaim = claims[0];
    const student = await User.findById(canonicalClaim.student);
    if (!student) return res.json({ locked: false, released: false });

    const eligibleAssessments = filterEligibleAssessments(assessments, student._id);
    const assessmentRows = await buildStudentAssessmentResponse({
      link,
      student,
      assessments: eligibleAssessments,
    });

    return res.json({
      locked: true,
      student: {
        id: student._id.toString(),
        name: student.name || '',
        roll: student.username || canonicalClaim.roll || '',
      },
      deviceLock: normalizeDeviceLock(claims, eligibleAssessments),
      assessments: assessmentRows,
    });
  } catch (err) {
    console.error('getPublicDeviceSession error', err);
    return res.status(500).json({ message: 'Failed to restore this browser submission session.' });
  }
};

const getPublicSubmittedFiles = async (req, res) => {
  try {
    const { token } = req.params;
    const { roll } = req.query || {};
    const deviceId = getPublicDeviceId(req);

    const link = await PublicSubmissionLink.findOne({ token }).populate('course');

    if (!link || !link.course || link.course.archived === true) {
      return res.status(404).json({ message: 'Public submission link not found.' });
    }

    if (!link.isActive) {
      return res.status(403).json({ message: 'This public submission link is currently disabled.' });
    }

    const result = await findStudentEnrollmentByRoll(link.course._id, roll);
    if (result?.ambiguous) {
      return res.status(409).json({
        message: 'Multiple students matched these last digits. Please enter the full roll number.',
        matchedRolls: result.matchedRolls || [],
      });
    }
    if (!result) {
      return res.status(404).json({ message: 'Roll number was not found in this course.' });
    }

    const assessments = await getSelectedAssessments(link, link.course._id);
    const eligibleAssessments = filterEligibleAssessments(
      assessments,
      result.student._id
    );

    if (!eligibleAssessments.length) {
      return res.status(403).json({
        message: 'No public submission assessment is assigned to this roll number.',
      });
    }

    await ensureClaimsForOpenAssessments({
      req,
      link,
      assessments: eligibleAssessments,
      student: result.student,
      deviceId,
    });

    return res.json({
      assessments: await buildStudentAssessmentResponse({
        link,
        student: result.student,
        assessments: eligibleAssessments,
      }),
    });
  } catch (err) {
    console.error('getPublicSubmittedFiles error', err);
    return res.status(err?.status || 500).json({
      message: err?.status ? err.message : 'Failed to load submitted files.',
      code: err?.code || undefined,
      lockedRoll: err?.lockedRoll || undefined,
    });
  }
};

const submitPublicAssessmentFile = async (req, res) => {
  try {
    const { token, assessmentId } = req.params;
    const { roll } = req.body || {};
    const deviceId = getPublicDeviceId(req);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Please select a file before submitting.' });
    }

    const link = await PublicSubmissionLink.findOne({ token }).populate('course');

    if (!link || !link.course || link.course.archived === true) {
      return res.status(404).json({ message: 'Public submission link not found.' });
    }

    if (!link.isActive) {
      return res.status(403).json({ message: 'This public submission link is currently disabled.' });
    }

    const selectedIds = (link.assessmentIds || []).map((id) => id.toString());
    if (!selectedIds.includes(String(assessmentId))) {
      return res.status(403).json({ message: 'This submission task is not available from this public link.' });
    }

    const result = await findStudentEnrollmentByRoll(link.course._id, roll);
    if (result?.ambiguous) {
      return res.status(409).json({
        message: 'Multiple students matched these last digits. Please enter the full roll number.',
        matchedRolls: result.matchedRolls || [],
      });
    }
    if (!result) {
      return res.status(404).json({ message: 'Roll number was not found in this course.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: link.course._id,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res.status(404).json({ message: 'Submission assessment not found.' });
    }

    const cfg = assessment.submissionConfig || {};

    if (!isAssessmentEligibleForStudent(assessment, result.student._id)) {
      return res.status(403).json({
        message: 'This submission assessment is not assigned to this roll number.',
      });
    }

    if (!isSubmissionCurrentlyOpen(cfg)) {
      return res.status(400).json({
        message: hasSubmissionDueDatePassed(cfg)
          ? 'Submission deadline has passed for this task.'
          : 'Submission is currently closed for this task.',
      });
    }

    await ensureAssessmentClaim({
      req,
      link,
      assessment,
      student: result.student,
      deviceId,
    });

    const allowedExtensions = normalizeAllowedExtensions(cfg.allowedExtensions);
    const uploadedExt = getFileExtension(file.originalname);

    if (!allowedExtensions.includes(uploadedExt)) {
      return res.status(400).json({
        message: `Invalid file type. Only ${formatAllowedExtensions(allowedExtensions)} files are allowed for this task.`,
      });
    }

    const maxFileSizeMB = Number(cfg.maxFileSizeMB || 10);
    const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

    if (Number(file.size || 0) > maxFileSizeBytes) {
      return res.status(400).json({
        message: `File size must be less than or equal to ${maxFileSizeMB} MB.`,
      });
    }

    const existing = await LabSubmission.findOne({
      assessment: assessment._id,
      student: result.student._id,
    });

    const allowResubmission = cfg.allowResubmission !== false;

    if (existing && !allowResubmission) {
      return res.status(400).json({ message: 'Resubmission is disabled for this assessment.' });
    }

    const integrity = await buildSubmissionIntegrity(file.buffer, file.originalname);

    const storagePath = buildSubmissionStoragePath({
      courseId: assessment.course.toString(),
      assessmentId: assessment._id.toString(),
      studentId: result.student._id.toString(),
      originalFileName: file.originalname,
    });

    await uploadSubmissionBuffer({
      buffer: file.buffer,
      storagePath,
      mimeType: file.mimetype || 'application/octet-stream',
    });

    const payload = {
      course: assessment.course,
      assessment: assessment._id,
      student: result.student._id,
      roll: result.student.username,
      originalFileName: file.originalname,
      storedFileName: path.basename(storagePath),
      filePath: storagePath,
      fileUrl: storagePath,
      mimeType: file.mimetype || '',
      fileSize: Number(file.size || 0),
      status: 'submitted',
      teacherNote: '',
      awardedMarks: null,
      syncedToMarks: false,
      syncedAt: null,
      submittedAt: new Date(),
      checkedAt: null,
      storageDeleted: false,
      source: 'public-link',
      publicSubmissionLink: link._id,
      fileSha256: integrity.fileSha256 || '',
      contentSha256: integrity.contentSha256 || '',
      contentFingerprintType: integrity.contentFingerprintType || '',
    };

    let submission;

    if (existing) {
      const oldPath = existing.filePath;
      Object.assign(existing, payload);
      submission = await existing.save();

      if (oldPath && oldPath !== storagePath) {
        await removeFileIfExists(oldPath);
      }
    } else {
      submission = await LabSubmission.create(payload);
    }

    let downloadUrl = '';
    try {
      downloadUrl = await createSubmissionSignedUrl(submission.filePath);
    } catch (err) {
      console.error('Public signed URL generation failed:', err.message);
    }

    return res.status(201).json({
      message: existing ? 'File replaced successfully.' : 'File submitted successfully.',
      submission: {
        id: submission._id.toString(),
        originalFileName: submission.originalFileName,
        fileUrl: submission.fileUrl,
        downloadUrl,
        submittedAt: submission.submittedAt,
        status: submission.status,
        source: submission.source,
      },
    });
  } catch (err) {
    console.error('submitPublicAssessmentFile error', err);
    return res.status(err?.status || 500).json({
      message: err?.status ? err.message : 'Failed to submit file.',
      code: err?.code || undefined,
      lockedRoll: err?.lockedRoll || undefined,
    });
  }
};

module.exports = {
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
};
