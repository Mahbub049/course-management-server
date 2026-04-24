const archiver = require('archiver');
const path = require('path');

const Assessment = require('../models/Assessment');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const User = require('../models/User');
const Mark = require('../models/Mark');
const LabSubmission = require('../models/LabSubmission');

const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'zip',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
];

const {
  buildSubmissionStoragePath,
  uploadSubmissionBuffer,
  deleteSubmissionObject,
  createSubmissionSignedUrl,
  downloadSubmissionBuffer,
} = require('../utils/labSubmissionStorage');

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

function normalizeSubmissionAssessment(a) {
  const cfg = a?.submissionConfig || {};
  const dueDatePassed = hasSubmissionDueDatePassed(cfg);
  const submissionsOpen = isSubmissionCurrentlyOpen(cfg);

  return {
    id: a._id.toString(),
    _id: a._id.toString(),
    course: a.course?.toString?.() || a.course,
    name: a.name,
    fullMarks: Number(a.fullMarks || 0),
    structureType: a.structureType,
    dueDate: cfg.dueDate || null,
    instructions: cfg.instructions || '',
    maxFileSizeMB: Number(cfg.maxFileSizeMB || 10),
    allowedExtensions: Array.isArray(cfg.allowedExtensions)
      ? cfg.allowedExtensions
      : DEFAULT_ALLOWED_EXTENSIONS,
    allowResubmission: cfg.allowResubmission !== false,
    isVisibleToStudents: !!cfg.isVisibleToStudents,
    visibleAt: cfg.visibleAt || null,
    submissionsOpen,
    closedAt: cfg.closedAt || null,
    dueDatePassed,
    closedReason: getSubmissionClosedReason(cfg),
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null,
  };
}

async function ensureTeacherCourse(courseId, teacherId) {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
}

async function ensureStudentEnrollment(courseId, studentId) {
  return Enrollment.findOne({ course: courseId, student: studentId }).populate(
    'course'
  );
}

async function removeFileIfExists(filePath) {
  try {
    if (filePath) {
      await deleteSubmissionObject(filePath);
    }
  } catch (_err) { }
}

function safeArchiveFileName(roll, originalFileName) {
  const ext = path.extname(originalFileName || '');
  const base = path
    .basename(originalFileName || 'file', ext)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 100);

  return `${roll || 'student'}_${base}${ext}`;
}

// -------------------------------------
// Teacher
// -------------------------------------

const createTeacherSubmissionAssessment = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      name,
      fullMarks = 10,
      submissionConfig = {},
      order = 0,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Assessment name is required.' });
    }

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.create({
      course: courseId,
      name: String(name).trim(),
      fullMarks: Number(fullMarks || 10),
      order: Number(order || 0),
      structureType: 'lab_submission',
      submissionConfig: {
        instructions: String(submissionConfig.instructions || '').trim(),
        dueDate: submissionConfig.dueDate || null,
        allowedExtensions: Array.isArray(submissionConfig.allowedExtensions)
          ? submissionConfig.allowedExtensions
          : DEFAULT_ALLOWED_EXTENSIONS,
        maxFileSizeMB: Number(submissionConfig.maxFileSizeMB || 10),
        allowResubmission: submissionConfig.allowResubmission !== false,
        isVisibleToStudents: false,
        visibleAt: null,
        submissionsOpen: true,
        closedAt: null,
      },
      isPublished: false,
      publishedAt: null,
    });

    return res.status(201).json({
      message: 'Submission assessment created successfully.',
      assessment: normalizeSubmissionAssessment(assessment),
    });
  } catch (err) {
    console.error('createTeacherSubmissionAssessment error', err);
    return res
      .status(500)
      .json({ message: 'Failed to create submission assessment.' });
  }
};

const getTeacherSubmissionAssessments = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessments = await Assessment.find({
      course: courseId,
      structureType: 'lab_submission',
    }).sort({ order: 1, createdAt: -1 });

    const assessmentIds = assessments.map((a) => a._id);

    const counts = await LabSubmission.aggregate([
      { $match: { assessment: { $in: assessmentIds } } },
      { $group: { _id: '$assessment', count: { $sum: 1 } } },
    ]);

    const countMap = Object.fromEntries(
      counts.map((item) => [String(item._id), item.count])
    );

    return res.json(
      assessments.map((a) => ({
        ...normalizeSubmissionAssessment(a),
        submissionCount: Number(countMap[a._id.toString()] || 0),
      }))
    );
  } catch (err) {
    console.error('getTeacherSubmissionAssessments error', err);
    return res
      .status(500)
      .json({ message: 'Failed to load submission assessments.' });
  }
};

