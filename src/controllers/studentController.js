const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');
const CourseMaterial = require('../models/CourseMaterial');
const LabSubmission = require('../models/LabSubmission');

// ---------- Helpers ----------

const getCourseType = (course) => {
  return (course?.courseType || 'theory').toLowerCase();
};

const lower = (str) => (str || '').toLowerCase();

const GRADE_THRESHOLDS = [
  { grade: 'A+', min: 80 },
  { grade: 'A', min: 75 },
  { grade: 'A-', min: 70 },
  { grade: 'B+', min: 65 },
  { grade: 'B', min: 60 },
  { grade: 'B-', min: 55 },
  { grade: 'C+', min: 50 },
  { grade: 'C', min: 45 },
  { grade: 'D', min: 40 },
];

const getGradeFromTotal = (total) => {
  const score = Number(total || 0);

  for (const g of GRADE_THRESHOLDS) {
    if (score >= g.min) return g.grade;
  }

  return 'F';
};

const isFinalAssessment = (assessment) => {
  const name = lower(assessment?.name);
  return assessment?.structureType === "lab_final" || name.includes("final");
};

const isIncompleteMark = (markDoc) => {
  const status = String(markDoc?.status || "present").toLowerCase();
  return status === "absent" || status === "incomplete";
};

const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

const roundPolicyTotal = (total) => {
  const n = Number(total || 0);

  if (!Number.isFinite(n) || n <= 0) return 0;

  return Math.ceil((n - 1e-9) * 2) / 2;
};

const formatComplaintSettings = (course) => ({
  allowStudentComplaints:
    course?.complaintSettings?.allowStudentComplaints !== false,
  closedMessage:
    course?.complaintSettings?.closedMessage ||
    "Complaint submission is currently closed by the course teacher.",
  updatedAt: course?.complaintSettings?.updatedAt || null,
});

const normalizeCtPolicy = (course) => {
  const raw = course?.classTestPolicy || {};

  return {
    mode: raw.mode || 'best_n_average_scaled',
    bestCount:
      Number(raw.bestCount) > 0
        ? Number(raw.bestCount)
        : raw.mode === 'best_one_scaled'
          ? 1
          : 2,
    totalWeight:
      Number(raw.totalWeight) >= 0 ? Number(raw.totalWeight) : 15,
    manualSelectedAssessmentIds: Array.isArray(raw.manualSelectedAssessmentIds)
      ? raw.manualSelectedAssessmentIds.map(String)
      : [],
  };
};

const isCtAssessment = (nameRaw) => {
  const n = String(nameRaw || '').toLowerCase().trim();

  if (n.includes('mid') || n.includes('final') || n.includes('att')) return false;
  if (n.includes('assign') || n.includes('pres')) return false;

  const compact = n.replace(/[\s\-_]+/g, '');

  if (compact.startsWith('ct')) return true;
  if (compact.includes('classtest')) return true;
  if (n.includes('class test')) return true;
  if (n.includes('quiz')) return true;
  if (n.includes('test')) return true;

  return false;
};

const isRegularLabAssessment = (assessment) => {
  const name = lower(assessment?.name);

  return (
    assessment?.structureType !== 'lab_final' &&
    assessment?.structureType !== 'lab_submission' &&
    !name.includes('mid') &&
    !name.includes('final') &&
    !name.includes('att') &&
    !name.includes('attendance')
  );
};

const computeCtContributionByPolicy = (course, entries) => {
  const policy = normalizeCtPolicy(course);
  const totalWeight = Number(policy.totalWeight || 15);

  if (!entries.length || totalWeight <= 0) return 0;

  if (policy.mode === 'manual_average_scaled') {
    const selected = entries.filter((e) =>
      policy.manualSelectedAssessmentIds.includes(e.id)
    );

    if (!selected.length) return 0;

    const avg =
      selected.reduce((sum, item) => sum + item.pct, 0) / selected.length;

    return avg * totalWeight;
  }

  const sorted = [...entries].sort((a, b) => b.pct - a.pct);

  if (policy.mode === 'best_one_scaled') {
    return (sorted[0]?.pct || 0) * totalWeight;
  }

  const count = Math.max(1, Number(policy.bestCount || 2));
  const chosen = sorted.slice(0, count);

  if (!chosen.length) return 0;

  if (policy.mode === 'best_n_individual_scaled') {
    const eachWeight = totalWeight / chosen.length;
    return chosen.reduce((sum, item) => sum + item.pct * eachWeight, 0);
  }

  const avg =
    chosen.reduce((sum, item) => sum + item.pct, 0) / chosen.length;

  return avg * totalWeight;
};

