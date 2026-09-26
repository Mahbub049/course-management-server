const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const CourseOutcome = require('../models/CourseOutcome');
const CourseObeConfig = require('../models/CourseObeConfig');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');
const ObeStudentMark = require('../models/ObeStudentMark');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');
const AttendanceSummary = require('../models/AttendanceSummary');
const { buildContinuousAssessmentData } = require('./obeContinuousAssessment');
const { buildLabClpData } = require('./obeClp');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

const getCourseType = (course = {}) => {
  const type = String(course.courseType || course.type || '').trim().toLowerCase();
  if (type === 'hybrid') return 'hybrid';
  if (type.includes('lab')) return 'lab';
  return 'theory';
};

const isExamBlueprint = (blueprint = {}) =>
  ['mid', 'midterm', 'final'].includes(
    String(blueprint.assessmentType || '').trim().toLowerCase()
  );

const findLevel = (percent, levels = []) => {
  const value = Number(percent) || 0;
  const matched = (Array.isArray(levels) ? levels : []).find(
    (row) => value >= Number(row.min) && value <= Number(row.max)
  );
  return matched ? Number(matched.level) : 0;
};

const gradeFromPercent = (percent) => {
  const p = Number(percent) || 0;
  if (p >= 80) return 'A+';
  if (p >= 75) return 'A';
  if (p >= 70) return 'A-';
  if (p >= 65) return 'B+';
  if (p >= 60) return 'B';
  if (p >= 55) return 'B-';
  if (p >= 50) return 'C+';
  if (p >= 45) return 'C';
  if (p >= 40) return 'D';
  return 'F';
};

