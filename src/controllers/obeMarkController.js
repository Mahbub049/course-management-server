const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');
const ObeStudentMark = require('../models/ObeStudentMark');
const { round2 } = require('../utils/obeCalculation');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const getCourseType = (course = {}) => {
  const type = String(course.courseType || course.type || '').trim().toLowerCase();
  if (type === 'hybrid') return 'hybrid';
  if (type.includes('lab')) return 'lab';
  return 'theory';
};

const isAllowedBlueprintForCourse = (course, blueprint = {}) => {
  if (getCourseType(course) !== 'lab') return true;

  const type = String(blueprint.assessmentType || '').trim().toLowerCase();
  return ['mid', 'midterm', 'final'].includes(type);
};

const getObeMarkEntry = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const blueprintQuery = { course: courseId };
    if (getCourseType(course) === 'lab') {
      blueprintQuery.assessmentType = { $in: ['mid', 'final'] };
    }

    const [enrollments, blueprints, marks] = await Promise.all([
      Enrollment.find({ course: courseId }).populate('student'),
      ObeAssessmentBlueprint.find(blueprintQuery).sort({ order: 1, createdAt: 1 }),
      ObeStudentMark.find({ course: courseId }),
    ]);

    const students = enrollments
      .filter((enr) => enr.student?._id)
      .map((enr) => ({
        studentId: enr.student._id,
        roll: enr.student.username || '',
        name: enr.student.name || '',
        email: enr.student.email || null,
      }));

    const enrolledStudentIds = new Set(
      students.map((student) => String(student.studentId))
    );
    const visibleBlueprintIds = new Set(
      blueprints.map((blueprint) => String(blueprint._id))
    );
    const activeMarks = marks.filter(
      (mark) =>
        enrolledStudentIds.has(String(mark.student)) &&
        visibleBlueprintIds.has(String(mark.blueprint))
    );

    return res.json({ students, blueprints, marks: activeMarks });
  } catch (error) {
    console.error('getObeMarkEntry error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const saveObeMarks = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { records = [] } = req.body || {};

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ message: 'records array is required.' });
    }

    const [enrollments, blueprints] = await Promise.all([
      Enrollment.find({ course: courseId }).select('student'),
      ObeAssessmentBlueprint.find({ course: courseId }),
    ]);

    const enrolledStudentIds = new Set(enrollments.map((row) => String(row.student)));
    const blueprintMap = new Map(
      blueprints
        .filter((blueprint) => isAllowedBlueprintForCourse(course, blueprint))
        .map((blueprint) => [String(blueprint._id), blueprint])
    );

    const bulkOps = [];

    for (const record of records) {
      const studentId = String(record?.studentId || '');
      const blueprintId = String(record?.blueprintId || '');
      const blueprint = blueprintMap.get(blueprintId);

      if (!studentId || !enrolledStudentIds.has(studentId)) {
        return res.status(400).json({ message: 'Invalid student found in OBE marks save request.' });
      }
      if (!blueprint) {
        return res.status(400).json({
          message:
            getCourseType(course) === 'lab'
              ? 'Lab OBE marks can only be entered for Lab Mid and Lab Final.'
              : 'Invalid blueprint found in OBE marks save request.',
        });
      }

      const itemMap = new Map((blueprint.items || []).map((item) => [item.key, item]));
      const normalizedEntries = [];
      let totalMarks = 0;

      for (const item of blueprint.items || []) {
        const matching = (Array.isArray(record.entries) ? record.entries : []).find((entry) => entry?.itemKey === item.key);
        const numeric = Number(matching?.obtainedMarks ?? 0);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > Number(item.marks || 0)) {
          return res.status(400).json({
            message: `Invalid obtained marks for ${blueprint.assessmentName} - ${item.label}.`,
          });
        }
        const rounded = round2(numeric);
        totalMarks += rounded;
        normalizedEntries.push({ itemKey: item.key, obtainedMarks: rounded });
      }

      totalMarks = round2(totalMarks);
      if (totalMarks > Number(blueprint.totalMarks || 0)) {
        return res.status(400).json({ message: `Total marks exceed ${blueprint.assessmentName} total.` });
      }

      bulkOps.push({
        updateOne: {
          filter: { course: courseId, student: studentId, blueprint: blueprintId },
          update: {
            $set: {
              course: courseId,
              student: studentId,
              blueprint: blueprintId,
              entries: normalizedEntries,
              totalMarks,
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length) await ObeStudentMark.bulkWrite(bulkOps, { ordered: false });

    return res.json({ message: 'OBE marks saved successfully.' });
  } catch (error) {
    console.error('saveObeMarks error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getObeMarkEntry,
  saveObeMarks,
};