// ---------- Core computation ----------

const findByName = (assessments = [], matcher) => {
  return assessments.find((assessment) => matcher(lower(assessment?.name || '')));
};

const findAttendanceAssessment = (assessments = []) => {
  return findByName(assessments, (name) =>
    name.includes('attendance') || name.includes('att')
  );
};

const findAssignmentAssessment = (assessments = []) => {
  return findByName(assessments, (name) =>
    name.includes('assignment') || name.includes('assign')
  );
};

const findPresentationAssessment = (assessments = []) => {
  return findByName(assessments, (name) =>
    name.includes('presentation') || name.includes('present')
  );
};

const findTheoryMidAssessment = (assessments = []) => {
  return (
    findByName(assessments, (name) => name.includes('theory') && name.includes('mid')) ||
    findByName(assessments, (name) =>
      name.includes('mid') && !name.includes('lab') && !name.includes('final')
    )
  );
};

const findLabMidAssessment = (assessments = []) => {
  return findByName(assessments, (name) => name.includes('lab') && name.includes('mid'));
};

const findTheoryFinalAssessment = (assessments = []) => {
  return (
    findByName(assessments, (name) => name.includes('theory') && name.includes('final')) ||
    findByName(assessments, (name) =>
      name.includes('final') && !name.includes('lab') && !name.includes('mid')
    )
  );
};

const findLabFinalAssessment = (assessments = []) => {
  return findByName(assessments, (name) =>
    name.includes('lab') && name.includes('final') && !name.includes('submission')
  );
};

const getPctFromMarks = (marksByAssessment, assessment) => {
  if (!assessment) return 0;

  const assessmentId = assessment._id.toString();
  const fullMarks = Number(assessment.fullMarks || 0);
  const mark = marksByAssessment[assessmentId];

  if (mark == null || Number.isNaN(Number(mark)) || fullMarks <= 0) return 0;

  return Number(mark) / fullMarks;
};

const getExistingFull = (assessment, targetFullMarks) => {
  return Number(assessment?.fullMarks || 0) > 0 ? Number(targetFullMarks || 0) : 0;
};

const getHybridTheoryPracticeWeight = (course) => {
  const ctWeight = Number(normalizeCtPolicy(course).totalWeight || 0);
  return Math.max(0, 25 - ctWeight);
};

