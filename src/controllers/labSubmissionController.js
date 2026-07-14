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
const MAX_SUBMISSION_FILE_SIZE_MB = Math.max(
  1,
  Number(process.env.LAB_SUBMISSION_UPLOAD_LIMIT_MB || 50)
);

function parseSubmissionFileSizeLimit(value, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (
    !Number.isFinite(parsed) ||
    parsed < 1 ||
    parsed > MAX_SUBMISSION_FILE_SIZE_MB
  ) {
    return null;
  }
  return parsed;
}

function sanitizeExtension(value = '') {
  const ext = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');

  return EXTENSION_PATTERN.test(ext) ? ext : '';
}

function normalizeAllowedExtensions(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_ALLOWED_EXTENSIONS;
  }

  const cleaned = value.map((item) => sanitizeExtension(item)).filter(Boolean);

  const unique = Array.from(new Set(cleaned));
  return unique.length ? unique : DEFAULT_ALLOWED_EXTENSIONS;
}

function getFileExtension(fileName = '') {
  const ext = path.extname(fileName || '').toLowerCase().replace(/^\./, '');
  return ext;
}

function formatAllowedExtensions(value) {
  return normalizeAllowedExtensions(value)
    .map((item) => item.toUpperCase())
    .join(', ');
}

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

function normalizeSubmissionAssessment(a, markSyncOverride = null) {
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
    allowedExtensions: normalizeAllowedExtensions(cfg.allowedExtensions),
    allowResubmission: cfg.allowResubmission !== false,
    resourceTitle: cfg.resourceUrl ? normalizeResourceTitle(cfg.resourceTitle) : '',
    resourceUrl: normalizeResourceUrl(cfg.resourceUrl),
    isVisibleToStudents: !!cfg.isVisibleToStudents,
    visibleAt: cfg.visibleAt || null,
    submissionsOpen,
    closedAt: cfg.closedAt || null,
    dueDatePassed,
    closedReason: getSubmissionClosedReason(cfg),
    markSync:
      markSyncOverride || {
        targetAssessmentId: String(cfg.linkedMarkAssessment || ''),
        targetComponentKey: String(cfg.linkedMarkComponentKey || ''),
        targetType: cfg.linkedMarkAssessment
          ? cfg.linkedMarkComponentKey
            ? 'structured'
            : 'regular'
          : '',
        isConfigured: !!cfg.linkedMarkAssessment,
        isLegacy: false,
        isAutoCreated: !!cfg.linkedMarkAssessmentAutoCreated,
      },
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

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getStructuredComponents(config = {}) {
  return Array.isArray(config?.genericComponents)
    ? config.genericComponents
    : [];
}

function isRegularLabAssessmentTarget(assessment) {
  if (assessment?.structureType !== 'regular') return false;

  const name = String(assessment?.name || '').trim().toLowerCase();
  if (!name) return false;

  return !(
    name.includes('mid') ||
    name.includes('final') ||
    name.includes('attendance') ||
    name.includes('attend') ||
    name.includes('att.')
  );
}

function deriveRegularLabAssessmentName(sourceName = '') {
  let name = String(sourceName || '')
    .replace(/\bsubmission\b/gi, ' ')
    .replace(/\b(mid|final|attendance)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—:]\s*$/g, '')
    .trim();

  if (!name) name = 'Lab Assessment';
  if (!/\blab\b/i.test(name)) name = `Lab Assessment - ${name}`;
  return name.slice(0, 160);
}

async function getUniqueAssessmentName(courseId, requestedName) {
  const base = String(requestedName || '').trim() || 'Lab Assessment';
  let candidate = base;
  let suffix = 2;

  while (await Assessment.exists({ course: courseId, name: candidate })) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }

  return candidate;
}

async function getNextMarkEntryOrder(courseId) {
  const latest = await Assessment.findOne({
    course: courseId,
    structureType: { $ne: 'lab_submission' },
  })
    .sort({ order: -1, createdAt: -1 })
    .select('order');

  return Number(latest?.order || 0) + 1;
}

async function removeRegularTargetMarks(courseId, assessmentId) {
  if (!assessmentId) return;
  await Mark.deleteMany({ course: courseId, assessment: assessmentId });
}

