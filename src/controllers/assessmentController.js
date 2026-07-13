const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

// helper: ensure course belongs to current teacher
const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

function classifyByName(rawName = '') {
  const name = rawName.toLowerCase();

  return {
    isCt:
      name.includes('ct') ||
      name.includes('class test') ||
      name.includes('class-test'),
    isMid: name.includes('mid'),
    isFinal: name.includes('final'),
    isAttendance:
      name.includes('attendance') ||
      name.includes('attend') ||
      name.includes('att.'),
    isAssignment: name.includes('assignment') || name.includes('assign'),
    isPresentation:
      name.includes('presentation') ||
      name.includes('present.') ||
      name.includes('presentation/assignment'),
  };
}

function getHybridExamKey(rawName = '') {
  const name = String(rawName || '').toLowerCase();

  const isMid = name.includes('mid');
  const isFinal = name.includes('final');
  const isLab = name.includes('lab');
  const isTheory =
    name.includes('theory') ||
    name.includes('written') ||
    name.includes('theoretical');

  if (isMid && isLab) return 'lab_mid';
  if (isMid && isTheory) return 'theory_mid';
  if (isMid) return 'generic_mid';

  if (isFinal && isLab) return 'lab_final';
  if (isFinal && isTheory) return 'theory_final';
  if (isFinal) return 'generic_final';

  return '';
}

function getHybridExamLabel(key = '') {
  const labels = {
    theory_mid: 'Theory Mid',
    lab_mid: 'Lab Mid',
    theory_final: 'Theory Final',
    lab_final: 'Lab Final',
    generic_mid: 'Mid',
    generic_final: 'Final',
  };

  return labels[key] || 'Hybrid exam';
}

const HYBRID_EXAM_MARKS = {
  theory_mid: 20,
  lab_mid: 10,
  theory_final: 30,
  lab_final: 10,
  generic_mid: 30,
  generic_final: 40,
};

const HYBRID_EXAM_SPLITS = {
  generic_mid: {
    totalMarks: 30,
    label: 'Mid',
    items: [
      { key: 'theory_mid', name: 'Theory Mid', fullMarks: 20 },
      { key: 'lab_mid', name: 'Lab Mid', fullMarks: 10 },
    ],
  },
  generic_final: {
    totalMarks: 40,
    label: 'Final',
    items: [
      { key: 'theory_final', name: 'Theory Final', fullMarks: 30 },
      { key: 'lab_final', name: 'Lab Final', fullMarks: 10 },
    ],
  },
};

function validateHybridExamName(rawName = '', { allowGeneric = false } = {}) {
  const key = getHybridExamKey(rawName);

  if (!allowGeneric && key === 'generic_mid') {
    return 'For hybrid courses, please use either "Theory Mid" or "Lab Mid" instead of a generic Mid name.';
  }

  if (!allowGeneric && key === 'generic_final') {
    return 'For hybrid courses, please use either "Theory Final" or "Lab Final" instead of a generic Final name.';
  }

  return null;
}

function validateHybridExamFullMarks(rawName = '', rawFullMarks) {
  const key = getHybridExamKey(rawName);
  const expectedMarks = HYBRID_EXAM_MARKS[key];

  if (expectedMarks == null) return null;

  if (Number(rawFullMarks) !== expectedMarks) {
    return `${getHybridExamLabel(key)} must have ${expectedMarks} marks for hybrid courses.`;
  }

  return null;
}

function getNextAssessmentOrder(existing = []) {
  if (!existing.length) return 0;

  const maxOrder = existing.reduce((max, item, index) => {
    const value = Number(item?.order);
    return Math.max(max, Number.isFinite(value) ? value : index);
  }, -1);

  return maxOrder + 1;
}

function getHybridSplitPayload(rawName = '', rawFullMarks) {
  const key = getHybridExamKey(rawName);
  const split = HYBRID_EXAM_SPLITS[key];

  if (!split) return null;

  if (Number(rawFullMarks) !== split.totalMarks) {
    return {
      error: `${split.label} must have ${split.totalMarks} marks before it can be split automatically.`,
    };
  }

  return { key, ...split };
}