const updateTeacherSubmissionAssessment = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;
    const { action, payload = {} } = req.body || {};

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    if (!assessment.submissionConfig) {
      assessment.submissionConfig = {};
    }

    if (action === 'publish') {
      assessment.submissionConfig.isVisibleToStudents = true;
      assessment.submissionConfig.visibleAt = new Date();
    } else if (action === 'unpublish') {
      assessment.submissionConfig.isVisibleToStudents = false;
    } else if (action === 'open') {
      assessment.submissionConfig.submissionsOpen = true;
      assessment.submissionConfig.closedAt = null;
    } else if (action === 'close') {
      assessment.submissionConfig.submissionsOpen = false;
      assessment.submissionConfig.closedAt = new Date();
    } else if (action === 'update') {
      if (payload.name != null) {
        assessment.name = String(payload.name).trim();
      }

      if (payload.fullMarks != null) {
        assessment.fullMarks = Number(payload.fullMarks || 0);
      }

      assessment.submissionConfig.instructions = String(
        payload.instructions ?? assessment.submissionConfig.instructions ?? ''
      ).trim();

      assessment.submissionConfig.dueDate =
        payload.dueDate != null
          ? payload.dueDate || null
          : assessment.submissionConfig.dueDate || null;

      if (payload.maxFileSizeMB != null) {
        assessment.submissionConfig.maxFileSizeMB = Number(
          payload.maxFileSizeMB || 10
        );
      }

      if (payload.allowResubmission != null) {
        assessment.submissionConfig.allowResubmission =
          payload.allowResubmission !== false;
      }
    } else {
      return res.status(400).json({ message: 'Invalid action.' });
    }

    await assessment.save();

    return res.json({
      message: 'Submission assessment updated successfully.',
      assessment: normalizeSubmissionAssessment(assessment),
    });
  } catch (err) {
    console.error('updateTeacherSubmissionAssessment error', err);
    return res
      .status(500)
      .json({ message: 'Failed to update submission assessment.' });
  }
};

const deleteTeacherSubmissionAssessment = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    const submissions = await LabSubmission.find({
      course: courseId,
      assessment: assessmentId,
    });

    for (const item of submissions) {
      await removeFileIfExists(item.filePath);
    }

    await LabSubmission.deleteMany({
      course: courseId,
      assessment: assessmentId,
    });

    await Mark.deleteMany({
      course: courseId,
      assessment: assessmentId,
    });

    await Assessment.deleteOne({ _id: assessmentId });

    return res.json({
      message: 'Submission assessment deleted successfully.',
    });
  } catch (err) {
    console.error('deleteTeacherSubmissionAssessment error', err);
    return res
      .status(500)
      .json({ message: 'Failed to delete submission assessment.' });
  }
};

const getTeacherAssessmentSubmissions = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    const submissions = await LabSubmission.find({
      course: courseId,
      assessment: assessmentId,
    })
      .populate('student', 'name username')
      .sort({ submittedAt: -1 });

    const formattedSubmissions = await Promise.all(
      submissions.map(async (s) => {
        let downloadUrl = '';

        try {
          downloadUrl = await createSubmissionSignedUrl(s.filePath);
        } catch (err) {
          console.error('Signed URL generation failed:', err.message);
        }

        return {
          id: s._id.toString(),
          studentId: s.student?._id?.toString?.() || null,
          studentName: s.student?.name || '-',
          roll: s.roll || s.student?.username || '-',
          originalFileName: s.originalFileName,
          fileUrl: s.fileUrl,
          downloadUrl,
          fileSize: s.fileSize,
          status: s.status,
          teacherNote: s.teacherNote || '',
          awardedMarks:
            typeof s.awardedMarks === 'number' ? s.awardedMarks : null,
          syncedToMarks: !!s.syncedToMarks,
          syncedAt: s.syncedAt || null,
          submittedAt: s.submittedAt,
          checkedAt: s.checkedAt,
          storageDeleted: !!s.storageDeleted,
        };
      })
    );

    return res.json({
      assessment: normalizeSubmissionAssessment(assessment),
      submissions: formattedSubmissions,
    });
  } catch (err) {
    console.error('getTeacherAssessmentSubmissions error', err);
    return res.status(500).json({ message: 'Failed to load submissions.' });
  }
};