async function syncMarkIntoRegularTarget({
  courseId,
  studentId,
  targetAssessment,
  awardedMarks,
}) {
  if (!targetAssessment) return false;

  await Mark.findOneAndUpdate(
    {
      course: courseId,
      student: studentId,
      assessment: targetAssessment._id,
    },
    {
      $set: {
        course: courseId,
        student: studentId,
        assessment: targetAssessment._id,
        obtainedMarks: Math.max(
          0,
          Math.min(
            Number(awardedMarks || 0),
            Number(targetAssessment.fullMarks || 0)
          )
        ),
        status: 'present',
        subMarks: [],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return true;
}


function buildLegacyDirectMappingBySource(structuredAssessments = []) {
  const mappingBySource = new Map();

  structuredAssessments.forEach((assessment) => {
    getStructuredComponents(assessment?.labFinalConfig || {}).forEach(
      (component) => {
        if (
          component?.sourceType !== 'submission' ||
          !component?.linkedAssessmentId
        ) {
          return;
        }

        mappingBySource.set(String(component.linkedAssessmentId), {
          targetAssessmentId: String(assessment._id),
          targetComponentKey: String(component.key),
          isConfigured: true,
          isLegacy: true,
        });
      }
    );
  });

  return mappingBySource;
}

function calculateStructuredObtained(config, subMarks = []) {
  const limits = new Map(
    getStructuredComponents(config).map((component) => [
      String(component.key),
      Number(component.marks || 0),
    ])
  );

  return round2(
    (subMarks || []).reduce((sum, item) => {
      const key = String(item?.key || '');
      const limit = limits.get(key);
      if (limit == null) return sum;
      const value = Math.max(0, Math.min(Number(item?.obtainedMarks || 0), limit));
      return sum + value;
    }, 0)
  );
}

async function getStructuredSubmissionTargets(courseId, submissionAssessmentId) {
  const sourceAssessment = await Assessment.findOne({
    _id: submissionAssessmentId,
    course: courseId,
    structureType: 'lab_submission',
  }).select('submissionConfig');

  const configuredTargetId =
    sourceAssessment?.submissionConfig?.linkedMarkAssessment || null;
  const configuredComponentKey = String(
    sourceAssessment?.submissionConfig?.linkedMarkComponentKey || ''
  );

  if (configuredTargetId && configuredComponentKey) {
    const assessment = await Assessment.findOne({
      _id: configuredTargetId,
      course: courseId,
      structureType: 'lab_final',
      'labFinalConfig.mode': 'components',
    });

    const component = getStructuredComponents(
      assessment?.labFinalConfig || {}
    ).find((item) => String(item?.key || '') === configuredComponentKey);

    if (assessment && component) {
      return [{ assessment, component }];
    }
  }

  // Backward compatibility for the earlier direct-link implementation.
  const assessments = await Assessment.find({
    course: courseId,
    structureType: 'lab_final',
    'labFinalConfig.mode': 'components',
    'labFinalConfig.genericComponents.linkedAssessmentId':
      submissionAssessmentId,
  });

  const targets = [];
  assessments.forEach((assessment) => {
    getStructuredComponents(assessment.labFinalConfig).forEach((component) => {
      if (component?.sourceType !== 'submission') return;
      if (
        String(component?.linkedAssessmentId || '') !==
        String(submissionAssessmentId)
      ) {
        return;
      }

      targets.push({ assessment, component });
    });
  });

  return targets;
}

async function getExistingLinkedRegularAssessment(submissionAssessment) {
  const linkedId =
    submissionAssessment?.submissionConfig?.linkedMarkAssessment || null;
  const componentKey = String(
    submissionAssessment?.submissionConfig?.linkedMarkComponentKey || ''
  );

  if (!linkedId || componentKey) return null;

  return Assessment.findOne({
    _id: linkedId,
    course: submissionAssessment.course,
    structureType: 'regular',
  });
}

async function removeStructuredComponentMarksForAllStudents({
  courseId,
  targetAssessmentId,
  componentKey,
}) {
  const targetAssessment = await Assessment.findOne({
    _id: targetAssessmentId,
    course: courseId,
    structureType: 'lab_final',
  });

  if (!targetAssessment) return;

  const marks = await Mark.find({
    course: courseId,
    assessment: targetAssessmentId,
  });

  for (const mark of marks) {
    const subMarks = (mark.subMarks || []).filter(
      (item) => String(item?.key || '') !== String(componentKey || '')
    );
    mark.subMarks = subMarks;
    mark.obtainedMarks = calculateStructuredObtained(
      targetAssessment.labFinalConfig,
      subMarks
    );
    await mark.save();
  }
}

async function clearLegacyDirectSubmissionLink(
  courseId,
  submissionAssessmentId
) {
  const assessments = await Assessment.find({
    course: courseId,
    structureType: 'lab_final',
    'labFinalConfig.mode': 'components',
    'labFinalConfig.genericComponents.linkedAssessmentId':
      submissionAssessmentId,
  });

  for (const assessment of assessments) {
    let changed = false;
    assessment.labFinalConfig.genericComponents = getStructuredComponents(
      assessment.labFinalConfig
    ).map((component) => {
      if (
        component?.sourceType === 'submission' &&
        String(component?.linkedAssessmentId || '') ===
          String(submissionAssessmentId)
      ) {
        changed = true;
        component.sourceType = 'manual';
        component.linkedAssessmentId = null;
      }
      return component;
    });

    if (changed) await assessment.save();
  }
}

async function syncMarkIntoStructuredTargets({
  courseId,
  studentId,
  submissionAssessmentId,
  awardedMarks,
}) {
  const targets = await getStructuredSubmissionTargets(
    courseId,
    submissionAssessmentId
  );

  for (const { assessment, component } of targets) {
    const existing = await Mark.findOne({
      course: courseId,
      student: studentId,
      assessment: assessment._id,
    });

    const subMarkMap = new Map();
    (existing?.subMarks || []).forEach((item) => {
      if (!item?.key) return;
      subMarkMap.set(String(item.key), Number(item.obtainedMarks || 0));
    });

    subMarkMap.set(
      String(component.key),
      Math.max(
        0,
        Math.min(Number(awardedMarks || 0), Number(component.marks || 0))
      )
    );

    const validKeys = new Set(
      getStructuredComponents(assessment.labFinalConfig).map((item) =>
        String(item.key)
      )
    );

    const subMarks = Array.from(subMarkMap.entries())
      .filter(([key]) => validKeys.has(key))
      .map(([key, obtainedMarks]) => ({ key, obtainedMarks }));

    await Mark.findOneAndUpdate(
      {
        course: courseId,
        student: studentId,
        assessment: assessment._id,
      },
      {
        $set: {
          course: courseId,
          student: studentId,
          assessment: assessment._id,
          obtainedMarks: calculateStructuredObtained(
            assessment.labFinalConfig,
            subMarks
          ),
          status: 'present',
          subMarks,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return targets;
}

async function removeMarkFromStructuredTargets({
  courseId,
  studentId,
  submissionAssessmentId,
}) {
  const targets = await getStructuredSubmissionTargets(
    courseId,
    submissionAssessmentId
  );

  for (const { assessment, component } of targets) {
    const mark = await Mark.findOne({
      course: courseId,
      student: studentId,
      assessment: assessment._id,
    });

    if (!mark) continue;

    const subMarks = (mark.subMarks || []).filter(
      (item) => String(item?.key || '') !== String(component.key)
    );

    mark.subMarks = subMarks;
    mark.obtainedMarks = calculateStructuredObtained(
      assessment.labFinalConfig,
      subMarks
    );
    await mark.save();
  }
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

    const maxFileSizeMB = parseSubmissionFileSizeLimit(
      submissionConfig.maxFileSizeMB,
      10
    );
    if (maxFileSizeMB === null) {
      return res.status(400).json({
        message: `Maximum file size must be between 1 and ${MAX_SUBMISSION_FILE_SIZE_MB} MB.`,
      });
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
        allowedExtensions: normalizeAllowedExtensions(submissionConfig.allowedExtensions),
        maxFileSizeMB,
        allowResubmission: submissionConfig.allowResubmission !== false,
        resourceTitle: normalizeResourceUrl(submissionConfig.resourceUrl)
          ? normalizeResourceTitle(submissionConfig.resourceTitle)
          : '',
        resourceUrl: normalizeResourceUrl(submissionConfig.resourceUrl),
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

    const [assessments, structuredAssessments] = await Promise.all([
      Assessment.find({
        course: courseId,
        structureType: 'lab_submission',
      }).sort({ order: 1, createdAt: -1 }),
      Assessment.find({
        course: courseId,
        structureType: 'lab_final',
        'labFinalConfig.mode': 'components',
      }).select('_id labFinalConfig'),
    ]);

    const legacyMappingBySource =
      buildLegacyDirectMappingBySource(structuredAssessments);
    const assessmentIds = assessments.map((a) => a._id);

    const counts = await LabSubmission.aggregate([
      { $match: { assessment: { $in: assessmentIds } } },
      { $group: { _id: '$assessment', count: { $sum: 1 } } },
    ]);

    const countMap = Object.fromEntries(
      counts.map((item) => [String(item._id), item.count])
    );

    return res.json(
      assessments.map((a) => {
        const legacyMapping = legacyMappingBySource.get(String(a._id));
        const configuredKey = String(
          a?.submissionConfig?.linkedMarkComponentKey || ''
        );
        const configuredTarget = String(
          a?.submissionConfig?.linkedMarkAssessment || ''
        );
        const markSync = configuredTarget
          ? {
              targetAssessmentId: configuredTarget,
              targetComponentKey: configuredKey,
              targetType: configuredKey ? 'structured' : 'regular',
              isConfigured: true,
              isLegacy: false,
              isAutoCreated: !!a?.submissionConfig
                ?.linkedMarkAssessmentAutoCreated,
            }
          : legacyMapping
            ? {
                ...legacyMapping,
                targetType: 'structured',
                isAutoCreated: false,
              }
            : {
                targetAssessmentId: '',
                targetComponentKey: '',
                targetType: '',
                isConfigured: false,
                isLegacy: false,
                isAutoCreated: false,
              };

        return {
          ...normalizeSubmissionAssessment(a, markSync),
          submissionCount: Number(countMap[a._id.toString()] || 0),
        };
      })
    );
  } catch (err) {
    console.error('getTeacherSubmissionAssessments error', err);
    return res
      .status(500)
      .json({ message: 'Failed to load submission assessments.' });
  }
};

const getTeacherMarksSyncConfiguration = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const [submissionAssessments, structuredAssessments, regularAssessments] =
      await Promise.all([
        Assessment.find({
          course: courseId,
          structureType: 'lab_submission',
        }).sort({ order: 1, createdAt: 1 }),
        Assessment.find({
          course: courseId,
          structureType: 'lab_final',
          'labFinalConfig.mode': 'components',
        }).sort({ order: 1, createdAt: 1 }),
        Assessment.find({
          course: courseId,
          structureType: 'regular',
        }).sort({ order: 1, createdAt: 1 }),
      ]);

    const legacyMappingBySource =
      buildLegacyDirectMappingBySource(structuredAssessments);

    const directlyLinkedRegularIds = new Set(
      submissionAssessments
        .filter(
          (assessment) =>
            assessment?.submissionConfig?.linkedMarkAssessment &&
            !assessment?.submissionConfig?.linkedMarkComponentKey
        )
        .map((assessment) =>
          String(assessment.submissionConfig.linkedMarkAssessment)
        )
    );

    const usableRegularAssessments = regularAssessments.filter(
      (assessment) =>
        isRegularLabAssessmentTarget(assessment) ||
        directlyLinkedRegularIds.has(String(assessment._id))
    );

    const regularIdSet = new Set(
      usableRegularAssessments.map((assessment) => String(assessment._id))
    );
    const structuredIdSet = new Set(
      structuredAssessments.map((assessment) => String(assessment._id))
    );

    const mappingBySource = new Map();
    submissionAssessments.forEach((sourceAssessment) => {
      const configuredTarget = String(
        sourceAssessment?.submissionConfig?.linkedMarkAssessment || ''
      );
      const configuredKey = String(
        sourceAssessment?.submissionConfig?.linkedMarkComponentKey || ''
      );

      let mapping = null;

      if (configuredTarget) {
        mapping = {
          targetAssessmentId: configuredTarget,
          targetComponentKey: configuredKey,
          targetType: configuredKey ? 'structured' : 'regular',
          isConfigured: true,
          isLegacy: false,
          isAutoCreated: !!sourceAssessment?.submissionConfig
            ?.linkedMarkAssessmentAutoCreated,
          targetExists: configuredKey
            ? structuredIdSet.has(configuredTarget)
            : regularIdSet.has(configuredTarget),
        };
      } else {
        const legacy = legacyMappingBySource.get(String(sourceAssessment._id));
        mapping = legacy
          ? {
              ...legacy,
              targetType: 'structured',
              isAutoCreated: false,
              targetExists: true,
            }
          : {
              targetAssessmentId: '',
              targetComponentKey: '',
              targetType: '',
              isConfigured: false,
              isLegacy: false,
              isAutoCreated: false,
              targetExists: true,
            };
      }

      mappingBySource.set(String(sourceAssessment._id), mapping);
    });

    const sourceByStructuredDestination = new Map();
    const sourceByRegularDestination = new Map();

    mappingBySource.forEach((mapping, sourceId) => {
      if (!mapping.targetAssessmentId) return;

      if (mapping.targetComponentKey) {
        sourceByStructuredDestination.set(
          `${mapping.targetAssessmentId}:${mapping.targetComponentKey}`,
          sourceId
        );
      } else {
        sourceByRegularDestination.set(mapping.targetAssessmentId, sourceId);
      }
    });

    const regularTargets = usableRegularAssessments.map((assessment) => ({
      id: String(assessment._id),
      name: assessment.name,
      kind: 'regular',
      period: 'lab',
      fullMarks: Number(assessment.fullMarks || 0),
      mappedSubmissionAssessmentId:
        sourceByRegularDestination.get(String(assessment._id)) || '',
      components: [],
    }));

    const structuredTargets = structuredAssessments.map((assessment) => ({
      id: String(assessment._id),
      name: assessment.name,
      kind: 'structured',
      period:
        String(assessment?.labFinalConfig?.period || 'final').toLowerCase() ===
        'mid'
          ? 'mid'
          : 'final',
      fullMarks: Number(assessment.fullMarks || 0),
      mappedSubmissionAssessmentId: '',
      components: [...getStructuredComponents(assessment.labFinalConfig)]
        .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
        .map((component) => ({
          key: String(component.key),
          name: component.name,
          marks: Number(component.marks || 0),
          mappedSubmissionAssessmentId:
            sourceByStructuredDestination.get(
              `${String(assessment._id)}:${String(component.key)}`
            ) || '',
        })),
    }));

    return res.json({
      submissions: submissionAssessments.map((assessment) => ({
        ...normalizeSubmissionAssessment(assessment),
        mapping: mappingBySource.get(String(assessment._id)),
      })),
      targets: [...regularTargets, ...structuredTargets],
    });
  } catch (err) {
    console.error('getTeacherMarksSyncConfiguration error', err);
    return res
      .status(500)
      .json({ message: 'Failed to load marks sync configuration.' });
  }
};

const updateTeacherMarksSyncConfiguration = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;
    const requestedTargetAssessmentId = String(
      req.body?.targetAssessmentId || ''
    ).trim();
    const requestedTargetComponentKey = String(
      req.body?.targetComponentKey || ''
    ).trim();
    const createRegularAssessment =
      req.body?.createRegularAssessment === true;
    const requestedRegularAssessmentName = String(
      req.body?.regularAssessmentName || ''
    ).trim();

    const course = await ensureTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found.' });
    }

    const sourceAssessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
      structureType: 'lab_submission',
    });

    if (!sourceAssessment) {
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    if (
      createRegularAssessment &&
      (requestedTargetAssessmentId || requestedTargetComponentKey)
    ) {
      return res.status(400).json({
        message:
          'Choose either an existing destination or create a new Lab Assessment, not both.',
      });
    }

    if (!requestedTargetAssessmentId && requestedTargetComponentKey) {
      return res.status(400).json({
        message: 'Choose a target assessment before selecting a component.',
      });
    }

    const legacyStructuredTargets = await getStructuredSubmissionTargets(
      courseId,
      assessmentId
    );
    const legacyStructuredTarget = legacyStructuredTargets[0] || null;
    const existingRegularAssessment =
      await getExistingLinkedRegularAssessment(sourceAssessment);

    const configuredOldTargetId = String(
      sourceAssessment?.submissionConfig?.linkedMarkAssessment || ''
    );
    const configuredOldComponentKey = String(
      sourceAssessment?.submissionConfig?.linkedMarkComponentKey || ''
    );
    const oldTargetId =
      configuredOldTargetId ||
      String(legacyStructuredTarget?.assessment?._id || '');
    const oldComponentKey =
      configuredOldComponentKey ||
      String(legacyStructuredTarget?.component?.key || '');
    const oldAutoCreated = !!sourceAssessment?.submissionConfig
      ?.linkedMarkAssessmentAutoCreated;

    let targetAssessment = null;
    let targetComponent = null;
    let targetType = '';
    let targetAssessmentId = requestedTargetAssessmentId;
    let targetComponentKey = requestedTargetComponentKey;
    let targetAutoCreated = false;
    let createdAssessment = null;

    if (requestedTargetAssessmentId) {
      targetAssessment = await Assessment.findOne({
        _id: requestedTargetAssessmentId,
        course: courseId,
        structureType: { $in: ['regular', 'lab_final'] },
      });

      if (!targetAssessment) {
        return res.status(404).json({
          message: 'The selected destination assessment was not found.',
        });
      }

      if (targetAssessment.structureType === 'lab_final') {
        targetType = 'structured';

        if (
          targetAssessment?.labFinalConfig?.mode !== 'components' ||
          !targetComponentKey
        ) {
          return res.status(400).json({
            message:
              'Choose the exact component under the selected Structured Lab Mid/Final.',
          });
        }

        targetComponent = getStructuredComponents(
          targetAssessment.labFinalConfig
        ).find(
          (component) =>
            String(component?.key || '') === targetComponentKey
        );

        if (!targetComponent) {
          return res.status(404).json({
            message: 'The selected target component was not found.',
          });
        }

        if (
          round2(sourceAssessment.fullMarks) !==
          round2(targetComponent.marks)
        ) {
          return res.status(400).json({
            message: `“${sourceAssessment.name}” has ${Number(
              sourceAssessment.fullMarks || 0
            )} marks, but “${targetComponent.name}” has ${Number(
              targetComponent.marks || 0
            )}. Both full marks must match.`,
          });
        }

        const duplicateMapping = await Assessment.findOne({
          _id: { $ne: sourceAssessment._id },
          course: courseId,
          structureType: 'lab_submission',
          'submissionConfig.linkedMarkAssessment': targetAssessmentId,
          'submissionConfig.linkedMarkComponentKey': targetComponentKey,
        }).select('_id name');

        const legacyLinkedSourceId = String(
          targetComponent?.linkedAssessmentId || ''
        );

        if (
          duplicateMapping ||
          (legacyLinkedSourceId &&
            legacyLinkedSourceId !== String(sourceAssessment._id))
        ) {
          return res.status(400).json({
            message:
              'That component is already connected to another submission assessment.',
          });
        }
      } else {
        targetType = 'regular';
        targetComponentKey = '';

        if (!isRegularLabAssessmentTarget(targetAssessment)) {
          return res.status(400).json({
            message:
              'Only a regular Lab Assessment can be used as a direct destination. Mid, Final, and Attendance must not be selected here.',
          });
        }

        if (
          round2(sourceAssessment.fullMarks) !==
          round2(targetAssessment.fullMarks)
        ) {
          return res.status(400).json({
            message: `“${sourceAssessment.name}” has ${Number(
              sourceAssessment.fullMarks || 0
            )} marks, but “${targetAssessment.name}” has ${Number(
              targetAssessment.fullMarks || 0
            )}. Both full marks must match.`,
          });
        }

        const duplicateDirectMapping = await Assessment.findOne({
          _id: { $ne: sourceAssessment._id },
          course: courseId,
          structureType: 'lab_submission',
          'submissionConfig.linkedMarkAssessment': targetAssessmentId,
          $or: [
            { 'submissionConfig.linkedMarkComponentKey': '' },
            { 'submissionConfig.linkedMarkComponentKey': null },
            { 'submissionConfig.linkedMarkComponentKey': { $exists: false } },
          ],
        }).select('_id name');

        if (duplicateDirectMapping) {
          return res.status(400).json({
            message:
              'That Lab Assessment is already connected to another submission assessment.',
          });
        }
      }
    }

    if (createRegularAssessment) {
      targetType = 'regular';
      targetComponentKey = '';

      const preferredName =
        requestedRegularAssessmentName ||
        deriveRegularLabAssessmentName(sourceAssessment.name);
      const nameProbe = { structureType: 'regular', name: preferredName };

      if (!isRegularLabAssessmentTarget(nameProbe)) {
        return res.status(400).json({
          message:
            'The new direct destination must be a Lab Assessment name. Please remove Mid, Final, or Attendance from the name.',
        });
      }

      const uniqueName = await getUniqueAssessmentName(
        courseId,
        preferredName
      );
      const nextOrder = await getNextMarkEntryOrder(courseId);

      targetAssessment = await Assessment.create({
        course: courseId,
        name: uniqueName,
        fullMarks: Number(sourceAssessment.fullMarks || 0),
        order: nextOrder,
        structureType: 'regular',
        labFinalConfig: null,
        submissionConfig: null,
      });

      targetAssessmentId = String(targetAssessment._id);
      targetAutoCreated = true;
      createdAssessment = {
        id: targetAssessmentId,
        name: targetAssessment.name,
        fullMarks: Number(targetAssessment.fullMarks || 0),
      };
    }

    if (
      targetType === 'regular' &&
      targetAssessmentId &&
      targetAssessmentId === oldTargetId &&
      !oldComponentKey
    ) {
      targetAutoCreated = oldAutoCreated;
    }

    const mappingChanged =
      createRegularAssessment ||
      oldTargetId !== targetAssessmentId ||
      oldComponentKey !== targetComponentKey;

    if (mappingChanged && oldTargetId) {
      if (oldComponentKey) {
        await removeStructuredComponentMarksForAllStudents({
          courseId,
          targetAssessmentId: oldTargetId,
          componentKey: oldComponentKey,
        });
      } else {
        await removeRegularTargetMarks(courseId, oldTargetId);

        if (oldAutoCreated) {
          await Assessment.deleteOne({
            _id: oldTargetId,
            course: courseId,
            structureType: 'regular',
          });
        }
      }
    }

    await clearLegacyDirectSubmissionLink(courseId, assessmentId);

    if (!sourceAssessment.submissionConfig) {
      sourceAssessment.submissionConfig = {};
    }

    sourceAssessment.submissionConfig.linkedMarkAssessment =
      targetAssessmentId || null;
    sourceAssessment.submissionConfig.linkedMarkComponentKey =
      targetComponentKey || '';
    sourceAssessment.submissionConfig.linkedMarkAssessmentAutoCreated =
      !!targetAssessmentId && targetAutoCreated;
    await sourceAssessment.save();

    const submissions = await LabSubmission.find({
      course: courseId,
      assessment: assessmentId,
    });

    if (!targetAssessmentId) {
      for (const submission of submissions) {
        submission.syncedToMarks = false;
        submission.syncedAt = null;
        await submission.save();
      }

      return res.json({
        message: 'Marks sync mapping removed successfully.',
        mapping: {
          targetAssessmentId: '',
          targetComponentKey: '',
          targetType: '',
          isConfigured: false,
          isLegacy: false,
          isAutoCreated: false,
        },
      });
    }

    let syncedCount = 0;
    for (const submission of submissions) {
      if (
        submission.awardedMarks === null ||
        submission.awardedMarks === undefined ||
        Number.isNaN(Number(submission.awardedMarks))
      ) {
        continue;
      }

      if (targetType === 'structured') {
        await syncMarkIntoStructuredTargets({
          courseId,
          studentId: submission.student,
          submissionAssessmentId: assessmentId,
          awardedMarks: submission.awardedMarks,
        });
      } else {
        await syncMarkIntoRegularTarget({
          courseId,
          studentId: submission.student,
          targetAssessment,
          awardedMarks: submission.awardedMarks,
        });
      }

      submission.syncedToMarks = true;
      submission.syncedAt = new Date();
      await submission.save();
      syncedCount += 1;
    }

    const destinationLabel =
      targetType === 'structured'
        ? `${targetAssessment.name} → ${targetComponent.name}`
        : targetAssessment.name;

    return res.json({
      message: `${
        createdAssessment
          ? `Lab Assessment “${createdAssessment.name}” created and connected.`
          : `Marks mapping connected to “${destinationLabel}”.`
      } ${syncedCount} existing mark(s) synchronized.`,
      mapping: {
        targetAssessmentId,
        targetComponentKey,
        targetType,
        isConfigured: true,
        isLegacy: false,
        isAutoCreated: targetAutoCreated,
      },
      createdAssessment,
    });
  } catch (err) {
    console.error('updateTeacherMarksSyncConfiguration error', err);
    return res
      .status(500)
      .json({ message: 'Failed to save marks sync configuration.' });
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
        const nextFullMarks = Number(payload.fullMarks || 0);
        const structuredTargets = await getStructuredSubmissionTargets(
          courseId,
          assessmentId
        );
        const mismatchedTarget = structuredTargets.find(
          (target) => round2(target.component?.marks) !== round2(nextFullMarks)
        );

        if (mismatchedTarget) {
          return res.status(400).json({
            message:
              'This submission is linked to a structured lab component. Unlink it before changing full marks, or keep both marks equal.',
          });
        }

        const linkedRegularAssessment =
          await getExistingLinkedRegularAssessment(assessment);
        if (
          linkedRegularAssessment &&
          round2(linkedRegularAssessment.fullMarks) !== round2(nextFullMarks)
        ) {
          return res.status(400).json({
            message: `This submission is directly synced with “${linkedRegularAssessment.name}” (${Number(
              linkedRegularAssessment.fullMarks || 0
            )} marks). Keep both full marks equal or remove the mapping first.`,
          });
        }

        assessment.fullMarks = nextFullMarks;
      }

      assessment.submissionConfig.instructions = String(
        payload.instructions ?? assessment.submissionConfig.instructions ?? ''
      ).trim();

      assessment.submissionConfig.dueDate =
        payload.dueDate != null
          ? payload.dueDate || null
          : assessment.submissionConfig.dueDate || null;

      if (payload.maxFileSizeMB != null) {
        const maxFileSizeMB = parseSubmissionFileSizeLimit(
          payload.maxFileSizeMB,
          assessment.submissionConfig.maxFileSizeMB || 10
        );

        if (maxFileSizeMB === null) {
          return res.status(400).json({
            message: `Maximum file size must be between 1 and ${MAX_SUBMISSION_FILE_SIZE_MB} MB.`,
          });
        }

        assessment.submissionConfig.maxFileSizeMB = maxFileSizeMB;
      }

      if (payload.allowResubmission != null) {
        assessment.submissionConfig.allowResubmission =
          payload.allowResubmission !== false;
      }

      if (payload.allowedExtensions != null) {
        assessment.submissionConfig.allowedExtensions = normalizeAllowedExtensions(
          payload.allowedExtensions
        );
      }

      if (payload.resourceUrl != null || payload.resourceTitle != null) {
        const normalizedUrl = normalizeResourceUrl(payload.resourceUrl);
        assessment.submissionConfig.resourceUrl = normalizedUrl;
        assessment.submissionConfig.resourceTitle = normalizedUrl
          ? normalizeResourceTitle(payload.resourceTitle)
          : '';
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

    const structuredTargets = await getStructuredSubmissionTargets(
      courseId,
      assessmentId
    );
    if (structuredTargets.length) {
      return res.status(400).json({
        message:
          'This submission assessment is connected to a structured Lab Mid/Final component. Remove the mapping from Submissions → Marks Sync before deleting it.',
      });
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

    const linkedRegularAssessmentId =
      assessment?.submissionConfig?.linkedMarkComponentKey
        ? null
        : assessment?.submissionConfig?.linkedMarkAssessment || null;
    if (linkedRegularAssessmentId) {
      await Mark.deleteMany({
        course: courseId,
        assessment: linkedRegularAssessmentId,
      });

      if (assessment?.submissionConfig?.linkedMarkAssessmentAutoCreated) {
        await Assessment.deleteOne({
          _id: linkedRegularAssessmentId,
          course: courseId,
          structureType: 'regular',
        });
      }
    }

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
          source: s.source || 'student-login',
          isPublicSubmission: s.source === 'public-link',
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

    const marksCleared = awardedMarks === '' || awardedMarks === null;

    if (marksCleared) {
      submission.awardedMarks = null;
      submission.syncedToMarks = false;
      submission.syncedAt = null;
    } else if (awardedMarks !== undefined) {
      const numericMarks = Number(awardedMarks);
      const maxMarks = Number(submission.assessment?.fullMarks || 0);

      if (
        Number.isNaN(numericMarks) ||
        numericMarks < 0 ||
        numericMarks > maxMarks
      ) {
        return res.status(400).json({
          message: `Marks must be between 0 and ${maxMarks}.`,
        });
      }

      submission.awardedMarks = numericMarks;
    }

    if (marksCleared) {
      await removeMarkFromStructuredTargets({
        courseId: submission.course._id,
        studentId: submission.student,
        submissionAssessmentId: submission.assessment._id,
      });

      const linkedRegularAssessment =
        await getExistingLinkedRegularAssessment(submission.assessment);
      if (linkedRegularAssessment) {
        await Mark.deleteOne({
          course: submission.course._id,
          student: submission.student,
          assessment: linkedRegularAssessment._id,
        });
      }
    } else if (
      awardedMarks !== undefined &&
      submission.awardedMarks !== null &&
      submission.awardedMarks !== undefined
    ) {
      const structuredTargets = await syncMarkIntoStructuredTargets({
        courseId: submission.course._id,
        studentId: submission.student,
        submissionAssessmentId: submission.assessment._id,
        awardedMarks: submission.awardedMarks,
      });

      if (structuredTargets.length) {
        submission.syncedToMarks = true;
        submission.syncedAt = new Date();
      } else {
        const linkedRegularAssessment =
          await getExistingLinkedRegularAssessment(submission.assessment);

        if (linkedRegularAssessment) {
          await Mark.findOneAndUpdate(
            {
              course: submission.course._id,
              student: submission.student,
              assessment: linkedRegularAssessment._id,
            },
            {
              $set: {
                course: submission.course._id,
                student: submission.student,
                assessment: linkedRegularAssessment._id,
                obtainedMarks: Number(submission.awardedMarks),
                status: 'present',
                subMarks: [],
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          submission.syncedToMarks = true;
          submission.syncedAt = new Date();
        } else {
          submission.syncedToMarks = false;
          submission.syncedAt = null;
        }
      }
    }

    await submission.save();

    return res.json({
      message: submission.syncedToMarks
        ? 'Submission marks saved and synchronized.'
        : 'Submission marks saved successfully.',
      submission,
    });
  } catch (err) {
    console.error('markSubmissionChecked error', err);
    return res.status(500).json({ message: 'Failed to update submission.' });
  }
};

const deleteTeacherSubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const submission = await LabSubmission.findById(submissionId)
      .populate('course')
      .populate('assessment');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (!submission.course?.createdBy?.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const submissionAssessment = submission.assessment;
    const linkedMarkAssessment =
      submissionAssessment?.submissionConfig?.linkedMarkComponentKey
        ? null
        : submissionAssessment?.submissionConfig?.linkedMarkAssessment || null;

    await removeFileIfExists(submission.filePath);

    if (linkedMarkAssessment && submission.student) {
      await Mark.deleteOne({
        course: submission.course._id,
        student: submission.student,
        assessment: linkedMarkAssessment,
      });
    }

    if (submission.student && submissionAssessment?._id) {
      await removeMarkFromStructuredTargets({
        courseId: submission.course._id,
        studentId: submission.student,
        submissionAssessmentId: submissionAssessment._id,
      });
    }

    await LabSubmission.deleteOne({ _id: submission._id });

    return res.json({
      message: 'Student submission deleted successfully.',
    });
  } catch (err) {
    console.error('deleteTeacherSubmission error', err);
    return res.status(500).json({ message: 'Failed to delete submission.' });
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

    const structuredTargets = await syncMarkIntoStructuredTargets({
      courseId: submission.course._id,
      studentId: submission.student,
      submissionAssessmentId: submission.assessment._id,
      awardedMarks: submission.awardedMarks,
    });

    if (!structuredTargets.length) {
      const linkedAssessment = await getExistingLinkedRegularAssessment(
        submission.assessment
      );

      if (!linkedAssessment) {
        return res.status(400).json({
          message:
            'No destination is configured. Open the Marks Sync tab and connect this submission assessment first.',
        });
      }

      await Mark.findOneAndUpdate(
        {
          course: submission.course._id,
          student: submission.student,
          assessment: linkedAssessment._id,
        },
        {
          $set: {
            course: submission.course._id,
            student: submission.student,
            assessment: linkedAssessment._id,
            obtainedMarks: Number(submission.awardedMarks),
            status: 'present',
            subMarks: [],
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );
    }

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
      return res
        .status(404)
        .json({ message: 'Submission assessment not found.' });
    }

    const fullMarks = Number(assessment.fullMarks || 0);
    let synchronizedCount = 0;

    for (const row of rows) {
      const submission = await LabSubmission.findById(row.submissionId);

      if (!submission) continue;
      if (String(submission.course) !== String(courseId)) continue;
      if (String(submission.assessment) !== String(assessmentId)) continue;

      const numericMarks =
        row.awardedMarks === '' ||
        row.awardedMarks === null ||
        row.awardedMarks === undefined
          ? null
          : Number(row.awardedMarks);

      if (numericMarks !== null) {
        if (
          Number.isNaN(numericMarks) ||
          numericMarks < 0 ||
          numericMarks > fullMarks
        ) {
          return res.status(400).json({
            message: `Invalid marks found. Marks must be between 0 and ${fullMarks}.`,
          });
        }
      }

      submission.awardedMarks = numericMarks;
      submission.status = numericMarks === null ? 'submitted' : 'checked';
      submission.checkedAt = numericMarks === null ? null : new Date();

      if (numericMarks === null) {
        await removeMarkFromStructuredTargets({
          courseId,
          studentId: submission.student,
          submissionAssessmentId: assessmentId,
        });

        const linkedRegularAssessment =
          await getExistingLinkedRegularAssessment(assessment);
        if (linkedRegularAssessment) {
          await Mark.deleteOne({
            course: courseId,
            student: submission.student,
            assessment: linkedRegularAssessment._id,
          });
        }

        submission.syncedToMarks = false;
        submission.syncedAt = null;
      } else {
        const structuredTargets = await syncMarkIntoStructuredTargets({
          courseId,
          studentId: submission.student,
          submissionAssessmentId: assessmentId,
          awardedMarks: numericMarks,
        });

        if (structuredTargets.length) {
          submission.syncedToMarks = true;
          submission.syncedAt = new Date();
          synchronizedCount += 1;
        } else {
          const linkedRegularAssessment =
            await getExistingLinkedRegularAssessment(assessment);

          if (linkedRegularAssessment) {
            await Mark.findOneAndUpdate(
              {
                course: courseId,
                student: submission.student,
                assessment: linkedRegularAssessment._id,
              },
              {
                $set: {
                  course: courseId,
                  student: submission.student,
                  assessment: linkedRegularAssessment._id,
                  obtainedMarks: numericMarks,
                  status: 'present',
                  subMarks: [],
                },
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            submission.syncedToMarks = true;
            submission.syncedAt = new Date();
            synchronizedCount += 1;
          } else {
            submission.syncedToMarks = false;
            submission.syncedAt = null;
          }
        }
      }

      await submission.save();
    }

    return res.json({
      message: synchronizedCount
        ? `All submission marks saved. ${synchronizedCount} mark(s) synchronized.`
        : 'All submission marks saved successfully.',
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

    const structuredTargets = await getStructuredSubmissionTargets(
      courseId,
      assessmentId
    );

    const linkedAssessment = structuredTargets.length
      ? null
      : await getExistingLinkedRegularAssessment(submissionAssessment);

    if (!structuredTargets.length && !linkedAssessment) {
      return res.status(400).json({
        message:
          'No destination is configured. Open the Marks Sync tab and connect this submission assessment first.',
      });
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

      if (structuredTargets.length) {
        await syncMarkIntoStructuredTargets({
          courseId: submission.course,
          studentId: submission.student,
          submissionAssessmentId: assessmentId,
          awardedMarks: submission.awardedMarks,
        });
      } else {
        await Mark.findOneAndUpdate(
          {
            course: submission.course,
            student: submission.student,
            assessment: linkedAssessment._id,
          },
          {
            $set: {
              course: submission.course,
              student: submission.student,
              assessment: linkedAssessment._id,
              obtainedMarks: Number(submission.awardedMarks),
              status: 'present',
              subMarks: [],
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          }
        );
      }

      submission.syncedToMarks = true;
      submission.syncedAt = new Date();
      await submission.save();
    }

    return res.json({
      message: 'All saved marks synced successfully.',
      linkedAssessmentId: linkedAssessment?._id || null,
      linkedAssessmentName: linkedAssessment?.name || null,
      structuredAssessmentIds: structuredTargets.map((target) =>
        String(target.assessment._id)
      ),
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
      source: 'student-login',
      publicSubmissionLink: null,
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
  getTeacherMarksSyncConfiguration,
  updateTeacherMarksSyncConfiguration,
  updateTeacherSubmissionAssessment,
  deleteTeacherSubmissionAssessment,
  getTeacherAssessmentSubmissions,
  markSubmissionChecked,
  deleteTeacherSubmission,
  syncSubmissionMarksToAssessment,
  saveAllSubmissionMarks,
  syncAllSubmissionMarksToAssessment,
  downloadAllTeacherAssessmentSubmissions,
  getStudentSubmissionAssessments,
  getStudentCourseSubmissionAssessments,
  submitStudentAssessmentFile,
};