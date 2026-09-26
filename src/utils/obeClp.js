const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const CourseOutcome = require('../models/CourseOutcome');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');
const AttendanceSummary = require('../models/AttendanceSummary');
const ObeClpConfig = require('../models/ObeClpConfig');
const ObeClpStudentMark = require('../models/ObeClpStudentMark');
const { buildContinuousAssessmentData } = require('./obeContinuousAssessment');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const lower = (value) => String(value || '').trim().toLowerCase();
const stringId = (value) => String(value?._id || value?.id || value || '');
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));

const getCourseType = (course = {}) => {
  const type = lower(course.courseType || course.type);
  if (type === 'hybrid') return 'hybrid';
  if (type.includes('lab')) return 'lab';
  return 'theory';
};

const isClpSourceAssessment = (assessment = {}) => {
  const name = lower(assessment.name);
  return (
    assessment.structureType !== 'lab_final' &&
    assessment.structureType !== 'lab_submission' &&
    !name.includes('mid') &&
    !name.includes('final') &&
    !name.includes('att')
  );
};

const getDefaultAttendanceCo = (courseOutcomes = []) => {
  const codes = (courseOutcomes || []).map((row) => String(row.code || '').trim().toUpperCase());
  return codes.includes('CO3') ? 'CO3' : codes[0] || 'CO3';
};

const uniqueStrings = (values = []) => [
  ...new Set((values || []).map((value) => stringId(value)).filter(Boolean)),
];

