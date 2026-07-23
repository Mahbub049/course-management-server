const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const clamp = (value, min, max) => {
  const numeric = Number(value || 0);
  return Math.max(min, Math.min(max, numeric));
};

const roundPolicyTotal = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  // Keep this identical to the normal marksheet's displayed policy:
  // values are rounded upward to the nearest 0.5 mark.
  return Math.ceil((numeric - 1e-9) * 2) / 2;
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

const isRegularLabAssessment = (assessment = {}) => {
  const name = lower(assessment.name);

  return (
    assessment.structureType !== 'lab_final' &&
    assessment.structureType !== 'lab_submission' &&
    !name.includes('mid') &&
    !name.includes('final') &&
    !name.includes('att')
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

const getAttendanceContribution = ({
  studentId,
  studentMarks,
  attendanceByStudent,
  attendanceAssessment,
}) => {
  const attendanceSummary = attendanceByStudent.get(studentId);
  if (attendanceSummary && Number.isFinite(Number(attendanceSummary.marks))) {
    return clamp(Number(attendanceSummary.marks), 0, 5);
  }

  if (attendanceAssessment) {
    const mark = studentMarks.get(stringId(attendanceAssessment));
    return percentageForMark(mark, attendanceAssessment) * 5;
  }

  return 0;
};

const getLabEvaluationContribution = ({ studentMarks, labAssessments }) => {
  const totalFullMarks = labAssessments.reduce(
    (sum, assessment) => sum + Number(assessment.fullMarks || 0),
    0
  );

  if (totalFullMarks <= 0) return 0;

  const totalObtainedMarks = labAssessments.reduce((sum, assessment) => {
    const fullMarks = Number(assessment.fullMarks || 0);
    const mark = studentMarks.get(stringId(assessment));

    if (!mark || isIncompleteMark(mark)) return sum;
    return sum + clamp(Number(mark.obtainedMarks || 0), 0, fullMarks);
  }, 0);

  return roundPolicyTotal((totalObtainedMarks / totalFullMarks) * 25);
};

const buildContinuousAssessmentData = ({
  course = {},
  students = [],
  assessments = [],
  markDocs = [],
  attendanceSummaries = [],
} = {}) => {
  const courseType = getCourseType(course);
  const isLabCourse = courseType === 'lab';

  const headers = isLabCourse
    ? [
        {
          key: 'attendance',
          label: 'AT',
          assessmentName: 'Attendance',
          maxMarks: 5,
        },
        {
          key: 'labEvaluation',
          label: 'Lab E',
          assessmentName: 'Lab Evaluation',
          maxMarks: 25,
        },
      ]
    : [
        {
          key: 'attendance',
          label: 'AT',
          assessmentName: 'Attendance',
          maxMarks: 5,
        },
        {
          key: 'ct',
          label: 'CT',
          assessmentName: 'Class Test',
          maxMarks: 15,
        },
        {
          key: 'assignment',
          label: 'ASM',
          assessmentName: 'Assignment',
          maxMarks: 10,
        },
      ];

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

  const attendanceAssessment = assessmentList.find((assessment) =>
    lower(assessment.name).includes('attendance') || lower(assessment.name).includes('att')
  );

  const labAssessments = isLabCourse
    ? assessmentList.filter(isRegularLabAssessment)
    : [];

  const ctAssessments = !isLabCourse
    ? assessmentList.filter((assessment) => isCtAssessment(assessment.name))
    : [];
  const assignmentAssessment = !isLabCourse
    ? assessmentList.find((assessment) =>
        lower(assessment.name).includes('assignment') || lower(assessment.name).includes('assign')
      )
    : null;
  const presentationAssessment = !isLabCourse
    ? assessmentList.find((assessment) =>
        lower(assessment.name).includes('presentation') || lower(assessment.name).includes('present')
      )
    : null;

  const rows = (Array.isArray(students) ? students : []).map((student) => {
    const studentId = stringId(student.studentId || student.student || student);
    const studentMarks = marksByStudent.get(studentId) || new Map();

    const attendance = getAttendanceContribution({
      studentId,
      studentMarks,
      attendanceByStudent,
      attendanceAssessment,
    });

    if (isLabCourse) {
      const labEvaluation = getLabEvaluationContribution({
        studentMarks,
        labAssessments,
      });

      const normalized = {
        studentId,
        attendance: round2(attendance),
        labEvaluation: round2(labEvaluation),
      };

      return {
        ...normalized,
        total: round2(normalized.attendance + normalized.labEvaluation),
      };
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
    courseType,
    headers,
    totalMarks: 30,
    students: rows,
  };
};

module.exports = {
  buildContinuousAssessmentData,
};