const computeSummaryForStudent = (
  course,
  assessments,
  marksByAssessment,
  markDocsByAssessment = {}
) => {
  const courseType = getCourseType(course);
  const assessmentList = Array.isArray(assessments) ? assessments : [];

  const hasFinalIncomplete = assessmentList.some((assessment) => {
    const assessmentId = assessment._id.toString();
    return (
      isFinalAssessment(assessment) &&
      isIncompleteMark(markDocsByAssessment[assessmentId])
    );
  });

  const getPct = (assessment) => getPctFromMarks(marksByAssessment, assessment);

  const buildFinalSummary = (currentTotal, maxPossible, extra = {}) => {
    const roundedTotal = round2(roundPolicyTotal(currentTotal));
    const grade = hasFinalIncomplete ? 'I' : getGradeFromTotal(roundedTotal);

    const A_PLUS = 80;
    const neededForAPlus =
      hasFinalIncomplete || roundedTotal >= A_PLUS
        ? 0
        : Math.max(0, A_PLUS - roundedTotal);

    return {
      currentTotal: roundedTotal,
      maxPossible: round2(maxPossible),
      grade,
      totalObtained: roundedTotal,
      aPlusNeeded: round2(neededForAPlus),
      aPlusInfo: {
        needed: round2(neededForAPlus),
        maxPossible: round2(maxPossible),
      },
      ...extra,
    };
  };

  // ===== LAB COURSES =====
  if (courseType === 'lab') {
    const regularLabAssessments = assessmentList.filter((a) => {
      const name = lower(a.name);

      return (
        a?.structureType !== 'lab_final' &&
        a?.structureType !== 'lab_submission' &&
        !name.includes('mid') &&
        !name.includes('final') &&
        !name.includes('att') &&
        !name.includes('attendance')
      );
    });

    const midAssessment = findByName(assessmentList, (name) => name.includes('mid'));

    const advancedLabFinal = assessmentList.find(
      (a) => a?.structureType === 'lab_final'
    );

    const regularFinal = assessmentList.find(
      (a) =>
        a?.structureType !== 'lab_final' &&
        lower(a.name).includes('final')
    );

    const finalAssessment = advancedLabFinal || regularFinal;
    const attendanceAssessment = findAttendanceAssessment(assessmentList);

    const getCappedMark = (assessment) => {
      const full = Number(assessment?.fullMarks || 0);
      const mark = marksByAssessment[assessment?._id?.toString?.()];

      if (full <= 0 || mark == null || Number.isNaN(Number(mark))) return 0;

      return Math.max(0, Math.min(Number(mark), full));
    };

    const labTotalFullMarks = regularLabAssessments.reduce(
      (sum, assessment) => sum + Number(assessment.fullMarks || 0),
      0
    );

    const labTotalObtainedMarks = regularLabAssessments.reduce(
      (sum, assessment) => sum + getCappedMark(assessment),
      0
    );

    const labNow =
      labTotalFullMarks > 0
        ? (labTotalObtainedMarks / labTotalFullMarks) * 25
        : 0;

    const labScore25 = roundPolicyTotal(labNow);
    const labFull = labTotalFullMarks > 0 ? 25 : 0;

    const midNow = getPct(midAssessment) * 30;
    const midFull = getExistingFull(midAssessment, 30);

    const finalNow = getPct(finalAssessment) * 40;
    const finalFull = getExistingFull(finalAssessment, 40);

    const attNow = getPct(attendanceAssessment) * 5;
    const attFull = getExistingFull(attendanceAssessment, 5);

    return buildFinalSummary(
      labScore25 + midNow + finalNow + attNow,
      labFull + midFull + finalFull + attFull,
      {
        ctMain: round2(labScore25),
        labMain: round2(labScore25),
      }
    );
  }

  // ===== HYBRID COURSES =====
  if (courseType === 'hybrid') {
    const ctEntriesNow = [];
    const ctEntriesFull = [];

    assessmentList.forEach((assessment) => {
      if (assessment?.structureType === 'lab_submission') return;
      if (!isCtAssessment(assessment?.name)) return;

      const id = assessment._id.toString();
      const full = Number(assessment.fullMarks || 0);

      ctEntriesNow.push({ id, pct: getPct(assessment) });
      ctEntriesFull.push({ id, pct: full > 0 ? 1 : 0 });
    });

    const theoryMidAssessment = findTheoryMidAssessment(assessmentList);
    const labMidAssessment = findLabMidAssessment(assessmentList);
    const theoryFinalAssessment = findTheoryFinalAssessment(assessmentList);
    const labFinalAssessment = findLabFinalAssessment(assessmentList);
    const assignmentAssessment = findAssignmentAssessment(assessmentList);
    const attendanceAssessment = findAttendanceAssessment(assessmentList);

    const ctNow = computeCtContributionByPolicy(course, ctEntriesNow);
    const ctFull = computeCtContributionByPolicy(course, ctEntriesFull);

    const assignmentWeight = getHybridTheoryPracticeWeight(course);

    const theoryMidNow = getPct(theoryMidAssessment) * 20;
    const theoryMidFull = getExistingFull(theoryMidAssessment, 20);

    const labMidNow = getPct(labMidAssessment) * 10;
    const labMidFull = getExistingFull(labMidAssessment, 10);

    const theoryFinalNow = getPct(theoryFinalAssessment) * 30;
    const theoryFinalFull = getExistingFull(theoryFinalAssessment, 30);

    const labFinalNow = getPct(labFinalAssessment) * 10;
    const labFinalFull = getExistingFull(labFinalAssessment, 10);

    const assignmentNow = getPct(assignmentAssessment) * assignmentWeight;
    const assignmentFull = getExistingFull(assignmentAssessment, assignmentWeight);

    const attNow = getPct(attendanceAssessment) * 5;
    const attFull = getExistingFull(attendanceAssessment, 5);

    return buildFinalSummary(
      ctNow +
        theoryMidNow +
        labMidNow +
        theoryFinalNow +
        labFinalNow +
        assignmentNow +
        attNow,
      ctFull +
        theoryMidFull +
        labMidFull +
        theoryFinalFull +
        labFinalFull +
        assignmentFull +
        attFull,
      {
        ctMain: round2(roundPolicyTotal(ctNow)),
        labMain: round2(roundPolicyTotal(labMidNow + labFinalNow)),
        assignmentMain: round2(roundPolicyTotal(assignmentNow)),
      }
    );
  }

  // ===== THEORY COURSES =====
  const ctEntriesNow = [];
  const ctEntriesFull = [];

  let midPctNow = 0;
  let midPctFull = 0;

  let finalPctNow = 0;
  let finalPctFull = 0;

  let attPctNow = 0;
  let attPctFull = 0;

  let assignPctNow = 0;
  let assignPctFull = 0;

  let presPctNow = 0;
  let presPctFull = 0;

  let hasAssignment = false;
  let hasPresentation = false;

  assessmentList.forEach((a) => {
    const id = a._id.toString();
    const name = lower(a.name);
    const full = Number(a.fullMarks || 0);
    const pctNow = getPct(a);
    const hasThis = full > 0;

    if (isCtAssessment(a.name)) {
      ctEntriesNow.push({ id, pct: pctNow });
      ctEntriesFull.push({ id, pct: hasThis ? 1 : 0 });
    } else if (name.includes('mid')) {
      midPctNow = pctNow;
      midPctFull = hasThis ? 1 : 0;
    } else if (name.includes('final')) {
      finalPctNow = pctNow;
      finalPctFull = hasThis ? 1 : 0;
    } else if (name.includes('att')) {
      attPctNow = pctNow;
      attPctFull = hasThis ? 1 : 0;
    } else if (name.includes('assign')) {
      hasAssignment = true;
      assignPctNow = pctNow;
      assignPctFull = hasThis ? 1 : 0;
    } else if (name.includes('pres')) {
      hasPresentation = true;
      presPctNow = pctNow;
      presPctFull = hasThis ? 1 : 0;
    }
  });

  const ctNow = computeCtContributionByPolicy(course, ctEntriesNow);
  const ctFull = computeCtContributionByPolicy(course, ctEntriesFull);

  const midNow = midPctNow * 30;
  const midFull = midPctFull * 30;

  const finalNow = finalPctNow * 40;
  const finalFull = finalPctFull * 40;

  const attNow = attPctNow * 5;
  const attFull = attPctFull * 5;

  let assignPresNow = 0;
  let assignPresFull = 0;

  if (hasAssignment && hasPresentation) {
    assignPresNow = assignPctNow * 5 + presPctNow * 5;
    assignPresFull = assignPctFull * 5 + presPctFull * 5;
  } else if (hasAssignment) {
    assignPresNow = assignPctNow * 10;
    assignPresFull = assignPctFull * 10;
  } else if (hasPresentation) {
    assignPresNow = presPctNow * 10;
    assignPresFull = presPctFull * 10;
  }

  return buildFinalSummary(
    ctNow + midNow + finalNow + attNow + assignPresNow,
    ctFull + midFull + finalFull + attFull + assignPresFull,
    {
      ctMain: round2(roundPolicyTotal(ctNow)),
    }
  );
};