const markSubmissionChecked = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { status = 'checked', teacherNote = '', awardedMarks } = req.body || {};

    const submission = await LabSubmission.findById(submissionId)
      .populate('course')
      .populate('assessment');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (!submission.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    submission.status = status === 'submitted' ? 'submitted' : 'checked';
    submission.teacherNote = String(teacherNote || '').trim();
    submission.checkedAt =
      submission.status === 'checked' ? new Date() : null;

    if (awardedMarks !== undefined && awardedMarks !== null && awardedMarks !== '') {
      submission.awardedMarks = Number(awardedMarks);
    }

    await submission.save();

    return res.json({
      message: 'Submission updated successfully.',
      submission,
    });
  } catch (err) {
    console.error('markSubmissionChecked error', err);
    return res.status(500).json({ message: 'Failed to update submission.' });
  }
};

const syncSubmissionMarksToAssessment = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const submission = await LabSubmission.findById(submissionId)
      .populate('course')
      .populate('assessment');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (!submission.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (submission.awardedMarks == null || Number.isNaN(Number(submission.awardedMarks))) {
      return res.status(400).json({ message: 'Please save marks first.' });
    }

    const maxMarks = Number(submission.assessment?.fullMarks || 0);
    if (Number(submission.awardedMarks) > maxMarks) {
      return res.status(400).json({
        message: `Marks cannot be greater than assessment full marks (${maxMarks}).`,
      });
    }

    await Mark.findOneAndUpdate(
      {
        course: submission.course._id,
        student: submission.student,
        assessment: submission.assessment._id,
      },
      {
        course: submission.course._id,
        student: submission.student,
        assessment: submission.assessment._id,
        obtainedMarks: Number(submission.awardedMarks),
        subMarks: [],
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    submission.syncedToMarks = true;
    submission.syncedAt = new Date();
    await submission.save();

    return res.json({
      message: 'Marks synced successfully.',
    });
  } catch (err) {
    console.error('syncSubmissionMarksToAssessment error', err);
    return res.status(500).json({ message: 'Failed to sync marks.' });
  }
};

const downloadAllTeacherAssessmentSubmissions = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    const submissions = await LabSubmission.find({
      course: courseId,
      assessment: assessmentId,
    }).sort({ submittedAt: 1 });

    if (!submissions.length) {
      return res
        .status(400)
        .json({ message: 'No submitted files found for this assessment.' });
    }

    const zipName = `${course.code || 'course'}_${assessment.name || 'submissions'}`
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 120);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${zipName}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (error) => {
      throw error;
    });

    archive.pipe(res);

    for (const item of submissions) {
      if (!item.filePath) continue;

      try {
        const fileBuffer = await downloadSubmissionBuffer(item.filePath);

        archive.append(fileBuffer, {
          name: safeArchiveFileName(item.roll, item.originalFileName),
        });
      } catch (err) {
        console.error(
          `Failed to fetch submission file for ${item._id}:`,
          err.message
        );
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('downloadAllTeacherAssessmentSubmissions error', err);

    if (!res.headersSent) {
      return res
        .status(500)
        .json({ message: 'Failed to prepare submission archive.' });
    }

    res.end();
  }
};

// -------------------------------------
// Student
// -------------------------------------

const getStudentSubmissionAssessments = async (req, res) => {
  try {
    const studentId = req.user.userId;

    const enrollments = await Enrollment.find({ student: studentId }).populate(
      'course'
    );

    const courseDocs = enrollments
      .map((item) => item.course)
      .filter((course) => course && course.archived !== true);

    const courseIds = courseDocs.map((course) => course._id);

    const assessments = await Assessment.find({
      course: { $in: courseIds },
      structureType: 'lab_submission',
      'submissionConfig.isVisibleToStudents': true,
    }).sort({ createdAt: -1, order: 1 });

    const submissions = await LabSubmission.find({
      student: studentId,
      assessment: { $in: assessments.map((a) => a._id) },
    });

    const submissionMap = Object.fromEntries(
      submissions.map((s) => [String(s.assessment), s])
    );

    const courseMap = Object.fromEntries(
      courseDocs.map((course) => [String(course._id), course])
    );

    const result = await Promise.all(
      assessments.map(async (assessment) => {
        const submission = submissionMap[assessment._id.toString()];
        const course = courseMap[assessment.course.toString()];

        let submissionData = null;

        if (submission) {
          let downloadUrl = '';

          try {
            downloadUrl = await createSubmissionSignedUrl(submission.filePath);
          } catch (err) {
            console.error('Signed URL generation failed:', err.message);
          }

          submissionData = {
            id: submission._id.toString(),
            originalFileName: submission.originalFileName,
            fileUrl: submission.fileUrl,
            downloadUrl,
            submittedAt: submission.submittedAt,
            status: submission.status,
            teacherNote: submission.teacherNote || '',
          };
        }

        return {
          ...normalizeSubmissionAssessment(assessment),
          course: {
            id: course?._id?.toString?.() || assessment.course.toString(),
            code: course?.code || '-',
            title: course?.title || '-',
            section: course?.section || '-',
          },
          submission: submissionData,
        };
      })
    );

    return res.json(result);
  } catch (err) {
    console.error('getStudentSubmissionAssessments error', err);
    return res
      .status(500)
      .json({ message: 'Failed to load student submission assessments.' });
  }
};

