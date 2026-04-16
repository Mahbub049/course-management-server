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

    const newFlags = classifyByName(name);
    const isAdvancedLabFinal = structureType === 'lab_final';

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

      const alreadyAdvancedLabFinal = existing.some(
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

    if (newFlags.isMid) {
      const alreadyMid = existing.some((a) => classifyByName(a.name).isMid);
      if (alreadyMid) {
        return res.status(400).json({
          message:
            'Mid already exists for this course. Only one Mid exam is allowed.',
        });
      }
    }

    if (newFlags.isFinal && !isAdvancedLabFinal) {
      const alreadyFinal = existing.some((a) => classifyByName(a.name).isFinal);
      if (alreadyFinal) {
        return res.status(400).json({
          message:
            'Final already exists for this course. Only one Final exam is allowed.',
        });
      }
    }

    if (newFlags.isAttendance) {
      const alreadyAtt = existing.some(
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
      const alreadyAssign = existing.some(
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
      const alreadyPres = existing.some(
        (a) => classifyByName(a.name).isPresentation
      );
      if (alreadyPres) {
        return res.status(400).json({
          message:
            'Presentation assessment already exists. You can have at most one Presentation for this course.',
        });
      }
    }

    const assessment = await Assessment.create({
      course: courseId,
      name: name.trim(),
      fullMarks: Number(fullMarks),
      order: order ?? 0,
      structureType,
      labFinalConfig: isAdvancedLabFinal ? labFinalConfig : null,
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

    const newFlags = classifyByName(finalName);
    const isAdvancedLabFinal = finalStructureType === 'lab_final';

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

      const anotherAdvancedLabFinal = siblings.some(
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
    } else {
      assessment.structureType = 'regular';
      assessment.labFinalConfig = null;
    }

    if (newFlags.isMid) {
      const alreadyMid = siblings.some((a) => classifyByName(a.name).isMid);
      if (alreadyMid) {
        return res.status(400).json({
          message:
            'Mid already exists for this course. Only one Mid exam is allowed.',
        });
      }
    }

    if (newFlags.isFinal && !isAdvancedLabFinal) {
      const alreadyFinal = siblings.some((a) => classifyByName(a.name).isFinal);
      if (alreadyFinal) {
        return res.status(400).json({
          message:
            'Final already exists for this course. Only one Final exam is allowed.',
        });
      }
    }

    if (newFlags.isAttendance) {
      const alreadyAtt = siblings.some(
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
      const alreadyAssign = siblings.some(
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
      const alreadyPres = siblings.some(
        (a) => classifyByName(a.name).isPresentation
      );
      if (alreadyPres) {
        return res.status(400).json({
          message:
            'Presentation assessment already exists. You can have at most one Presentation for this course.',
        });
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