// ---------- Controller functions ----------

// GET /api/student/courses
const getStudentCourses = async (req, res) => {
  try {
    const studentId = req.user.userId;

    const enrollments = await Enrollment.find({ student: studentId }).populate(
      'course'
    );

    const courseDocs = enrollments
      .map((e) => e.course)
      .filter((course) => course && course.archived !== true);

    const courseIds = courseDocs.map((c) => c._id);

    const [assessments, marks, pendingSubmissionAssessments] = await Promise.all([
      Assessment.find({
        course: { $in: courseIds },
        isPublished: true,
        structureType: { $ne: 'lab_submission' },
      }).sort({ order: 1, createdAt: 1 }),
      Mark.find({
        student: studentId,
        course: { $in: courseIds },
      }),
      Assessment.find({
        course: { $in: courseIds },
        isPublished: true,
        structureType: 'lab_submission',
      }).sort({ createdAt: -1, order: 1 }),
    ]);

    const publishedAssessmentIds = new Set(
      assessments.map((a) => a._id.toString())
    );

    const assessmentsByCourse = {};
    for (const a of assessments) {
      const cid = a.course.toString();
      if (!assessmentsByCourse[cid]) assessmentsByCourse[cid] = [];
      assessmentsByCourse[cid].push(a);
    }

    const submissionAssessmentsByCourse = {};
    pendingSubmissionAssessments.forEach((a) => {
      const cid = a.course.toString();
      if (!submissionAssessmentsByCourse[cid]) submissionAssessmentsByCourse[cid] = [];
      submissionAssessmentsByCourse[cid].push(a);
    });

    const marksByCourse = {};
    const marksByAssessmentByCourse = {};
    const markDocsByAssessmentByCourse = {};

    for (const m of marks) {
      const assessmentId = m.assessment.toString();
      if (!publishedAssessmentIds.has(assessmentId)) continue;

      const cid = m.course.toString();

      if (!marksByCourse[cid]) marksByCourse[cid] = [];
      marksByCourse[cid].push(m);

      if (!marksByAssessmentByCourse[cid]) marksByAssessmentByCourse[cid] = {};
      marksByAssessmentByCourse[cid][assessmentId] = Number(m.obtainedMarks || 0);

      if (!markDocsByAssessmentByCourse[cid]) {
        markDocsByAssessmentByCourse[cid] = {};
      }
      markDocsByAssessmentByCourse[cid][assessmentId] = m;
    }

    const submissionDocs = await LabSubmission.find({
      student: studentId,
      assessment: { $in: pendingSubmissionAssessments.map((a) => a._id) },
    });
    const submissionMap = Object.fromEntries(submissionDocs.map((s) => [String(s.assessment), s]));

    const courses = courseDocs.map((course) => {
      const cid = course._id.toString();
      const aList = assessmentsByCourse[cid] || [];
      const mList = marksByCourse[cid] || [];

      const assessmentCount = aList.length;
      const marksCount = mList.length;

      let summaryStatus = 'not_started';
      if (assessmentCount === 0) summaryStatus = 'not_published';
      else if (marksCount === 0) summaryStatus = 'not_published';
      else if (marksCount < assessmentCount) summaryStatus = 'in_progress';
      else summaryStatus = 'published';

      let summary = null;
      if (marksCount > 0) {
        const computed = computeSummaryForStudent(
          course,
          aList,
          marksByAssessmentByCourse[cid] || {},
          markDocsByAssessmentByCourse[cid] || {}
        );

        summary = {
          total: computed.currentTotal,
          ctMain: computed.ctMain,
          labMain: computed.labMain || 0,
          grade: computed.grade,
          maxPossible: computed.maxPossible,
        };
      }

      const submissionAssessments = (submissionAssessmentsByCourse[cid] || []).map((a) => {
        const submission = submissionMap[a._id.toString()];
        return {
          id: a._id.toString(),
          name: a.name,
          dueDate: a.submissionConfig?.dueDate || null,
          maxFileSizeMB: Number(a.submissionConfig?.maxFileSizeMB || 10),
          status: submission ? submission.status : 'not_submitted',
          submittedAt: submission?.submittedAt || null,
        };
      });

      return {
        id: cid,
        code: course.code,
        title: course.title,
        section: course.section,
        semester: course.semester,
        year: course.year,
        courseType: course.courseType,
        classTestPolicy: course.classTestPolicy || {},
        complaintSettings: formatComplaintSettings(course),
        summaryStatus,
        summary,
        pendingSubmissionAssessments: submissionAssessments,
      };
    });

    res.json(courses);
  } catch (err) {
    console.error('getStudentCourses error', err);
    res.status(500).json({ message: 'Server error loading student courses' });
  }
};