const getStudentCourseSubmissionAssessments = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const enrollment = await ensureStudentEnrollment(courseId, studentId);

    if (!enrollment || !enrollment.course || enrollment.course.archived === true) {
      return res
        .status(404)
        .json({ message: 'Course not found for this student.' });
    }

    const assessments = await Assessment.find({
      course: courseId,
      structureType: 'lab_submission',
      'submissionConfig.isVisibleToStudents': true,
    }).sort({ order: 1, createdAt: -1 });

    const submissions = await LabSubmission.find({
      student: studentId,
      course: courseId,
      assessment: { $in: assessments.map((a) => a._id) },
    });

    const submissionMap = Object.fromEntries(
      submissions.map((s) => [String(s.assessment), s])
    );

    const result = await Promise.all(
      assessments.map(async (assessment) => {
        const sub = submissionMap[assessment._id.toString()];

        let submission = null;

        if (sub) {
          let downloadUrl = '';

          try {
            downloadUrl = await createSubmissionSignedUrl(sub.filePath);
          } catch (err) {
            console.error('Signed URL generation failed:', err.message);
          }

          submission = {
            id: sub._id.toString(),
            originalFileName: sub.originalFileName,
            fileUrl: sub.fileUrl,
            downloadUrl,
            submittedAt: sub.submittedAt,
            status: sub.status,
            teacherNote: sub.teacherNote || '',
          };
        }

        return {
          ...normalizeSubmissionAssessment(assessment),
          submission,
        };
      })
    );

    return res.json(result);
  } catch (err) {
    console.error('getStudentCourseSubmissionAssessments error', err);
    return res
      .status(500)
      .json({ message: 'Failed to load course submission assessments.' });
  }
};

const saveAllSubmissionMarks = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;
    const { rows = [] } = req.body || {};

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!assessment) {
      return res.status(404).json({ message: 'Submission assessment not found.' });
    }

    const fullMarks = Number(assessment.fullMarks || 0);

    for (const row of rows) {
      const submission = await LabSubmission.findById(row.submissionId);

      if (!submission) continue;
      if (String(submission.course) !== String(courseId)) continue;
      if (String(submission.assessment) !== String(assessmentId)) continue;

      const numericMarks =
        row.awardedMarks === '' || row.awardedMarks === null || row.awardedMarks === undefined
          ? null
          : Number(row.awardedMarks);

      if (numericMarks !== null) {
        if (Number.isNaN(numericMarks) || numericMarks < 0 || numericMarks > fullMarks) {
          return res.status(400).json({
            message: `Invalid marks found. Marks must be between 0 and ${fullMarks}.`,
          });
        }
      }

      submission.awardedMarks = numericMarks;
      await submission.save();
    }

    return res.json({
      message: 'All submission marks saved successfully.',
    });
  } catch (err) {
    console.error('saveAllSubmissionMarks error', err);
    return res.status(500).json({ message: 'Failed to save all marks.' });
  }
};

