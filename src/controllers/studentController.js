// server/src/controllers/studentController.js

const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

// ---------- Helpers for course type / weighting ----------

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
  { grade: 'C', min: 50 },
  { grade: 'D', min: 45 },
];

const getGradeFromTotal = (total) => {
  for (const g of GRADE_THRESHOLDS) {
    if (total >= g.min) return g.grade;
  }
  return 'F';
};

const round2 = (x) => Math.round(x * 100) / 100;

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

// ---------- Core computation (same logic as teacher TabMarks) ----------

const computeSummaryForStudent = (course, assessments, marksByAssessment) => {
  const courseType = getCourseType(course);

  const getPct = (assessmentId, fullMarks) => {
    const mark = marksByAssessment[assessmentId];
    if (mark == null || Number.isNaN(mark) || fullMarks <= 0) return 0;
    return mark / fullMarks;
  };

  // ===== LAB COURSES =====
  if (courseType === 'lab') {
    const labPctsNow = [];
    const labPctsFull = [];

    let midPctNow = 0;
    let midPctFull = 0;
    let finalPctNow = 0;
    let finalPctFull = 0;
    let attPctNow = 0;
    let attPctFull = 0;

    assessments.forEach((a) => {
      const id = a._id.toString();
      const name = lower(a.name);
      const full = a.fullMarks || 0;
      const pctNow = getPct(id, full);
      const hasThis = full > 0;

      if (
        !name.includes('mid') &&
        !name.includes('final') &&
        !name.includes('att') &&
        !name.includes('attendance')
      ) {
        labPctsNow.push(pctNow);
        if (hasThis) labPctsFull.push(1);
      } else if (name.includes('mid')) {
        midPctNow = pctNow;
        midPctFull = hasThis ? 1 : 0;
      } else if (name.includes('final')) {
        finalPctNow = pctNow;
        finalPctFull = hasThis ? 1 : 0;
      } else if (name.includes('att') || name.includes('attendance')) {
        attPctNow = pctNow;
        attPctFull = hasThis ? 1 : 0;
      }
    });

    const avgNow =
      labPctsNow.length > 0
        ? labPctsNow.reduce((s, p) => s + p, 0) / labPctsNow.length
        : 0;

    const avgFull =
      labPctsFull.length > 0
        ? labPctsFull.reduce((s, p) => s + p, 0) / labPctsFull.length
        : 0;

    const labNow = avgNow * 25;
    const labFull = avgFull * 25;

    const midNow = midPctNow * 30;
    const midFull = midPctFull * 30;

    const finalNow = finalPctNow * 40;
    const finalFull = finalPctFull * 40;

    const attNow = attPctNow * 5;
    const attFull = attPctFull * 5;

    const currentTotal = labNow + midNow + finalNow + attNow;
    const maxPossible = labFull + midFull + finalFull + attFull;

    const grade = getGradeFromTotal(currentTotal);
    const A_PLUS = 80;
    const neededForAPlus =
      currentTotal >= A_PLUS ? 0 : Math.max(0, A_PLUS - currentTotal);

    return {
      currentTotal: round2(currentTotal),
      maxPossible: round2(maxPossible),
      grade,
      totalObtained: round2(currentTotal),
      ctMain: 0,
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
    const full = a.fullMarks || 0;
    const pctNow = getPct(id, full);
    const hasThis = full > 0;

    if (isCtAssessment(a.name)) {
      ctEntriesNow.push({
        id: id,
        pct: pctNow,
      });

      ctEntriesFull.push({
        id: id,
        pct: hasThis ? 1 : 0,
      });
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

  // const bestTwoAvg = (arr) => {
  //   if (arr.length === 0) return 0;
  //   if (arr.length === 1) return arr[0];
  //   const sorted = [...arr].sort((a, b) => b - a);
  //   return (sorted[0] + sorted[1]) / 2;
  // };

  // const ctAvgNow = bestTwoAvg(ctPctsNow);
  // const ctAvgFull = bestTwoAvg(ctPctsFull);

  // const ctNow = ctAvgNow * 15;
  // const ctFull = ctAvgFull * 15;

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
    currentTotal: round2(currentTotal),
    maxPossible: round2(maxPossible),
    grade,
    totalObtained: round2(currentTotal),
    ctMain: roundPolicyTotal(ctNow),
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

    // Only published assessments should be visible to students
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

    // Group assessments by course
    const assessmentsByCourse = {};
    for (const a of assessments) {
      const cid = a.course.toString();
      if (!assessmentsByCourse[cid]) assessmentsByCourse[cid] = [];
      assessmentsByCourse[cid].push(a);
    }

    // Group only marks that belong to published assessments
    const marksByCourse = {};
    const marksByAssessmentByCourse = {};
    for (const m of marks) {
      const assessmentId = m.assessment.toString();
      if (!publishedAssessmentIds.has(assessmentId)) continue;

      const cid = m.course.toString();

      if (!marksByCourse[cid]) marksByCourse[cid] = [];
      marksByCourse[cid].push(m);

      if (!marksByAssessmentByCourse[cid]) marksByAssessmentByCourse[cid] = {};
      marksByAssessmentByCourse[cid][assessmentId] = m.obtainedMarks;
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

    // Only published assessments
    const assessments = await Assessment.find({
      course: courseId,
      isPublished: true,
    }).sort({
      order: 1,
      createdAt: 1,
    });

    const publishedAssessmentIds = assessments.map((a) => a._id);

    // Only marks for published assessments
    const marks = await Mark.find({
      course: courseId,
      student: studentId,
      assessment: { $in: publishedAssessmentIds },
    });

    const marksByAssessment = {};
    marks.forEach((m) => {
      marksByAssessment[m.assessment.toString()] = m.obtainedMarks;
    });

    const assessmentsResponse = assessments.map((a) => {
      const obtained = marksByAssessment[a._id.toString()] ?? null;
      return {
        id: a._id.toString(),
        _id: a._id.toString(),
        name: a.name,
        fullMarks: a.fullMarks,
        isPublished: a.isPublished,
        publishedAt: a.publishedAt,
        obtainedMarks: obtained,
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