const DEFAULT_SUBMISSION_ALLOWED_EXTENSIONS = [
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

function normalizeSubmissionAllowedExtensions(value) {
  if (!Array.isArray(value)) return DEFAULT_SUBMISSION_ALLOWED_EXTENSIONS;

  const cleaned = value.map((item) => sanitizeExtension(item)).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length ? unique : DEFAULT_SUBMISSION_ALLOWED_EXTENSIONS;
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function sumMarks(list = [], field = 'marks') {
  return round2(
    list.reduce((sum, item) => sum + Number(item?.[field] || 0), 0)
  );
}

function extractValidSubKeys(config) {
  const keys = new Set();

  if (!config || typeof config !== 'object') return keys;

  const mode = config.mode;

  if (mode === 'project_only' || mode === 'mixed') {
    (config.projectComponents || []).forEach((component) => {
      if (component.entryMode === 'phased') {
        (component.phases || []).forEach((phase) => {
          if (phase?.key) keys.add(String(phase.key));
        });
      } else if (component?.key) {
        keys.add(String(component.key));
      }
    });
  }

  if (mode === 'lab_exam_only' || mode === 'mixed') {
    (config.examQuestions || []).forEach((q) => {
      if (q?.key) keys.add(String(q.key));
    });
  }

  return keys;
}

async function cleanupMarksForAdvancedLabFinal(assessmentId, labFinalConfig) {
  const validKeys = extractValidSubKeys(labFinalConfig);
  const marks = await Mark.find({ assessment: assessmentId });

  for (const mark of marks) {
    const oldSubMarks = Array.isArray(mark.subMarks) ? mark.subMarks : [];

    const cleanedSubMarks = oldSubMarks
      .filter((item) => validKeys.has(String(item?.key || '')))
      .map((item) => ({
        key: String(item.key),
        obtainedMarks: Number(item.obtainedMarks || 0),
      }));

    const newTotal = round2(
      cleanedSubMarks.reduce(
        (sum, item) => sum + Number(item?.obtainedMarks || 0),
        0
      )
    );

    mark.subMarks = cleanedSubMarks;
    mark.obtainedMarks = newTotal;
    await mark.save();
  }
}

async function cleanupMarksForRegularAssessment(assessmentId) {
  const marks = await Mark.find({ assessment: assessmentId });

  for (const mark of marks) {
    if (Array.isArray(mark.subMarks) && mark.subMarks.length > 0) {
      mark.subMarks = [];
      await mark.save();
    }
  }
}

function validateLabFinalConfig(config) {
  if (!config || typeof config !== 'object') {
    return 'labFinalConfig is required for lab_final assessments.';
  }

  const mode = config.mode;
  const totalMarks = Number(config.totalMarks ?? 40);
  const projectMarks = Number(config.projectMarks ?? 0);
  const labExamMarks = Number(config.labExamMarks ?? 0);
  const projectComponents = Array.isArray(config.projectComponents)
    ? config.projectComponents
    : [];
  const examQuestions = Array.isArray(config.examQuestions)
    ? config.examQuestions
    : [];

  if (!['project_only', 'lab_exam_only', 'mixed'].includes(mode)) {
    return 'Invalid lab final mode.';
  }

  if (round2(totalMarks) !== 40) {
    return 'Lab final totalMarks must be exactly 40.';
  }

  if (mode === 'project_only') {
    if (round2(projectMarks) !== 40) {
      return 'For project_only mode, projectMarks must be 40.';
    }
    if (round2(labExamMarks) !== 0) {
      return 'For project_only mode, labExamMarks must be 0.';
    }
  }

  if (mode === 'lab_exam_only') {
    if (round2(projectMarks) !== 0) {
      return 'For lab_exam_only mode, projectMarks must be 0.';
    }
    if (round2(labExamMarks) !== 40) {
      return 'For lab_exam_only mode, labExamMarks must be 40.';
    }
  }

  if (mode === 'mixed') {
    if (round2(projectMarks + labExamMarks) !== 40) {
      return 'For mixed mode, projectMarks + labExamMarks must equal 40.';
    }
    if (projectMarks <= 0 || labExamMarks <= 0) {
      return 'For mixed mode, both projectMarks and labExamMarks must be greater than 0.';
    }
  }

  for (const component of projectComponents) {
    const entryMode = component?.entryMode || 'single';
    const componentMarks = Number(component?.marks || 0);
    const phases = Array.isArray(component?.phases) ? component.phases : [];

    if (!component?.key || !component?.name) {
      return 'Every project component must have key and name.';
    }

    if (componentMarks < 0) {
      return 'Project component marks cannot be negative.';
    }

    if (!['single', 'phased'].includes(entryMode)) {
      return 'Invalid project component entryMode.';
    }

    if (entryMode === 'phased') {
      if (!phases.length) {
        return `Project component "${component.name}" must contain phases.`;
      }

      for (const phase of phases) {
        if (!phase?.key || !phase?.name) {
          return `Every phase under "${component.name}" must have key and name.`;
        }
        if (Number(phase?.marks || 0) < 0) {
          return `Phase marks cannot be negative under "${component.name}".`;
        }
      }

      const phaseTotal = sumMarks(phases, 'marks');
      if (round2(phaseTotal) !== round2(componentMarks)) {
        return `Sum of phases for "${component.name}" must equal its allocated marks.`;
      }
    }
  }

  for (const q of examQuestions) {
    if (!q?.key || !q?.label) {
      return 'Every lab final question must have key and label.';
    }
    if (Number(q?.marks || 0) < 0) {
      return 'Question marks cannot be negative.';
    }
  }

  const projectTotal = sumMarks(projectComponents, 'marks');
  const examTotal = sumMarks(examQuestions, 'marks');

  if (round2(projectTotal) !== round2(projectMarks)) {
    return 'Total of project components must equal projectMarks.';
  }

  if (round2(examTotal) !== round2(labExamMarks)) {
    return 'Total of lab final questions must equal labExamMarks.';
  }

  if (mode === 'project_only' && examQuestions.length > 0) {
    return 'Project only mode cannot contain lab final questions.';
  }

  if (mode === 'lab_exam_only' && projectComponents.length > 0) {
    return 'Lab final only mode cannot contain project components.';
  }

  return null;
}

/**
 * POST /api/courses/:courseId/assessments
 */
const createAssessment = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      name,
      fullMarks,
      order,
      structureType = 'regular',
      labFinalConfig = null,
      submissionConfig = null,
    } = req.body;

    if (!name || fullMarks == null) {
      return res
        .status(400)
        .json({ message: 'Name and fullMarks are required' });
    }

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const existing = await Assessment.find({ course: courseId });
    const markEntryAssessments = existing.filter(
      (assessment) => assessment?.structureType !== 'lab_submission'
    );

    const newFlags = classifyByName(name);
    const isAdvancedLabFinal = structureType === 'lab_final';
    const isLabSubmission = structureType === 'lab_submission';


    let finalSubmissionConfig = null;
    if (isLabSubmission) {
      finalSubmissionConfig = {
        instructions: String(submissionConfig?.instructions || '').trim(),
        dueDate: submissionConfig?.dueDate || null,
        allowedExtensions: normalizeSubmissionAllowedExtensions(
          submissionConfig?.allowedExtensions
        ),
        maxFileSizeMB: Number(submissionConfig?.maxFileSizeMB || 10),
        allowResubmission: submissionConfig?.allowResubmission !== false,
      };
    }

    if (isAdvancedLabFinal) {
      if ((course?.courseType || '').toLowerCase() !== 'lab') {
        return res.status(400).json({
          message:
            'Advanced lab final configuration is only allowed for lab courses.',
        });
      }

      if (Number(fullMarks) !== 40) {
        return res.status(400).json({
          message: 'Advanced lab final assessment fullMarks must be 40.',
        });
      }

      const alreadyAdvancedLabFinal = markEntryAssessments.some(
        (a) => a.structureType === 'lab_final'
      );

      if (alreadyAdvancedLabFinal) {
        return res.status(400).json({
          message:
            'An advanced lab final already exists for this course. Only one is allowed.',
        });
      }

      const configError = validateLabFinalConfig(labFinalConfig);
      if (configError) {
        return res.status(400).json({ message: configError });
      }
    }

    const courseType = String(course?.courseType || 'theory').toLowerCase();

    // Submission-only assessments are hidden from the marks-entry assessment list.
    // Their names must not block Mid/Final/Attendance/Assignment/Presentation fields.
    if (!isLabSubmission) {
      if (courseType === 'hybrid' && (newFlags.isMid || (newFlags.isFinal && !isAdvancedLabFinal))) {
        const hybridSplit = getHybridSplitPayload(name, fullMarks);

        if (hybridSplit?.error) {
          return res.status(400).json({ message: hybridSplit.error });
        }

        if (hybridSplit) {
          const existingKeys = new Set(
            markEntryAssessments.map((a) => getHybridExamKey(a.name)).filter(Boolean)
          );

          const alreadyExistingItem = hybridSplit.items.find((item) =>
            existingKeys.has(item.key)
          );

          if (alreadyExistingItem) {
            return res.status(400).json({
              message: `${getHybridExamLabel(alreadyExistingItem.key)} already exists for this hybrid course.`,
            });
          }

          const baseOrder =
            order != null ? Number(order) : getNextAssessmentOrder(markEntryAssessments);

          const createdAssessments = await Assessment.insertMany(
            hybridSplit.items.map((item, idx) => ({
              course: courseId,
              name: item.name,
              fullMarks: item.fullMarks,
              order: baseOrder + idx,
              structureType: 'regular',
              labFinalConfig: null,
              submissionConfig: null,
            }))
          );

          return res.status(201).json({
            message: `${hybridSplit.label} created as separate theory and lab fields.`,
            assessments: createdAssessments,
          });
        }

        const hybridNameError = validateHybridExamName(name);
        if (hybridNameError) {
          return res.status(400).json({ message: hybridNameError });
        }

        const hybridMarksError = validateHybridExamFullMarks(name, fullMarks);
        if (hybridMarksError) {
          return res.status(400).json({ message: hybridMarksError });
        }

        const hybridKey = getHybridExamKey(name);
        const alreadySameHybridExam = markEntryAssessments.some(
          (a) => getHybridExamKey(a.name) === hybridKey
        );

        if (hybridKey && alreadySameHybridExam) {
          return res.status(400).json({
            message: `${getHybridExamLabel(hybridKey)} already exists for this hybrid course.`,
          });
        }
      } else {
        if (newFlags.isMid) {
          const alreadyMid = markEntryAssessments.some((a) => classifyByName(a.name).isMid);
          if (alreadyMid) {
            return res.status(400).json({
              message:
                'Mid already exists for this course. Only one Mid exam is allowed.',
            });
          }
        }

        if (newFlags.isFinal && !isAdvancedLabFinal) {
          const alreadyFinal = markEntryAssessments.some((a) => classifyByName(a.name).isFinal);
          if (alreadyFinal) {
            return res.status(400).json({
              message:
                'Final already exists for this course. Only one Final exam is allowed.',
            });
          }
        }
      }

      if (newFlags.isAttendance) {
        const alreadyAtt = markEntryAssessments.some(
          (a) => classifyByName(a.name).isAttendance
        );
        if (alreadyAtt) {
          return res.status(400).json({
            message:
              'Attendance assessment already exists. Only one Attendance component is allowed.',
          });
        }
      }

      if (newFlags.isAssignment) {
        const alreadyAssign = markEntryAssessments.some(
          (a) => classifyByName(a.name).isAssignment
        );
        if (alreadyAssign) {
          return res.status(400).json({
            message:
              'Assignment assessment already exists. You can have at most one Assignment for this course.',
          });
        }
      }

      if (newFlags.isPresentation) {
        const alreadyPres = markEntryAssessments.some(
          (a) => classifyByName(a.name).isPresentation
        );
        if (alreadyPres) {
          return res.status(400).json({
            message:
              'Presentation assessment already exists. You can have at most one Presentation for this course.',
          });
        }
      }
    }

    const assessment = await Assessment.create({
      course: courseId,
      name: name.trim(),
      fullMarks: Number(fullMarks),
      order: order ?? 0,
      structureType,
      labFinalConfig: isAdvancedLabFinal ? labFinalConfig : null,
      submissionConfig: isLabSubmission ? finalSubmissionConfig : null,
    });

    return res.status(201).json(assessment);
  } catch (err) {
    console.error('Create assessment error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/courses/:courseId/assessments
 */
const getAssessmentsForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const assessments = await Assessment.find({ course: courseId }).sort({
      order: 1,
      createdAt: 1,
    });

    return res.json(assessments);
  } catch (err) {
    console.error('Get assessments error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/courses/assessments/:assessmentId
 */
const updateAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const {
      name,
      fullMarks,
      order,
      structureType,
      labFinalConfig,
      submissionConfig,
    } = req.body;

    const assessment = await Assessment.findById(assessmentId).populate('course');

    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    if (!assessment.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const courseId = assessment.course._id;
    const finalName = name != null ? String(name).trim() : assessment.name;
    const finalFullMarks =
      fullMarks != null ? Number(fullMarks) : Number(assessment.fullMarks);
    const finalStructureType =
      structureType || assessment.structureType || 'regular';

    const siblings = await Assessment.find({
      course: courseId,
      _id: { $ne: assessment._id },
    });
    const markEntrySiblings = siblings.filter(
      (item) => item?.structureType !== 'lab_submission'
    );

    const newFlags = classifyByName(finalName);
    const isAdvancedLabFinal = finalStructureType === 'lab_final';
    const isLabSubmission = finalStructureType === 'lab_submission';


    let finalSubmissionConfig = null;
    if (isLabSubmission) {
      finalSubmissionConfig = {
        instructions: String(submissionConfig?.instructions || '').trim(),
        dueDate: submissionConfig?.dueDate || null,
        allowedExtensions: normalizeSubmissionAllowedExtensions(
          submissionConfig?.allowedExtensions
        ),
        maxFileSizeMB: Number(submissionConfig?.maxFileSizeMB || 10),
        allowResubmission: submissionConfig?.allowResubmission !== false,
      };
    }

    if (isAdvancedLabFinal) {
      if (((assessment.course?.courseType || '').toLowerCase() !== 'lab')) {
        return res.status(400).json({
          message:
            'Advanced lab final configuration is only allowed for lab courses.',
        });
      }

      if (finalFullMarks !== 40) {
        return res.status(400).json({
          message: 'Advanced lab final assessment fullMarks must be 40.',
        });
      }

      const anotherAdvancedLabFinal = markEntrySiblings.some(
        (a) => a.structureType === 'lab_final'
      );

      if (anotherAdvancedLabFinal) {
        return res.status(400).json({
          message:
            'Another advanced lab final already exists for this course. Only one is allowed.',
        });
      }

      const configToValidate =
        labFinalConfig != null ? labFinalConfig : assessment.labFinalConfig;

      const configError = validateLabFinalConfig(configToValidate);
      if (configError) {
        return res.status(400).json({ message: configError });
      }

      assessment.structureType = 'lab_final';
      assessment.labFinalConfig = configToValidate;
      assessment.submissionConfig = null;
    } else if (isLabSubmission) {
      assessment.structureType = 'lab_submission';
      assessment.labFinalConfig = null;
      assessment.submissionConfig = {
        instructions: String(submissionConfig?.instructions || assessment.submissionConfig?.instructions || '').trim(),
        dueDate: submissionConfig?.dueDate || assessment.submissionConfig?.dueDate || null,
        allowedExtensions: Array.isArray(submissionConfig?.allowedExtensions)
          ? normalizeSubmissionAllowedExtensions(submissionConfig.allowedExtensions)
          : normalizeSubmissionAllowedExtensions(assessment.submissionConfig?.allowedExtensions),
        maxFileSizeMB: Number(submissionConfig?.maxFileSizeMB || assessment.submissionConfig?.maxFileSizeMB || 10),
        allowResubmission: submissionConfig?.allowResubmission !== false,
      };
    } else {
      assessment.structureType = 'regular';
      assessment.labFinalConfig = null;
      assessment.submissionConfig = null;
    }

    const courseType = String(assessment.course?.courseType || 'theory').toLowerCase();

    if (!isLabSubmission) {
      if (courseType === 'hybrid' && (newFlags.isMid || (newFlags.isFinal && !isAdvancedLabFinal))) {
        const hybridNameError = validateHybridExamName(finalName);
        if (hybridNameError) {
          return res.status(400).json({ message: hybridNameError });
        }

        const hybridMarksError = validateHybridExamFullMarks(finalName, finalFullMarks);
        if (hybridMarksError) {
          return res.status(400).json({ message: hybridMarksError });
        }

        const hybridKey = getHybridExamKey(finalName);
        const alreadySameHybridExam = markEntrySiblings.some(
          (a) => getHybridExamKey(a.name) === hybridKey
        );

        if (hybridKey && alreadySameHybridExam) {
          return res.status(400).json({
            message: `${getHybridExamLabel(hybridKey)} already exists for this hybrid course.`,
          });
        }
      } else {
        if (newFlags.isMid) {
          const alreadyMid = markEntrySiblings.some((a) => classifyByName(a.name).isMid);
          if (alreadyMid) {
            return res.status(400).json({
              message:
                'Mid already exists for this course. Only one Mid exam is allowed.',
            });
          }
        }

        if (newFlags.isFinal && !isAdvancedLabFinal) {
          const alreadyFinal = markEntrySiblings.some((a) => classifyByName(a.name).isFinal);
          if (alreadyFinal) {
            return res.status(400).json({
              message:
                'Final already exists for this course. Only one Final exam is allowed.',
            });
          }
        }
      }

      if (newFlags.isAttendance) {
        const alreadyAtt = markEntrySiblings.some(
          (a) => classifyByName(a.name).isAttendance
        );
        if (alreadyAtt) {
          return res.status(400).json({
            message:
              'Attendance assessment already exists. Only one Attendance component is allowed.',
          });
        }
      }

      if (newFlags.isAssignment) {
        const alreadyAssign = markEntrySiblings.some(
          (a) => classifyByName(a.name).isAssignment
        );
        if (alreadyAssign) {
          return res.status(400).json({
            message:
              'Assignment assessment already exists. You can have at most one Assignment for this course.',
          });
        }
      }

      if (newFlags.isPresentation) {
        const alreadyPres = markEntrySiblings.some(
          (a) => classifyByName(a.name).isPresentation
        );
        if (alreadyPres) {
          return res.status(400).json({
            message:
              'Presentation assessment already exists. You can have at most one Presentation for this course.',
          });
        }
      }
    }

    assessment.name = finalName;
    assessment.fullMarks = finalFullMarks;
    if (order != null) assessment.order = Number(order);

    await assessment.save();

    if (assessment.structureType === 'lab_final') {
      await cleanupMarksForAdvancedLabFinal(
        assessment._id,
        assessment.labFinalConfig
      );
    } else {
      await cleanupMarksForRegularAssessment(assessment._id);
    }

    return res.json(assessment);
  } catch (err) {
    console.error('Update assessment error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/courses/assessments/:assessmentId
 * Also deletes all marks under that assessment.
 */
const deleteAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;

    const assessment = await Assessment.findById(assessmentId).populate(
      'course'
    );
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    if (!assessment.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await Mark.deleteMany({ assessment: assessment._id });
    await assessment.deleteOne();

    return res.json({ message: 'Assessment and related marks deleted' });
  } catch (err) {
    console.error('Delete assessment error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const publishAssessment = async (req, res) => {
  try {
    const { courseId, assessmentId } = req.params;

    const course = await Course.findOne({
      _id: courseId,
      createdBy: req.user.userId,
    });

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const assessment = await Assessment.findOne({
      _id: assessmentId,
      course: courseId,
    });

    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    assessment.isPublished = true;
    assessment.publishedAt = new Date();
    await assessment.save();

    return res.json({
      message: 'Assessment published successfully',
      assessment,
    });
  } catch (err) {
    console.error('Publish assessment error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getAssessmentsForCourse,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  publishAssessment,
};