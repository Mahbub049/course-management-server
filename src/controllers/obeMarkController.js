const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');
const ObeStudentMark = require('../models/ObeStudentMark');
const { round2 } = require('../utils/obeCalculation');

const isHalfStepMark = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
};

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

    const examBlueprintIds = blueprints
      .filter((blueprint) => ["mid", "final"].includes(String(blueprint.assessmentType || "").trim().toLowerCase()))
      .map((blueprint) => blueprint._id);
    const existingExamMarks = examBlueprintIds.length
      ? await ObeStudentMark.find({
          course: courseId,
          blueprint: { $in: examBlueprintIds },
        }).select('student blueprint status')
      : [];

    const examStatusByRecord = new Map();

    for (const savedMark of existingExamMarks) {
      const blueprint = blueprintMap.get(String(savedMark.blueprint));
      const type = String(blueprint?.assessmentType || '').trim().toLowerCase();
      if (!['mid', 'final'].includes(type)) continue;
      examStatusByRecord.set(`${String(savedMark.student)}__${String(savedMark.blueprint)}`, {
        studentId: String(savedMark.student),
        type,
        absent: ['absent', 'incomplete'].includes(String(savedMark.status || '').toLowerCase()),
      });
    }

    const preparedRecords = [];

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

      const assessmentType = String(blueprint.assessmentType || '').trim().toLowerCase();
      const rawStatus = String(record?.status || 'present').trim().toLowerCase();
      const asksForAbsence = ['absent', 'incomplete'].includes(rawStatus);
      if (asksForAbsence && !['mid', 'final'].includes(assessmentType)) {
        return res.status(400).json({
          message: 'Absent is allowed only for Mid or Final in OBE marks.',
        });
      }

      const requestedStatus = asksForAbsence ? rawStatus : 'present';
      if (['mid', 'final'].includes(assessmentType)) {
        examStatusByRecord.set(`${studentId}__${blueprintId}`, {
          studentId,
          type: assessmentType,
          absent: asksForAbsence,
        });
      }

      preparedRecords.push({
        record,
        studentId,
        blueprintId,
        blueprint,
        requestedStatus,
      });
    }

    const examAbsenceByStudent = new Map();
    for (const state of examStatusByRecord.values()) {
      if (!state.absent) continue;
      if (!examAbsenceByStudent.has(state.studentId)) {
        examAbsenceByStudent.set(state.studentId, { mid: false, final: false });
      }
      examAbsenceByStudent.get(state.studentId)[state.type] = true;
    }

    for (const [studentId, state] of examAbsenceByStudent.entries()) {
      if (state.mid && state.final) {
        return res.status(400).json({
          message: 'A student cannot be marked Absent in both Mid and Final. Keep A in only one exam and enter 0 or numeric marks in the other.',
          studentId,
        });
      }
    }

    const bulkOps = [];

    for (const prepared of preparedRecords) {
      const { record, studentId, blueprintId, blueprint, requestedStatus } = prepared;
      const normalizedEntries = [];
      let totalMarks = 0;

      for (const item of blueprint.items || []) {
        const matching = (Array.isArray(record.entries) ? record.entries : []).find((entry) => entry?.itemKey === item.key);
        const numeric = requestedStatus === 'present' ? Number(matching?.obtainedMarks ?? 0) : 0;
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > Number(item.marks || 0)) {
          return res.status(400).json({
            message: `Invalid obtained marks for ${blueprint.assessmentName} - ${item.label}.`,
          });
        }
        if (!isHalfStepMark(numeric)) {
          return res.status(400).json({
            message: `Only whole or .5 marks are allowed for ${blueprint.assessmentName} - ${item.label}.`,
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
              status: requestedStatus,
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
