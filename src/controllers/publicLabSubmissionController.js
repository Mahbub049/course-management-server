const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');

const Assessment = require('../models/Assessment');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const LabSubmission = require('../models/LabSubmission');
const PublicSubmissionLink = require('../models/PublicSubmissionLink');
const User = require('../models/User');

const {
  buildSubmissionStoragePath,
  uploadSubmissionBuffer,
  deleteSubmissionObject,
  createSubmissionSignedUrl,
} = require('../utils/labSubmissionStorage');

const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'zip',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'c',
  'cpp',
  'java',
  'py',
  'js',
  'jsx',
  'html',
  'css',
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
    assessmentIds: (link.assessmentIds || []).map((id) => id.toString()),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
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

    if (isActive !== undefined) {
      link.isActive = !!isActive;
    }

    if (title !== undefined) {
      link.title = String(title || '').trim() || `${course.code || 'Course'} Public Submission`;
    }

    if (instructions !== undefined) {
      link.instructions = String(instructions || '').trim();
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

// ---------------- PUBLIC STUDENT ACCESS ----------------

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
    const submissions = await LabSubmission.find({
      course: link.course._id,
      student: result.student._id,
      assessment: { $in: assessments.map((item) => item._id) },
    });

    const submissionMap = Object.fromEntries(
      submissions.map((item) => [String(item.assessment), item])
    );

    const assessmentRows = await attachSignedUrlsToAssessments(assessments, submissionMap);

    return res.json({
      student: {
        id: result.student._id.toString(),
        name: result.student.name || '',
        roll: result.student.username || '',
      },
      assessments: assessmentRows,
    });
  } catch (err) {
    console.error('verifyPublicRoll error', err);
    return res.status(500).json({ message: 'Failed to verify roll number.' });
  }
};

const getPublicSubmittedFiles = async (req, res) => {
  try {
    const { token } = req.params;
    const { roll } = req.query || {};

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
    const submissions = await LabSubmission.find({
      course: link.course._id,
      student: result.student._id,
      assessment: { $in: assessments.map((item) => item._id) },
    });

    const submissionMap = Object.fromEntries(
      submissions.map((item) => [String(item.assessment), item])
    );

    return res.json({
      assessments: await attachSignedUrlsToAssessments(assessments, submissionMap),
    });
  } catch (err) {
    console.error('getPublicSubmittedFiles error', err);
    return res.status(500).json({ message: 'Failed to load submitted files.' });
  }
};

const submitPublicAssessmentFile = async (req, res) => {
  try {
    const { token, assessmentId } = req.params;
    const { roll } = req.body || {};
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

    if (!isSubmissionCurrentlyOpen(cfg)) {
      return res.status(400).json({
        message: hasSubmissionDueDatePassed(cfg)
          ? 'Submission deadline has passed for this task.'
          : 'Submission is currently closed for this task.',
      });
    }

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
    return res.status(500).json({ message: 'Failed to submit file.' });
  }
};

module.exports = {
  getTeacherPublicSubmissionLink,
  updateTeacherPublicSubmissionLink,
  getPublicSubmissionPage,
  verifyPublicRoll,
  getPublicSubmittedFiles,
  submitPublicAssessmentFile,
};