const buildLabClpData = async (courseId) => {
  const [
    course,
    enrollments,
    courseOutcomes,
    config,
    assessments,
    markDocs,
    attendanceSummaries,
    manualDocs,
  ] = await Promise.all([
    Course.findById(courseId).lean(),
    Enrollment.find({ course: courseId }).populate('student', 'name username email').lean(),
    CourseOutcome.find({ course: courseId, isActive: { $ne: false } })
      .sort({ order: 1, code: 1 })
      .lean(),
    ObeClpConfig.findOne({ course: courseId }).lean(),
    Assessment.find({ course: courseId }).sort({ order: 1, createdAt: 1 }).lean(),
    Mark.find({ course: courseId }).lean(),
    AttendanceSummary.find({ course: courseId }).lean(),
    ObeClpStudentMark.find({ course: courseId }).lean(),
  ]);

  const isLabCourse = getCourseType(course || {}) === 'lab';
  const sourceAssessments = (assessments || []).filter(isClpSourceAssessment);
  const sourceAssessmentById = new Map(sourceAssessments.map((row) => [stringId(row), row]));

  const students = (enrollments || [])
    .filter((row) => row.student?._id)
    .map((row) => ({
      studentId: String(row.student._id),
      roll: row.student.username || '',
      name: row.student.name || '',
      email: row.student.email || '',
    }));
  const enrolledStudentIds = new Set(students.map((row) => row.studentId));

  const marksByStudentAssessment = new Map();
  (markDocs || []).forEach((mark) => {
    const studentId = stringId(mark.student);
    const assessmentId = stringId(mark.assessment);
    if (!enrolledStudentIds.has(studentId) || !sourceAssessmentById.has(assessmentId)) return;
    marksByStudentAssessment.set(`${studentId}__${assessmentId}`, mark);
  });

  const normalContinuous = buildContinuousAssessmentData({
    course: course || {},
    students,
    assessments,
    markDocs,
    attendanceSummaries,
  });
  const normalContinuousByStudent = new Map(
    (normalContinuous?.students || []).map((row) => [String(row.studentId), row])
  );

  const manualByStudent = new Map();
  (manualDocs || []).forEach((row) => {
    const studentId = stringId(row.student);
    if (!enrolledStudentIds.has(studentId)) return;
    const attendanceRaw = row.attendanceObtainedMarks;
    manualByStudent.set(studentId, {
      entries: new Map(
        (row.entries || []).map((entry) => [String(entry.clpKey), Number(entry.obtainedMarks || 0)])
      ),
      attendanceObtainedMarks:
        attendanceRaw === null || attendanceRaw === undefined
          ? null
          : clamp(Number(attendanceRaw), 0, 5),
    });
  });

  const normalizedItems = (config?.items || [])
    .map((item, index) => {
      const legacySourceId = stringId(item.sourceAssessment);
      const requestedSourceIds = uniqueStrings([
        ...(Array.isArray(item.sourceAssessments) ? item.sourceAssessments : []),
        legacySourceId,
      ]);
      const selectedSources = requestedSourceIds
        .map((id) => sourceAssessmentById.get(id))
        .filter(Boolean);
      const sourceIds = selectedSources.map((source) => stringId(source));
      const sourceFullMarks = round2(
        selectedSources.reduce((sum, source) => sum + Number(source.fullMarks || 0), 0)
      );

      return {
        key: String(item.key || `clp${index + 1}`).trim(),
        label: String(item.label || `CLP${index + 1}`).trim(),
        marks: round2(item.marks),
        coCode: String(item.coCode || '').trim().toUpperCase(),
        sourceAssessment: sourceIds[0] || '',
        sourceAssessments: sourceIds,
        sourceAssessmentName: selectedSources[0]?.name || '',
        sourceAssessmentNames: selectedSources.map((source) => source.name || 'Lab Assessment'),
        sourceFullMarks,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
      };
    })
    .sort((a, b) => a.order - b.order);

  const resolvedStudents = students.map((student) => {
    const manualRow = manualByStudent.get(student.studentId) || {
      entries: new Map(),
      attendanceObtainedMarks: null,
    };
    const manualEntries = manualRow.entries || new Map();
    const normalRow = normalContinuousByStudent.get(student.studentId) || {};
    const normalAttendance = round2(clamp(Number(normalRow.attendance || 0), 0, 5));
    const normalLabEvaluation = round2(clamp(Number(normalRow.labEvaluation || 0), 0, 25));
    const hasAttendanceOverride = manualRow.attendanceObtainedMarks !== null;
    const attendance = hasAttendanceOverride
      ? round2(clamp(manualRow.attendanceObtainedMarks, 0, 5))
      : normalAttendance;

    const values = {};
    const autoValues = {};
    const modes = {};
    const sourceValues = {};
    let total = 0;

    normalizedItems.forEach((item) => {
      const selectedSources = (item.sourceAssessments || [])
        .map((id) => sourceAssessmentById.get(String(id)))
        .filter(Boolean);

      let autoValue = null;
      let autoMode = selectedSources.length ? 'missing-source-mark' : 'unmapped';
      let sourceObtained = 0;
      let sourceFull = 0;
      const sourceBreakdown = [];

      if (selectedSources.length) {
        let allMarksAvailable = true;
        for (const source of selectedSources) {
          const sourceId = stringId(source);
          const fullMarks = Number(source.fullMarks || 0);
          const mark = marksByStudentAssessment.get(`${student.studentId}__${sourceId}`);
          if (!mark || fullMarks <= 0) {
            allMarksAvailable = false;
            sourceBreakdown.push({
              assessmentId: sourceId,
              assessmentName: source.name || 'Lab Assessment',
              obtainedMarks: null,
              fullMarks: round2(fullMarks),
            });
            continue;
          }

          const markStatus = lower(mark.status || 'present');
          const obtained = ['absent', 'incomplete'].includes(markStatus)
            ? 0
            : clamp(Number(mark.obtainedMarks || 0), 0, fullMarks);
          sourceObtained += obtained;
          sourceFull += fullMarks;
          sourceBreakdown.push({
            assessmentId: sourceId,
            assessmentName: source.name || 'Lab Assessment',
            obtainedMarks: round2(obtained),
            fullMarks: round2(fullMarks),
          });
        }

        if (allMarksAvailable && sourceFull > 0) {
          // One or many source assessments are normalized to the CLP's assigned
          // mark. Example: (Report-1 + Report-2 obtained) / (2.5 + 2.5) * 5.
          autoValue = round2((sourceObtained / sourceFull) * Number(item.marks || 0));
          autoMode = 'mapped';
        }
      }

      autoValues[item.key] = autoValue;
      sourceValues[item.key] = {
        obtainedMarks: round2(sourceObtained),
        fullMarks: round2(sourceFull),
        assessments: sourceBreakdown,
      };

      if (manualEntries.has(item.key)) {
        const value = clamp(Number(manualEntries.get(item.key) || 0), 0, Number(item.marks || 0));
        values[item.key] = round2(value);
        modes[item.key] = 'manual';
        total += value;
        return;
      }

      values[item.key] = autoValue;
      modes[item.key] = autoMode;
      if (autoValue !== null && autoValue !== undefined) total += Number(autoValue || 0);
    });

    const roundedTotal = round2(total);
    return {
      ...student,
      attendance,
      attendanceMode: hasAttendanceOverride ? 'manual' : 'mapped',
      normalAttendance,
      normalLabEvaluation,
      attendanceMismatch: Math.abs(attendance - normalAttendance) > 1e-9,
      values,
      autoValues,
      modes,
      sourceValues,
      total: roundedTotal,
      continuousTotal: round2(attendance + roundedTotal),
      clpMismatch:
        normalizedItems.length > 0 && Math.abs(roundedTotal - normalLabEvaluation) > 1e-9,
    };
  });

  return {
    enabled: isLabCourse,
    courseType: getCourseType(course || {}),
    attendanceCoCode: String(config?.attendanceCoCode || getDefaultAttendanceCo(courseOutcomes)).trim().toUpperCase(),
    items: normalizedItems,
    totalMarks: round2(normalizedItems.reduce((sum, item) => sum + Number(item.marks || 0), 0)),
    students: resolvedStudents,
    sourceAssessments: sourceAssessments.map((assessment) => ({
      id: stringId(assessment),
      name: assessment.name || 'Lab Assessment',
      fullMarks: Number(assessment.fullMarks || 0),
      order: Number(assessment.order || 0),
    })),
    courseOutcomes: (courseOutcomes || []).map((row) => ({
      code: String(row.code || '').trim().toUpperCase(),
      statement: row.statement || '',
    })),
  };
};

module.exports = {
  round2,
  getCourseType,
  isClpSourceAssessment,
  getDefaultAttendanceCo,
  buildLabClpData,
};
