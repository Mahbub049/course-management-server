const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

// helper: ensure course belongs to current teacher
const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

// small helper to classify an assessment by its name (case-insensitive)
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

/**
 * POST /api/courses/:courseId/assessments
 * Body: { name, fullMarks, order? }
 */
const createAssessment = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { name, fullMarks, order } = req.body;

    if (!name || fullMarks == null) {
      return res
        .status(400)
        .json({ message: 'Name and fullMarks are required' });
    }

    // check course ownership
    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // load existing assessments for this course
    const existing = await Assessment.find({ course: courseId });

    const newFlags = classifyByName(name);

    // --- HARD LIMITS (for both theory and lab courses) ---

    // Only one Mid
    if (newFlags.isMid) {
      const alreadyMid = existing.some((a) => classifyByName(a.name).isMid);
      if (alreadyMid) {
        return res.status(400).json({
          message:
            'Mid already exists for this course. Only one Mid exam is allowed.',
        });
      }
    }

    // Only one Final
    if (newFlags.isFinal) {
      const alreadyFinal = existing.some((a) => classifyByName(a.name).isFinal);
      if (alreadyFinal) {
        return res.status(400).json({
          message:
            'Final already exists for this course. Only one Final exam is allowed.',
        });
      }
    }

    // Only one Attendance
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

    // Only one Assignment
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

    // Only one Presentation
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

    // Note: CTs and lab-type evaluations are intentionally NOT limited here.
    // You can keep adding CT1, CT2, CT3, Lab Eval 01, etc.
    // Your marks calculation code will handle “best two CTs = 15”, lab average = 25, etc.

    const assessment = await Assessment.create({
      course: courseId,
      name: name.trim(),
      fullMarks,
      order: order ?? 0,
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
 * Body: { name?, fullMarks?, order? }
 *
 * NOTE: This does NOT re-enforce the “only 1 mid/final/attendance/assignment/presentation”
 * when editing names – in your current UI you are not editing assessment names.
 * If later you add rename UI, we can add similar checks here as well.
 */
const updateAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { name, fullMarks, order } = req.body;

    const assessment = await Assessment.findById(assessmentId).populate(
      'course'
    );

    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    // check teacher ownership
    if (!assessment.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (name != null) assessment.name = name.trim();
    if (fullMarks != null) assessment.fullMarks = fullMarks;
    if (order != null) assessment.order = order;

    await assessment.save();
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

    // ownership check
    if (!assessment.course.createdBy.equals(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // delete all marks mapped to this assessment
    await Mark.deleteMany({ assessment: assessment._id });

    await assessment.deleteOne();

    return res.json({ message: 'Assessment and related marks deleted' });
  } catch (err) {
    console.error('Delete assessment error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createAssessment,
  getAssessmentsForCourse,
  updateAssessment,
  deleteAssessment,
};
