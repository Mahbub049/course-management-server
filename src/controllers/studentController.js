const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

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
  for (const g of GRADE_THRESHOLDS) {
    if (total >= g.min) return g.grade;
  }
  return 'F';
};

const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

const roundPolicyTotal = (total) => {
  return total % 1 === 0
    ? total
    : total % 1 <= 0.5
      ? Math.floor(total) + 0.5
      : Math.ceil(total);
};

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

const computeSummaryForStudent = (course, assessments, marksByAssessment) => {
  const courseType = getCourseType(course);

  const getPct = (assessmentId, fullMarks) => {
    const mark = marksByAssessment[assessmentId];
    if (mark == null || Number.isNaN(Number(mark)) || Number(fullMarks) <= 0) {
      return 0;
    }
    return Number(mark) / Number(fullMarks);
  };

  // ===== LAB COURSES =====
  if (courseType === 'lab') {
    const regularLabAssessments = assessments.filter((a) => {
      const name = lower(a.name);
      return (
        a?.structureType !== 'lab_final' &&
        !name.includes('mid') &&
        !name.includes('final') &&
        !name.includes('att') &&
        !name.includes('attendance')
      );
    });

    const midAssessment = assessments.find((a) =>
      lower(a.name).includes('mid')
    );

    const advancedLabFinal = assessments.find(
      (a) => a?.structureType === 'lab_final'
    );

    const regularFinal = assessments.find(
      (a) =>
        a?.structureType !== 'lab_final' &&
        lower(a.name).includes('final')
    );

    const finalAssessment = advancedLabFinal || regularFinal;

    const attendanceAssessment = assessments.find((a) => {
      const name = lower(a.name);
      return name.includes('att') || name.includes('attendance');
    });

    const regularLabPctsNow = regularLabAssessments.map((a) =>
      getPct(a._id.toString(), a.fullMarks)
    );

    const regularLabPctsFull = regularLabAssessments.map(() => 1);

    const avgNow =
      regularLabPctsNow.length > 0
        ? regularLabPctsNow.reduce((s, p) => s + p, 0) /
          regularLabPctsNow.length
        : 0;

    const avgFull =
      regularLabPctsFull.length > 0
        ? regularLabPctsFull.reduce((s, p) => s + p, 0) /
          regularLabPctsFull.length
        : 0;

    const labNow = avgNow * 25;
    const labFull = avgFull * 25;

    const midNow = midAssessment
      ? getPct(midAssessment._id.toString(), midAssessment.fullMarks) * 30
      : 0;
    const midFull = midAssessment ? 30 : 0;

    const finalNow = finalAssessment
      ? getPct(finalAssessment._id.toString(), finalAssessment.fullMarks) * 40
      : 0;
    const finalFull = finalAssessment ? 40 : 0;

    const attNow = attendanceAssessment
      ? getPct(
          attendanceAssessment._id.toString(),
          attendanceAssessment.fullMarks
        ) * 5
      : 0;
    const attFull = attendanceAssessment ? 5 : 0;

    const currentTotal = labNow + midNow + finalNow + attNow;
    const maxPossible = labFull + midFull + finalFull + attFull;

    const grade = getGradeFromTotal(currentTotal);
    const A_PLUS = 80;
    const neededForAPlus =
      currentTotal >= A_PLUS ? 0 : Math.max(0, A_PLUS - currentTotal);

    return {
      currentTotal: round2(roundPolicyTotal(currentTotal)),
      maxPossible: round2(maxPossible),
      grade,
      totalObtained: round2(roundPolicyTotal(currentTotal)),
      ctMain: round2(roundPolicyTotal(labNow)),
      labMain: round2(roundPolicyTotal(labNow)),
      aPlusNeeded: round2(neededForAPlus),
      aPlusInfo: {
        needed: round2(neededForAPlus),
        maxPossible: round2(maxPossible),
      },
    };
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

  assessments.forEach((a) => {
    const id = a._id.toString();
    const name = lower(a.name);
    const full = Number(a.fullMarks || 0);
    const pctNow = getPct(id, full);
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

  const currentTotal = ctNow + midNow + finalNow + attNow + assignPresNow;
  const maxPossible = ctFull + midFull + finalFull + attFull + assignPresFull;

  const grade = getGradeFromTotal(currentTotal);
  const A_PLUS = 80;
  const neededForAPlus =
    currentTotal >= A_PLUS ? 0 : Math.max(0, A_PLUS - currentTotal);

  return {
    currentTotal: round2(roundPolicyTotal(currentTotal)),
    maxPossible: round2(maxPossible),
    grade,
    totalObtained: round2(roundPolicyTotal(currentTotal)),
    ctMain: round2(roundPolicyTotal(ctNow)),
    aPlusNeeded: round2(neededForAPlus),
    aPlusInfo: {
      needed: round2(neededForAPlus),
      maxPossible: round2(maxPossible),
    },
  };
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

    const [assessments, marks] = await Promise.all([
      Assessment.find({
        course: { $in: courseIds },
        isPublished: true,
      }).sort({ order: 1, createdAt: 1 }),
      Mark.find({
        student: studentId,
        course: { $in: courseIds },
      }),
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

    const marksByCourse = {};
    const marksByAssessmentByCourse = {};

    for (const m of marks) {
      const assessmentId = m.assessment.toString();
      if (!publishedAssessmentIds.has(assessmentId)) continue;

      const cid = m.course.toString();

      if (!marksByCourse[cid]) marksByCourse[cid] = [];
      marksByCourse[cid].push(m);

      if (!marksByAssessmentByCourse[cid]) marksByAssessmentByCourse[cid] = {};
      marksByAssessmentByCourse[cid][assessmentId] = Number(m.obtainedMarks || 0);
    }

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
          marksByAssessmentByCourse[cid] || {}
        );

        summary = {
          total: computed.currentTotal,
          ctMain: computed.ctMain,
          labMain: computed.labMain || 0,
          grade: computed.grade,
          maxPossible: computed.maxPossible,
        };
      }

      return {
        id: cid,
        code: course.code,
        title: course.title,
        section: course.section,
        semester: course.semester,
        year: course.year,
        courseType: course.courseType,
        summaryStatus,
        summary,
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
        subMarks: Array.isArray(markDoc?.subMarks) ? markDoc.subMarks : [],
      };
    });

    const summary = computeSummaryForStudent(
      course,
      assessments,
      marksByAssessment
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

module.exports = {
  getStudentCourses,
  getStudentCourseDetails,
};