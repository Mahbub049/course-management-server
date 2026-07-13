const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const clamp = (value, min, max) => {
  const numeric = Number(value || 0);
  return Math.max(min, Math.min(max, numeric));
};

const lower = (value) => String(value || '').trim().toLowerCase();
const stringId = (value) => String(value?._id || value?.id || value || '');

const getCourseType = (course = {}) => {
  const type = lower(course.courseType || course.type);
  if (type === 'hybrid') return 'hybrid';
  if (type.includes('lab')) return 'lab';
  return 'theory';
};

const isIncompleteMark = (mark) => {
  const status = lower(mark?.status || 'present');
  return status === 'absent' || status === 'incomplete';
};

const isCtAssessment = (nameRaw) => {
  const name = lower(nameRaw);

  if (name.includes('mid') || name.includes('final') || name.includes('att')) return false;
  if (name.includes('assign') || name.includes('present')) return false;

  const compact = name.replace(/[\s\-_]+/g, '');
  return (
    compact.startsWith('ct') ||
    compact.includes('classtest') ||
    name.includes('class test') ||
    name.includes('quiz') ||
    name.includes('test')
  );
};

const normalizeCtPolicy = (course = {}) => {
  const raw = course.classTestPolicy || {};
  return {
    mode: raw.mode || 'best_n_average_scaled',
    bestCount:
      Number(raw.bestCount) > 0
        ? Number(raw.bestCount)
        : raw.mode === 'best_one_scaled'
          ? 1
          : 2,
    manualSelectedAssessmentIds: Array.isArray(raw.manualSelectedAssessmentIds)
      ? raw.manualSelectedAssessmentIds.map(String)
      : [],
  };
};

const computeCtContribution = (course, entries = [], targetWeight = 15) => {
  const policy = normalizeCtPolicy(course);
  const weight = Number(targetWeight || 0);

  if (!entries.length || weight <= 0) return 0;

  if (policy.mode === 'manual_average_scaled') {
    const selected = entries.filter((entry) =>
      policy.manualSelectedAssessmentIds.includes(entry.id)
    );
    if (!selected.length) return 0;

    const average = selected.reduce((sum, entry) => sum + entry.percent, 0) / selected.length;
    return round2(average * weight);
  }

  const sorted = [...entries].sort((a, b) => b.percent - a.percent);

  if (policy.mode === 'best_one_scaled') {
    return round2((sorted[0]?.percent || 0) * weight);
  }

  const bestCount = Math.max(1, Number(policy.bestCount || 2));
  const selected = sorted.slice(0, bestCount);
  if (!selected.length) return 0;

  if (policy.mode === 'best_n_individual_scaled') {
    const eachWeight = weight / selected.length;
    return round2(
      selected.reduce((sum, entry) => sum + entry.percent * eachWeight, 0)
    );
  }

  const average = selected.reduce((sum, entry) => sum + entry.percent, 0) / selected.length;
  return round2(average * weight);
};

const percentageForMark = (mark, assessment) => {
  if (!mark || !assessment || isIncompleteMark(mark)) return 0;

  const fullMarks = Number(assessment.fullMarks || 0);
  if (fullMarks <= 0) return 0;

  return clamp(Number(mark.obtainedMarks || 0), 0, fullMarks) / fullMarks;
};