const buildOutputData = async (courseId) => {
  const [
    course,
    enrollments,
    courseOutcomes,
    config,
    blueprints,
    markDocs,
    assessments,
    regularMarkDocs,
    attendanceSummaries,
  ] = await Promise.all([
    Course.findById(courseId),
    Enrollment.find({ course: courseId }).populate('student'),
    CourseOutcome.find({ course: courseId, isActive: { $ne: false } }).sort({ order: 1, code: 1 }),
    CourseObeConfig.findOne({ course: courseId }),
    ObeAssessmentBlueprint.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
    ObeStudentMark.find({ course: courseId }),
    Assessment.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
    Mark.find({ course: courseId }),
    AttendanceSummary.find({ course: courseId }),
  ]);

  const thresholdPercent = Number(config?.thresholdPercent ?? 40);
  const attainmentLevels = config?.attainmentLevels || [];
  const mappings = config?.mappings || [];
  const poStatements = config?.poStatements || [];
  const psoStatements = config?.psoStatements || [];

  const students = enrollments
    .filter((enr) => enr.student?._id)
    .map((enr) => ({
      studentId: String(enr.student._id),
      roll: enr.student.username || '',
      name: enr.student.name || '',
      email: enr.student.email || null,
    }));

  const enrolledStudentIds = new Set(students.map((student) => student.studentId));
  const activeObeMarkDocs = markDocs.filter((doc) =>
    enrolledStudentIds.has(String(doc.student))
  );
  const activeRegularMarkDocs = regularMarkDocs.filter((doc) =>
    enrolledStudentIds.has(String(doc.student))
  );
  const activeAttendanceSummaries = attendanceSummaries.filter((row) =>
    enrolledStudentIds.has(String(row.student))
  );

  const marksheetContinuousAssessment = buildContinuousAssessmentData({
    course: course || {},
    students,
    assessments,
    markDocs: activeRegularMarkDocs,
    attendanceSummaries: activeAttendanceSummaries,
  });
  const marksheetContinuousByStudent = new Map(
    (marksheetContinuousAssessment.students || []).map((row) => [String(row.studentId), row])
  );

  const isLabCourse = getCourseType(course || {}) === 'lab';
  const labClp = isLabCourse ? await buildLabClpData(courseId) : null;
  const calculationBlueprints = isLabCourse
    ? blueprints.filter(isExamBlueprint)
    : blueprints;

  const outcomeList = courseOutcomes.map((co) => ({
    code: co.code,
    statement: co.statement,
    maxMarks: 0,
  }));
  const outcomeByCode = new Map(outcomeList.map((co) => [co.code, co]));

  let obeTotalPossibleMarks = 0;
  for (const bp of calculationBlueprints) {
    obeTotalPossibleMarks += Number(bp.totalMarks || 0);
    for (const item of bp.items || []) {
      const bucket = outcomeByCode.get(item.coCode);
      if (bucket) bucket.maxMarks = round2(bucket.maxMarks + Number(item.marks || 0));
    }
  }

  let labContinuousMaxMarks = 0;
  let labAttendanceCoCode = '';
  let labClpItems = [];
  if (isLabCourse) {
    const availableCoCodes = new Set(outcomeList.map((row) => row.code));
    labAttendanceCoCode = String(labClp?.attendanceCoCode || '').trim().toUpperCase();
    if (!availableCoCodes.has(labAttendanceCoCode)) {
      labAttendanceCoCode = availableCoCodes.has('CO3') ? 'CO3' : outcomeList[0]?.code || '';
    }
    if (labAttendanceCoCode && outcomeByCode.has(labAttendanceCoCode)) {
      outcomeByCode.get(labAttendanceCoCode).maxMarks = round2(
        outcomeByCode.get(labAttendanceCoCode).maxMarks + 5
      );
      labContinuousMaxMarks += 5;
    }

    labClpItems = Array.isArray(labClp?.items) && labClp.items.length
      ? labClp.items
      : [{
          key: 'clp_total',
          label: 'CLP',
          marks: 25,
          coCode: outcomeList.find((row) => row.code === 'CO1')?.code || outcomeList[0]?.code || '',
          sourceAssessment: '',
          order: 0,
          isAggregateFallback: true,
        }];

    for (const item of labClpItems) {
      const bucket = outcomeByCode.get(String(item.coCode || '').trim().toUpperCase());
      if (bucket) bucket.maxMarks = round2(bucket.maxMarks + Number(item.marks || 0));
      labContinuousMaxMarks += Number(item.marks || 0);
    }
  }

  const totalPossibleMarks = round2(
    (isLabCourse ? labContinuousMaxMarks : 0) +
      calculationBlueprints.reduce((sum, bp) => sum + Number(bp.totalMarks || 0), 0)
  );

  const markMap = new Map();
  for (const doc of activeObeMarkDocs) {
    const key = `${String(doc.student)}__${String(doc.blueprint)}`;
    markMap.set(key, doc);
  }

  const labClpStudentMap = new Map(
    (labClp?.students || []).map((row) => [String(row.studentId), row])
  );

  const labClpGroups = isLabCourse
    ? labClpItems.reduce((groups, item) => {
        const coCode = String(item.coCode || '').trim().toUpperCase();
        const key = coCode || 'UNMAPPED';
        if (!groups.has(key)) {
          groups.set(key, {
            key: `clp_${key.toLowerCase()}`,
            label: 'CLP',
            assessmentName: `CLP ${key}`,
            maxMarks: 0,
            coCode,
            itemKeys: [],
          });
        }
        const group = groups.get(key);
        group.maxMarks = round2(group.maxMarks + Number(item.marks || 0));
        group.itemKeys.push(item.key);
        return groups;
      }, new Map())
    : new Map();

  const labContinuousHeaders = isLabCourse
    ? [
        {
          key: 'attendance',
          label: 'AT',
          assessmentName: 'Attendance',
          maxMarks: 5,
          coCode: labAttendanceCoCode,
        },
        ...Array.from(labClpGroups.values()),
      ]
    : [];

  const studentRows = students.map((student) => {
    const totalsByCo = Object.fromEntries(outcomeList.map((co) => [co.code, 0]));
    const assessmentTotals = [];
    let courseObtained = 0;
    let studentContinuousAssessment = null;

    if (isLabCourse) {
      const marksheetRow = marksheetContinuousByStudent.get(student.studentId) || {};
      const clpRow = labClpStudentMap.get(student.studentId) || {
        values: {},
        total: 0,
        attendance: null,
      };
      const attendance = round2(
        clpRow.attendance === null || clpRow.attendance === undefined
          ? Number(marksheetRow.attendance || 0)
          : Number(clpRow.attendance || 0)
      );
      if (totalsByCo[labAttendanceCoCode] !== undefined) {
        totalsByCo[labAttendanceCoCode] = round2(totalsByCo[labAttendanceCoCode] + attendance);
      }

      const resolvedClpValues = {};
      let clpTotal = 0;
      for (const item of labClpItems) {
        const value = item.isAggregateFallback
          ? round2(Number(marksheetRow.labEvaluation || 0))
          : round2(Number(clpRow.values?.[item.key] ?? 0));
        resolvedClpValues[item.key] = value;
        clpTotal = round2(clpTotal + value);
        const coCode = String(item.coCode || '').trim().toUpperCase();
        if (totalsByCo[coCode] !== undefined) {
          totalsByCo[coCode] = round2(totalsByCo[coCode] + value);
        }
      }

      studentContinuousAssessment = { attendance };
      for (const group of labClpGroups.values()) {
        const value = round2(
          group.itemKeys.reduce((sum, key) => sum + Number(resolvedClpValues[key] || 0), 0)
        );
        studentContinuousAssessment[group.key] = value;
      }
      studentContinuousAssessment.total = round2(attendance + clpTotal);
      courseObtained = studentContinuousAssessment.total;
      assessmentTotals.push(
        { blueprintId: 'continuous-attendance', assessmentName: 'Attendance', totalMarks: attendance, maxMarks: 5 },
        { blueprintId: 'continuous-clp', assessmentName: 'CLP', totalMarks: clpTotal, maxMarks: round2(labContinuousMaxMarks - 5) }
      );
    }

    for (const bp of calculationBlueprints) {
      const saved = markMap.get(`${student.studentId}__${String(bp._id)}`);
      const entryMap = new Map((saved?.entries || []).map((entry) => [entry.itemKey, Number(entry.obtainedMarks || 0)]));
      let blueprintTotal = 0;

      for (const item of bp.items || []) {
        const obtained = Number(entryMap.get(item.key) || 0);
        blueprintTotal += obtained;
        if (totalsByCo[item.coCode] !== undefined) {
          totalsByCo[item.coCode] = round2(totalsByCo[item.coCode] + obtained);
        }
      }

      blueprintTotal = round2(blueprintTotal);
      courseObtained = round2(courseObtained + blueprintTotal);
      assessmentTotals.push({
        blueprintId: String(bp._id),
        assessmentName: bp.assessmentName,
        totalMarks: blueprintTotal,
        maxMarks: Number(bp.totalMarks || 0),
      });
    }

    const totalPercent = totalPossibleMarks > 0 ? round2((courseObtained / totalPossibleMarks) * 100) : 0;
    const scaledTotal = round2((totalPercent / 100) * 100);
    const grade = gradeFromPercent(totalPercent);

    const coRows = outcomeList.map((co) => {
      const obtained = round2(totalsByCo[co.code] || 0);
      const percent = co.maxMarks > 0 ? round2((obtained / co.maxMarks) * 100) : 0;
      const achieved = percent >= thresholdPercent;
      return {
        code: co.code,
        statement: co.statement,
        obtainedMarks: obtained,
        maxMarks: co.maxMarks,
        percent,
        achieved,
      };
    });

    return {
      studentId: student.studentId,
      roll: student.roll,
      name: student.name,
      email: student.email,
      courseObtained,
      courseMaxMarks: round2(totalPossibleMarks),
      continuousAssessment: isLabCourse ? studentContinuousAssessment : null,
      totalPercent,
      scaledTotal,
      grade,
      assessmentTotals,
      coRows,
    };
  });

  const totalStudents = studentRows.length;
  const coAttainment = outcomeList.map((co) => {
    const thresholdMarks = round2((Number(co.maxMarks || 0) * thresholdPercent) / 100);
    let attainedCount = 0;
    let averagePercent = 0;

    for (const student of studentRows) {
      const row = student.coRows.find((item) => item.code === co.code);
      if (row) {
        averagePercent += Number(row.percent || 0);
        if (row.obtainedMarks >= thresholdMarks) attainedCount += 1;
      }
    }

    averagePercent = totalStudents ? round2(averagePercent / totalStudents) : 0;
    const attainmentPercent = totalStudents ? round2((attainedCount / totalStudents) * 100) : 0;

    return {
      code: co.code,
      statement: co.statement,
      maxMarks: round2(co.maxMarks),
      thresholdMarks,
      attainedCount,
      totalStudents,
      attainmentPercent,
      averagePercent,
      level: findLevel(attainmentPercent, attainmentLevels),
    };
  });

  const coAttainmentByCode = new Map(coAttainment.map((row) => [row.code, row]));

  const buildTargetRows = (items, targetType) => {
    return (items || []).map((target) => {
      const related = mappings.filter(
        (mapping) => mapping.targetType === targetType && mapping.targetCode === target.code
      );

      let weightedSum = 0;
      let totalWeight = 0;
      for (const mapping of related) {
        const coRow = coAttainmentByCode.get(mapping.coCode);
        if (!coRow) continue;
        weightedSum += Number(coRow.attainmentPercent || 0) * Number(mapping.strength || 0);
        totalWeight += Number(mapping.strength || 0);
      }

      const attainmentPercent = totalWeight > 0 ? round2(weightedSum / totalWeight) : 0;
      return {
        code: target.code,
        statement: target.statement,
        attainmentPercent,
        level: findLevel(attainmentPercent, attainmentLevels),
        totalWeight,
        mappings: related,
      };
    });
  };

  const poAttainment = buildTargetRows(poStatements, 'PO');
  const psoAttainment = buildTargetRows(psoStatements, 'PSO');

  const gradeBuckets = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];
  const gradeDistribution = gradeBuckets.map((grade) => ({ grade, count: 0, percent: 0 }));
  const gradeMap = new Map(gradeDistribution.map((row) => [row.grade, row]));
  for (const student of studentRows) {
    if (gradeMap.has(student.grade)) {
      gradeMap.get(student.grade).count += 1;
    }
  }
  for (const row of gradeDistribution) {
    row.percent = totalStudents ? round2((row.count / totalStudents) * 100) : 0;
  }

  return {
    thresholdPercent,
    totalStudents,
    totalPossibleMarks: round2(totalPossibleMarks),
    obeTotalPossibleMarks: round2(obeTotalPossibleMarks),
    continuousAssessment: isLabCourse
      ? {
          enabled: true,
          source: labClp?.items?.length ? 'clp-mapping' : 'course-marks',
          courseType: 'lab',
          headers: labContinuousHeaders,
          totalMarks: round2(labContinuousMaxMarks),
          students: studentRows.map((row) => ({
            studentId: row.studentId,
            ...(row.continuousAssessment || {}),
          })),
        }
      : null,
    labClp: isLabCourse
      ? {
          ...(labClp || {}),
          items: labClpItems,
        }
      : null,
    blueprints: calculationBlueprints,
    students: studentRows,
    coAttainment,
    poAttainment,
    psoAttainment,
    gradeDistribution,
    attainmentLevels,
    notes: config?.notes || '',
  };
};

module.exports = {
  round2,
  round4,
  gradeFromPercent,
  findLevel,
  buildOutputData,
};