const syncAllSubmissionMarksToAssessment = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const submissionAssessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!submissionAssessment) {
      return res.status(404).json({ message: 'Submission assessment not found.' });
    }

    if (!submissionAssessment.submissionConfig) {
      submissionAssessment.submissionConfig = {};
    }

    let linkedAssessment = null;

    if (submissionAssessment.submissionConfig.linkedMarkAssessment) {
      linkedAssessment = await Assessment.findById(
        submissionAssessment.submissionConfig.linkedMarkAssessment
      );
    }

    // create normal lab assessment if not exists
    if (!linkedAssessment) {
      linkedAssessment = await Assessment.create({
        course: submissionAssessment.course,
        name: submissionAssessment.name,
        fullMarks: Number(submissionAssessment.fullMarks || 0),
        order: Number(submissionAssessment.order || 0),
        structureType: 'regular',
        labFinalConfig: null,
        submissionConfig: null,
        isPublished: false,
        publishedAt: null,
      });

      submissionAssessment.submissionConfig.linkedMarkAssessment =
        linkedAssessment._id;

      await submissionAssessment.save();
    }

    const submissions = await LabSubmission.find({
      course: courseId,
      assessment: assessmentId,
    });

    for (const submission of submissions) {
      if (
        submission.awardedMarks === null ||
        submission.awardedMarks === undefined ||
        Number.isNaN(Number(submission.awardedMarks))
      ) {
        continue;
      }

      await Mark.findOneAndUpdate(
        {
          course: submission.course,
          student: submission.student,
          assessment: linkedAssessment._id,
        },
        {
          course: submission.course,
          student: submission.student,
          assessment: linkedAssessment._id,
          obtainedMarks: Number(submission.awardedMarks),
          subMarks: [],
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      submission.syncedToMarks = true;
      submission.syncedAt = new Date();
      await submission.save();
    }

    return res.json({
      message: 'All saved marks synced successfully.',
      linkedAssessmentId: linkedAssessment._id,
      linkedAssessmentName: linkedAssessment.name,
    });
  } catch (err) {
    console.error('syncAllSubmissionMarksToAssessment error', err);
    return res.status(500).json({ message: 'Failed to sync marks.' });
  }
};

const submitStudentAssessmentFile = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { assessmentId } = req.params;
    const file = req.file;

    if (!file) {
      return res
        .status(400)
        .json({ message: 'Please select a file before submitting.' });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment || assessment.structureType !== 'lab_submission') {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    const cfg = assessment.submissionConfig || {};

    if (cfg.isVisibleToStudents !== true) {
      return res
        .status(403)
        .json({ message: 'This submission task is not available right now.' });
    }

if (!isSubmissionCurrentlyOpen(cfg)) {
  return res.status(400).json({
    message: hasSubmissionDueDatePassed(cfg)
      ? 'Submission deadline has passed for this task.'
      : 'Submission is currently closed for this task.',
  });
}

    const enrollment = await ensureStudentEnrollment(assessment.course, studentId);
    if (!enrollment || !enrollment.course || enrollment.course.archived === true) {
      return res
        .status(403)
        .json({ message: 'You are not enrolled in this course.' });
    }

    const existing = await LabSubmission.findOne({
      assessment: assessmentId,
      student: studentId,
    });

    const allowResubmission = cfg.allowResubmission !== false;

    if (existing && !allowResubmission) {
      return res
        .status(400)
        .json({ message: 'Resubmission is disabled for this assessment.' });
    }

    const storagePath = buildSubmissionStoragePath({
      courseId: assessment.course.toString(),
      assessmentId: assessment._id.toString(),
      studentId: student._id.toString(),
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
      student: student._id,
      roll: student.username,
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
    };

    let submission;

    if (existing) {
      const oldPath = existing.filePath;

      Object.assign(existing, payload);
      submission = await existing.save();

      if (oldPath && oldPath !== storagePath) {
        try {
          await removeFileIfExists(oldPath);
        } catch (err) {
          console.error('Old file delete failed:', err.message);
        }
      }
    } else {
      submission = await LabSubmission.create(payload);
    }

    let downloadUrl = '';
    try {
      downloadUrl = await createSubmissionSignedUrl(submission.filePath);
    } catch (err) {
      console.error('Signed URL generation failed:', err.message);
    }

    return res.status(201).json({
      message: existing
        ? 'File resubmitted successfully.'
        : 'File submitted successfully.',
      submission: {
        id: submission._id.toString(),
        originalFileName: submission.originalFileName,
        fileUrl: submission.fileUrl,
        downloadUrl,
        submittedAt: submission.submittedAt,
        status: submission.status,
      },
    });
  } catch (err) {
    console.error('submitStudentAssessmentFile error', err);
    return res.status(500).json({ message: 'Failed to submit file.' });
  }
};

module.exports = {
  createTeacherSubmissionAssessment,
  getTeacherSubmissionAssessments,
  updateTeacherSubmissionAssessment,
  deleteTeacherSubmissionAssessment,
  getTeacherAssessmentSubmissions,
  markSubmissionChecked,
  syncSubmissionMarksToAssessment,
  saveAllSubmissionMarks,
  syncAllSubmissionMarksToAssessment,
  downloadAllTeacherAssessmentSubmissions,
  getStudentSubmissionAssessments,
  getStudentCourseSubmissionAssessments,
  submitStudentAssessmentFile,
};