// GET /api/student/courses/:courseId
const getStudentCourseDetails = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const enrollment = await Enrollment.findOne({
      student: studentId,
      course: courseId,
    }).populate('course');

    if (!enrollment || !enrollment.course) {
      return res
        .status(404)
        .json({ message: 'Course not found for this student' });
    }

    const course = enrollment.course;

    if (course.archived === true) {
      return res.status(404).json({
        message: 'Course not found for this student',
      });
    }

    const assessments = await Assessment.find({
      course: courseId,
      isPublished: true,
      structureType: { $ne: 'lab_submission' },
    }).sort({
      order: 1,
      createdAt: 1,
    });

    const publishedAssessmentIds = assessments.map((a) => a._id);

    const marks = await Mark.find({
      course: courseId,
      student: studentId,
      assessment: { $in: publishedAssessmentIds },
    });

    const marksByAssessment = {};
    const markDocsByAssessment = {};

    marks.forEach((m) => {
      const aid = m.assessment.toString();
      marksByAssessment[aid] = Number(m.obtainedMarks || 0);
      markDocsByAssessment[aid] = m;
    });

    const assessmentsResponse = assessments.map((a) => {
      const aid = a._id.toString();
      const markDoc = markDocsByAssessment[aid];
      const obtained = marksByAssessment[aid] ?? null;

      return {
        id: aid,
        _id: aid,
        name: a.name,
        fullMarks: a.fullMarks,
        structureType: a.structureType || 'regular',
        labFinalConfig: a.labFinalConfig || null,
        isPublished: a.isPublished,
        publishedAt: a.publishedAt,
        obtainedMarks: obtained,
        status: markDoc?.status || "present",
        subMarks: Array.isArray(markDoc?.subMarks) ? markDoc.subMarks : [],
      };
    });

    const summary = computeSummaryForStudent(
      course,
      assessments,
      marksByAssessment,
      markDocsByAssessment
    );

    res.json({
      course: {
        id: course._id.toString(),
        code: course.code,
        title: course.title,
        section: course.section,
        semester: course.semester,
        year: course.year,
        courseType: course.courseType,
        classTestPolicy: course.classTestPolicy || {},
        complaintSettings: formatComplaintSettings(course),
        projectFeature: {
          mode: course?.projectFeature?.mode || "lab_final",
          totalProjectMarks: Number(course?.projectFeature?.totalProjectMarks || 40),
          allowStudentGroupCreation:
            course?.projectFeature?.allowStudentGroupCreation !== false,
          allowTeacherGroupEditing:
            course?.projectFeature?.allowTeacherGroupEditing !== false,
          visibleToStudents:
            course?.projectFeature?.visibleToStudents !== false,
        },
      },
      assessments: assessmentsResponse,
      totalObtained: summary.totalObtained,
      ctMain: summary.ctMain,
      labMain: summary.labMain || 0,
      grade: summary.grade,
      aPlusInfo: summary.aPlusInfo,
      aPlusNeeded: summary.aPlusNeeded,
      maxPossible: summary.maxPossible,
      summary,
    });
  } catch (err) {
    console.error('getStudentCourseDetails error', err);
    res.status(500).json({ message: 'Server error loading course details' });
  }
};

const getStudentCourseMaterials = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const enrollment = await Enrollment.findOne({
      student: studentId,
      course: courseId,
    }).populate("course");

    if (!enrollment || !enrollment.course) {
      return res.status(404).json({ message: "Course not found for this student" });
    }

    if (enrollment.course.archived === true) {
      return res.status(404).json({ message: "Course not found for this student" });
    }

    const materials = await CourseMaterial.find({
      course: courseId,
      visibleToStudents: true,
    }).sort({ sortOrder: 1, createdAt: -1 });

    res.json(materials);
  } catch (err) {
    console.error("getStudentCourseMaterials error", err);
    res.status(500).json({ message: "Server error loading course materials" });
  }
};

module.exports = {
  getStudentCourses,
  getStudentCourseDetails,
  getStudentCourseMaterials,
};