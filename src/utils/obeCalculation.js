const Enrollment = require('../models/Enrollment');
const CourseOutcome = require('../models/CourseOutcome');
const CourseObeConfig = require('../models/CourseObeConfig');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');
const ObeStudentMark = require('../models/ObeStudentMark');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

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
  const [enrollments, courseOutcomes, config, blueprints, markDocs] = await Promise.all([
    Enrollment.find({ course: courseId }).populate('student'),
    CourseOutcome.find({ course: courseId, isActive: { $ne: false } }).sort({ order: 1, code: 1 }),
    CourseObeConfig.findOne({ course: courseId }),
    ObeAssessmentBlueprint.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
    ObeStudentMark.find({ course: courseId }),
  ]);

  const thresholdPercent = Number(config?.thresholdPercent ?? 40);
  const attainmentLevels = config?.attainmentLevels || [];
  const mappings = config?.mappings || [];
  const poStatements = config?.poStatements || [];
  const psoStatements = config?.psoStatements || [];

  const students = enrollments.map((enr) => ({
    studentId: String(enr.student?._id || ''),
    roll: enr.student?.username || '',
    name: enr.student?.name || '',
    email: enr.student?.email || null,
  }));

  const blueprintById = new Map(blueprints.map((bp) => [String(bp._id), bp]));
  const outcomeList = courseOutcomes.map((co) => ({
    code: co.code,
    statement: co.statement,
    maxMarks: 0,
  }));
  const outcomeByCode = new Map(outcomeList.map((co) => [co.code, co]));

  let totalPossibleMarks = 0;
  for (const bp of blueprints) {
    totalPossibleMarks += Number(bp.totalMarks || 0);
    for (const item of bp.items || []) {
      const bucket = outcomeByCode.get(item.coCode);
      if (bucket) bucket.maxMarks = round2(bucket.maxMarks + Number(item.marks || 0));
    }
  }

  const markMap = new Map();
  for (const doc of markDocs) {
    const key = `${String(doc.student)}__${String(doc.blueprint)}`;
    markMap.set(key, doc);
  }

  const studentRows = students.map((student) => {
    const totalsByCo = Object.fromEntries(outcomeList.map((co) => [co.code, 0]));
    let courseObtained = 0;
    const assessmentTotals = [];

    for (const bp of blueprints) {
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
    blueprints,
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