const buildContinuousAssessmentData = ({
  course = {},
  students = [],
  assessments = [],
  markDocs = [],
  attendanceSummaries = [],
} = {}) => {
  const courseType = getCourseType(course);

  // The supplied official OBE workbook uses AT 5 + CT 15 + ASM 10.
  // Lab-only courses have a different continuous-assessment structure, so they
  // continue to use explicitly configured OBE blueprints.
  const enabled = courseType !== 'lab';

  const headers = [
    { key: 'attendance', label: 'AT', maxMarks: 5 },
    { key: 'ct', label: 'CT', maxMarks: 15 },
    { key: 'assignment', label: 'ASM', maxMarks: 10 },
  ];

  if (!enabled) {
    return {
      enabled: false,
      source: 'obe-blueprints',
      headers,
      totalMarks: 30,
      students: [],
    };
  }

  const assessmentList = (Array.isArray(assessments) ? assessments : []).filter(
    (assessment) => assessment?.structureType !== 'lab_submission'
  );

  const assessmentById = new Map(
    assessmentList.map((assessment) => [stringId(assessment), assessment])
  );

  const marksByStudent = new Map();
  (Array.isArray(markDocs) ? markDocs : []).forEach((mark) => {
    const studentId = stringId(mark.student);
    const assessmentId = stringId(mark.assessment);
    if (!studentId || !assessmentId || !assessmentById.has(assessmentId)) return;

    if (!marksByStudent.has(studentId)) marksByStudent.set(studentId, new Map());
    marksByStudent.get(studentId).set(assessmentId, mark);
  });

  const attendanceByStudent = new Map();
  (Array.isArray(attendanceSummaries) ? attendanceSummaries : []).forEach((row) => {
    const studentId = stringId(row.student);
    if (studentId) attendanceByStudent.set(studentId, row);
  });

  const ctAssessments = assessmentList.filter((assessment) =>
    isCtAssessment(assessment.name)
  );
  const attendanceAssessment = assessmentList.find((assessment) =>
    lower(assessment.name).includes('attendance') || lower(assessment.name).includes('att')
  );
  const assignmentAssessment = assessmentList.find((assessment) =>
    lower(assessment.name).includes('assignment') || lower(assessment.name).includes('assign')
  );
  const presentationAssessment = assessmentList.find((assessment) =>
    lower(assessment.name).includes('presentation') || lower(assessment.name).includes('present')
  );

  const rows = (Array.isArray(students) ? students : []).map((student) => {
    const studentId = stringId(student.studentId || student.student || student);
    const studentMarks = marksByStudent.get(studentId) || new Map();

    let attendance = 0;
    const attendanceSummary = attendanceByStudent.get(studentId);
    if (attendanceSummary && Number.isFinite(Number(attendanceSummary.marks))) {
      attendance = clamp(Number(attendanceSummary.marks), 0, 5);
    } else if (attendanceAssessment) {
      const mark = studentMarks.get(stringId(attendanceAssessment));
      attendance = percentageForMark(mark, attendanceAssessment) * 5;
    }

    const ctEntries = ctAssessments.map((assessment) => ({
      id: stringId(assessment),
      percent: percentageForMark(
        studentMarks.get(stringId(assessment)),
        assessment
      ),
    }));
    const ct = computeCtContribution(course, ctEntries, 15);

    let assignment = 0;
    if (assignmentAssessment && presentationAssessment) {
      assignment =
        percentageForMark(
          studentMarks.get(stringId(assignmentAssessment)),
          assignmentAssessment
        ) *
          5 +
        percentageForMark(
          studentMarks.get(stringId(presentationAssessment)),
          presentationAssessment
        ) *
          5;
    } else if (assignmentAssessment) {
      assignment =
        percentageForMark(
          studentMarks.get(stringId(assignmentAssessment)),
          assignmentAssessment
        ) * 10;
    } else if (presentationAssessment) {
      assignment =
        percentageForMark(
          studentMarks.get(stringId(presentationAssessment)),
          presentationAssessment
        ) * 10;
    }

    const normalized = {
      studentId,
      attendance: round2(attendance),
      ct: round2(ct),
      assignment: round2(assignment),
    };

    return {
      ...normalized,
      total: round2(
        normalized.attendance + normalized.ct + normalized.assignment
      ),
    };
  });

  return {
    enabled: true,
    source: 'course-marks',
    headers,
    totalMarks: 30,
    students: rows,
  };
};

module.exports = {
  buildContinuousAssessmentData,
};
