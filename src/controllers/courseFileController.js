const mongoose = require("mongoose");

const Course = require("../models/Course");
const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");
const Mark = require("../models/Mark");
const Attendance = require("../models/Attendance");
const LabSubmission = require("../models/LabSubmission");
const CourseObeConfig = require("../models/CourseObeConfig");
const ObeAssessmentBlueprint = require("../models/ObeAssessmentBlueprint");
const ObeStudentMark = require("../models/ObeStudentMark");
const CourseFileConfig = require("../models/CourseFileConfig");
const CourseFileDocument = require("../models/CourseFileDocument");
const {
  bucketName,
  buildCourseFileStoragePath,
  uploadCourseFileBuffer,
  deleteCourseFileObject,
  createCourseFileSignedUrl,
  downloadCourseFileBuffer,
} = require("../utils/courseFileStorage");
const { convertOfficeBufferToPdf } = require("../utils/officePdfConversion");

const THEORY_CHECKLIST = [
  { key: "outline", title: "Course Outline", mode: "single" },
  { key: "attendance", title: "Attendance sheet [All sections]", mode: "all_sections" },
  { key: "assignment", title: "Assignment with rubrics (copies of best, mediocre and poor)", mode: "samples" },
  { key: "class_test", title: "Answer Scripts & Questions (Best, Mediocre and Poor) of Class Tests", mode: "samples_by_assessment" },
  { key: "mid", title: "Answer Scripts (Best, Mediocre and Poor) of Mid semester exam", mode: "samples" },
  { key: "final", title: "Answer Scripts (Best, Mediocre and Poor) of final exam", mode: "samples" },
  { key: "questions", title: "Questions of Mid & Final Exam and Answer Schema with Rubrics", mode: "single" },
  { key: "course_evaluation", title: "Course evaluation by course teacher and attainment of CLOs and Course level CQI plan from CO-PO files [all sections]", mode: "all_sections" },
  { key: "teacher_evaluation", title: "Teacher Evaluation by students [all sections]", mode: "all_sections" },
];

const LAB_CHECKLIST = [
  { key: "outline", title: "Course Outline", mode: "single" },
  { key: "attendance", title: "Attendance Sheet [All Sections]", mode: "all_sections" },
  { key: "lab_report", title: "Lab Report (Copies of Best, Mediocre and Poor)", mode: "samples" },
  { key: "continuous_lab", title: "Continuous Lab Performance (CLP) [All Sections]", mode: "all_sections" },
  { key: "lab_questions", title: "Questions of Lab Exam and Answer Schema with Rubrics", mode: "single" },
  { key: "lab_exam", title: "Answer Scripts (Copies of Best, Mediocre and Poor) of Lab Exam", mode: "samples_by_assessment" },
  { key: "project_report", title: "Project Report (Copies of Best, Mediocre and Poor)", mode: "samples" },
  { key: "course_evaluation", title: "Course evaluation by course teacher and attainment of CLOs and Course level CQI plan from CO-PO files [All Sections]", mode: "all_sections" },
  { key: "teacher_evaluation", title: "Teacher Evaluation by Students [All Sections]", mode: "all_sections" },
];

const ALLOWED_ITEM_KEYS = new Set([
  ...THEORY_CHECKLIST.map((item) => item.key),
  ...LAB_CHECKLIST.map((item) => item.key),
  "obe_gradesheet",
  "answer_script_mid_record",
  "answer_script_final_record",
]);

function isCourseFileEligible(course) {
  const shift = String(course?.shift || "").trim().toLowerCase();
  const department = String(course?.department || "").toUpperCase();
  const type = String(course?.courseType || "theory").toLowerCase();
  return shift === "day" && !department.includes("(DH)") && type !== "self_study";
}

async function getTeacherCourse(courseId, teacherId) {
  const course = await Course.findOne({ _id: courseId, createdBy: teacherId })
    .populate("createdBy", "name username department designation shortCode signatureImage")
    .lean();
  return course;
}

function classifyAssessment(assessment = {}) {
  const name = String(assessment.name || "").toLowerCase();
  const isLabReport = /\blab\s*report\b|\breport\s*lab\b/.test(name);
  const isProjectReport = /project/.test(name) && /report/.test(name);
  return {
    isMid: name.includes("mid"),
    isFinal: name.includes("final"),
    isCt: /(^|\b)ct([\s\-_]|$)|class\s*test|quiz\s*test|\bquiz\b/.test(name),
    isAssignment: /assignment|presentation/.test(name),
    isAttendance: /attendance|attend|\batt\b/.test(name),
    isLabReport,
    isProjectReport,
    isLabExam: /lab\s*exam|exam\s*lab/.test(name),
  };
}

function toId(value) {
  return String(value?._id || value || "");
}

function uniqueIds(values = []) {
  return Array.from(new Set((values || []).map(toId).filter(Boolean)));
}

function median(values = []) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function pickBandCandidates(entries = [], max = 5) {
  const source = entries.filter((entry) => Number.isFinite(Number(entry.score)));
  if (!source.length) return { best: [], mediocre: [], poor: [] };

  const scoreMedian = median(source.map((entry) => entry.score));
  const totalMedian = median(source.map((entry) => entry.totalAll));

  const best = [...source]
    .sort((a, b) => Number(b.score) - Number(a.score) || Number(b.totalAll) - Number(a.totalAll) || String(a.roll).localeCompare(String(b.roll)))
    .slice(0, max);

  const poor = [...source]
    .sort((a, b) => Number(a.score) - Number(b.score) || Number(a.totalAll) - Number(b.totalAll) || String(a.roll).localeCompare(String(b.roll)))
    .slice(0, max);

  const mediocre = [...source]
    .sort((a, b) => {
      const da = Math.abs(Number(a.score) - scoreMedian);
      const db = Math.abs(Number(b.score) - scoreMedian);
      if (da !== db) return da - db;
      const ta = Math.abs(Number(a.totalAll) - totalMedian);
      const tb = Math.abs(Number(b.totalAll) - totalMedian);
      return ta - tb || String(a.roll).localeCompare(String(b.roll));
    })
    .slice(0, max);

  return { best, mediocre, poor };
}

function displayCandidate(entry = {}) {
  return {
    studentId: entry.studentId,
    roll: entry.roll,
    name: entry.name,
    score: Math.round(Number(entry.score || 0) * 100) / 100,
    scoreDisplay: entry.scoreDisplay || String(Math.round(Number(entry.score || 0) * 100) / 100),
    fullMarks: Number(entry.fullMarks || 0),
    totalAll: Math.round(Number(entry.totalAll || 0) * 100) / 100,
    submissionId: entry.submissionId || "",
    submissionFileName: entry.submissionFileName || "",
  };
}

function formatSuggestion(scopeKey, title, assessmentId, entries = []) {
  const picked = pickBandCandidates(entries, 5);
  return {
    scopeKey,
    title,
    assessmentId: assessmentId || "",
    candidateCount: entries.length,
    bands: {
      best: picked.best.map(displayCandidate),
      mediocre: picked.mediocre.map(displayCandidate),
      poor: picked.poor.map(displayCandidate),
    },
  };
}

async function buildSuggestions(courseId, assessments, config) {
  const [enrollments, marks, submissions] = await Promise.all([
    Enrollment.find({ course: courseId }).populate("student", "name username").lean(),
    Mark.find({ course: courseId }).lean(),
    LabSubmission.find({ course: courseId, storageDeleted: { $ne: true } }).lean(),
  ]);

  const studentMap = new Map();
  enrollments.forEach((row) => {
    if (!row.student?._id) return;
    studentMap.set(String(row.student._id), {
      studentId: String(row.student._id),
      roll: row.student.username || "",
      name: row.student.name || "",
    });
  });

  const totalByStudent = new Map();
  marks.forEach((mark) => {
    if (mark.status !== "present") return;
    const sid = String(mark.student);
    if (!studentMap.has(sid)) return;
    totalByStudent.set(sid, (totalByStudent.get(sid) || 0) + Number(mark.obtainedMarks || 0));
  });

  const marksByAssessment = new Map();
  marks.forEach((mark) => {
    if (mark.status !== "present") return;
    const aid = String(mark.assessment);
    if (!marksByAssessment.has(aid)) marksByAssessment.set(aid, []);
    marksByAssessment.get(aid).push(mark);
  });

  const submissionsByAssessmentStudent = new Map();
  submissions.forEach((submission) => {
    submissionsByAssessmentStudent.set(`${submission.assessment}__${submission.student}`, submission);
  });

  const assessmentById = new Map(assessments.map((item) => [String(item._id), item]));

  const regularEntries = (assessment) => {
    const aid = String(assessment._id);
    return (marksByAssessment.get(aid) || [])
      .map((mark) => {
        const sid = String(mark.student);
        const student = studentMap.get(sid);
        if (!student) return null;
        const submission = submissionsByAssessmentStudent.get(`${aid}__${sid}`);
        return {
          ...student,
          score: Number(mark.obtainedMarks || 0),
          fullMarks: Number(assessment.fullMarks || 0),
          totalAll: Number(totalByStudent.get(sid) || 0),
          submissionId: submission?._id ? String(submission._id) : "",
          submissionFileName: submission?.originalFileName || "",
        };
      })
      .filter(Boolean);
  };

  const result = {
    assignment: [],
    classTests: [],
    mid: [],
    final: [],
    labReports: [],
    labExams: [],
    projectReports: [],
  };

  assessments.forEach((assessment) => {
    const flags = classifyAssessment(assessment);
    const aid = String(assessment._id);
    const entries = regularEntries(assessment);
    if (flags.isAssignment) result.assignment.push(formatSuggestion(`assessment:${aid}`, assessment.name, aid, entries));
    if (flags.isCt) result.classTests.push(formatSuggestion(`assessment:${aid}`, assessment.name, aid, entries));
    if (flags.isMid) result.mid.push(formatSuggestion(`assessment:${aid}`, assessment.name, aid, entries));
    if (flags.isFinal) result.final.push(formatSuggestion(`assessment:${aid}`, assessment.name, aid, entries));
    if (flags.isLabExam || ((flags.isMid || flags.isFinal) && String(assessment.structureType || "").includes("lab"))) {
      result.labExams.push(formatSuggestion(`assessment:${aid}`, assessment.name, aid, entries));
    }
  });

  // Aggregate all selected lab reports. If the teacher has not mapped them yet,
  // name matching provides sensible defaults.
  const mappingsInitialized = config?.labMappingsInitialized === true;
  let labReportIds = uniqueIds(config?.labReportAssessmentIds);
  if (!mappingsInitialized && !labReportIds.length) {
    labReportIds = assessments.filter((a) => classifyAssessment(a).isLabReport).map((a) => String(a._id));
  }
  const labAgg = new Map();
  labReportIds.forEach((aid) => {
    const assessment = assessmentById.get(aid);
    if (!assessment) return;
    (marksByAssessment.get(aid) || []).forEach((mark) => {
      const sid = String(mark.student);
      const student = studentMap.get(sid);
      if (!student) return;
      const row = labAgg.get(sid) || { ...student, percentSum: 0, count: 0, totalAll: Number(totalByStudent.get(sid) || 0), submissionId: "", submissionFileName: "" };
      const full = Number(assessment.fullMarks || 0);
      row.percentSum += full > 0 ? (Number(mark.obtainedMarks || 0) / full) * 100 : Number(mark.obtainedMarks || 0);
      row.count += 1;
      const submission = submissionsByAssessmentStudent.get(`${aid}__${sid}`);
      if (submission && !row.submissionId) {
        row.submissionId = String(submission._id);
        row.submissionFileName = submission.originalFileName || "";
      }
      labAgg.set(sid, row);
    });
  });
  const labEntries = Array.from(labAgg.values()).filter((r) => r.count > 0).map((r) => ({
    ...r,
    score: r.percentSum / r.count,
    scoreDisplay: `${Math.round((r.percentSum / r.count) * 100) / 100}% average`,
    fullMarks: 100,
  }));
  if (labReportIds.length) {
    result.labReports.push(formatSuggestion("aggregate:lab_report", "Average of selected Lab Report assessments", "", labEntries));
  }

  // Project report can be a normal assessment or a sub-component inside a lab
  // mid/final breakdown. Mapped assessment IDs take priority; otherwise use name
  // matching and structured components titled close to Project Report.
  let projectIds = uniqueIds(config?.projectReportAssessmentIds);
  if (!mappingsInitialized && !projectIds.length) {
    projectIds = assessments
      .filter((a) => {
        const flags = classifyAssessment(a);
        if (flags.isProjectReport) return true;
        return (a?.labFinalConfig?.genericComponents || []).some((c) => /project/.test(String(c.name || "").toLowerCase()) && /report/.test(String(c.name || "").toLowerCase()));
      })
      .map((a) => String(a._id));
  }

  projectIds.forEach((aid) => {
    const assessment = assessmentById.get(aid);
    if (!assessment) return;
    const component = (assessment?.labFinalConfig?.genericComponents || []).find((c) => /project/.test(String(c.name || "").toLowerCase()) && /report/.test(String(c.name || "").toLowerCase()));
    let entries;
    if (component?.key) {
      entries = (marksByAssessment.get(aid) || []).map((mark) => {
        const sid = String(mark.student);
        const student = studentMap.get(sid);
        if (!student) return null;
        const sub = (mark.subMarks || []).find((s) => String(s.key) === String(component.key));
        return {
          ...student,
          score: Number(sub?.obtainedMarks || 0),
          fullMarks: Number(component.marks || 0),
          totalAll: Number(totalByStudent.get(sid) || 0),
        };
      }).filter(Boolean);
    } else {
      entries = regularEntries(assessment);
    }
    result.projectReports.push(formatSuggestion(`project:${aid}${component?.key ? `:${component.key}` : ""}`, component?.name || assessment.name, aid, entries));
  });

  return {
    groups: result,
    defaults: {
      labReportAssessmentIds: labReportIds,
      continuousLabAssessmentIds: (() => {
        const stored = uniqueIds(config?.continuousLabAssessmentIds);
        if (mappingsInitialized) return stored;
        if (stored.length) return stored;
        return assessments.filter((a) => {
          const f = classifyAssessment(a);
          return !f.isMid && !f.isFinal && !f.isAttendance && !f.isLabReport && !f.isProjectReport && a.structureType !== "lab_submission";
        }).map((a) => String(a._id));
      })(),
      projectReportAssessmentIds: projectIds,
    },
  };
}

function sanitizeAnswerScriptRecordRows(value = [], validStudentIds = new Set()) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((row) => {
      const band = ["best", "mediocre", "poor"].includes(row?.band) ? row.band : "";
      if (!band || seen.has(band)) return null;
      seen.add(band);
      const rawStudentId = toId(row?.studentId);
      return {
        band,
        studentId: rawStudentId && validStudentIds.has(rawStudentId) ? rawStudentId : null,
        studentRoll: String(row?.studentRoll || row?.roll || "").trim().slice(0, 80),
        studentName: String(row?.studentName || row?.name || "").trim().slice(0, 180),
        scriptSerialNo: String(row?.scriptSerialNo || row?.answerScriptSlNo || "").trim().slice(0, 80),
        scoreDisplay: String(row?.scoreDisplay ?? row?.score ?? "").trim().slice(0, 60),
        remarks: String(row?.remarks || "").trim().slice(0, 300),
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function safeMetaArray(value, count) {
  if (!value) return Array.from({ length: count }, () => ({}));
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return Array.from({ length: count }, (_, i) => parsed[i] || {});
    return Array.from({ length: count }, () => parsed || {});
  } catch (_err) {
    return Array.from({ length: count }, () => ({}));
  }
}

function sameFacultyOfferingQuery(course, teacherId) {
  const query = {
    _id: { $ne: course._id },
    createdBy: teacherId,
    archived: { $ne: true },
    code: course.code,
    courseType: course.courseType || "theory",
    shift: course.shift || "Day",
  };

  // Keep the automatic link intentionally narrow: it is for the same faculty
  // teaching the same course offering in multiple sections, not every historical
  // course with the same code. Intake is especially important where the same
  // course code is taught to more than one cohort in a semester.
  if (String(course.intake || "").trim()) query.intake = course.intake;
  if (course.semester !== undefined && course.semester !== null && String(course.semester).trim()) query.semester = course.semester;
  if (course.year !== undefined && course.year !== null) query.year = course.year;
  if (String(course.department || "").trim()) query.department = course.department;
  return query;
}

function mergeSectionRows(configSections = [], course, siblingCourses = []) {
  const bySection = new Map();
  (configSections || []).forEach((row) => {
    const section = String(row?.section || "").trim();
    if (!section) return;
    bySection.set(section.toLowerCase(), { section, shortCode: String(row?.shortCode || "").trim() });
  });

  const teacherShortCode = String(course?.createdBy?.shortCode || "").trim();
  [course, ...(siblingCourses || [])].forEach((row) => {
    const section = String(row?.section || "").trim();
    if (!section) return;
    const key = section.toLowerCase();
    const existing = bySection.get(key);
    if (existing) {
      if (!existing.shortCode && teacherShortCode) existing.shortCode = teacherShortCode;
      return;
    }
    bySection.set(key, { section, shortCode: teacherShortCode });
  });

  return Array.from(bySection.values()).sort((a, b) =>
    String(a.section).localeCompare(String(b.section), undefined, { numeric: true, sensitivity: "base" })
  );
}

async function buildAutomaticSectionSources(course, siblingCourses = []) {
  const rows = [course, ...(siblingCourses || [])];
  return Promise.all(rows.map(async (row) => {
    const courseId = row._id;
    const [obeSetup, obeBlueprintCount, obeMarkCount, attendanceRecordCount] = await Promise.all([
      CourseObeConfig.findOne({ course: courseId }).select("_id").lean(),
      ObeAssessmentBlueprint.countDocuments({ course: courseId }),
      ObeStudentMark.countDocuments({ course: courseId }),
      Attendance.countDocuments({ course: courseId }),
    ]);
    const obeReady = Boolean(obeSetup && obeBlueprintCount > 0 && obeMarkCount > 0);
    return {
      courseId: String(courseId),
      section: String(row.section || ""),
      intake: String(row.intake || ""),
      code: String(row.code || ""),
      title: String(row.title || ""),
      semester: String(row.semester || ""),
      year: row.year || "",
      courseType: String(row.courseType || "theory"),
      isOwner: String(courseId) === String(course._id),
      attendanceReady: attendanceRecordCount > 0,
      attendanceRecordCount,
      obeReady,
      continuousLabReady: String(row.courseType || "").toLowerCase() === "lab" && obeReady,
    };
  }));
}

const getCourseFileState = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    const eligible = isCourseFileEligible(course);
    if (!eligible) {
      return res.json({ eligible: false, reason: "Course File Preparation is available only for Day courses." });
    }

    const siblingCourses = await Course.find(sameFacultyOfferingQuery(course, req.user.userId))
      .select("code title section intake shift semester year courseType department createdBy")
      .sort({ section: 1, createdAt: 1 })
      .lean();
    const siblingIds = siblingCourses.map((row) => row._id);

    const [config, siblingConfigs, assessments, currentDocs, automaticSections] = await Promise.all([
      CourseFileConfig.findOne({ course: courseId, createdBy: req.user.userId }).lean(),
      siblingIds.length
        ? CourseFileConfig.find({ course: { $in: siblingIds }, createdBy: req.user.userId }).lean()
        : Promise.resolve([]),
      Assessment.find({ course: courseId }).sort({ order: 1, createdAt: 1 }).lean(),
      CourseFileDocument.find({ course: courseId, createdBy: req.user.userId })
        .sort({ itemKey: 1, createdAt: 1 })
        .lean(),
      buildAutomaticSectionSources(course, siblingCourses),
    ]);

    const suggestions = await buildSuggestions(courseId, assessments, config || {});
    const checklist = String(course.courseType || "theory").toLowerCase() === "lab" ? LAB_CHECKLIST : THEORY_CHECKLIST;
    const allSectionKeys = checklist.filter((item) => item.mode === "all_sections").map((item) => item.key);

    // Documents for checklist items that explicitly require all sections are
    // shared automatically between this faculty's matching section-courses.
    // Sample scripts/reports stay local to the section that is currently open.
    const linkedDocs = siblingIds.length
      ? await CourseFileDocument.find({
          course: { $in: siblingIds },
          createdBy: req.user.userId,
          itemKey: { $in: [...allSectionKeys, "obe_gradesheet"] },
        }).sort({ itemKey: 1, createdAt: 1 }).lean()
      : [];

    const sourceCourseById = new Map(
      [course, ...siblingCourses].map((row) => [String(row._id), row])
    );
    const rawDocs = [
      ...currentDocs.map((doc) => ({ ...doc, linkedFromSibling: false, sourceCourseId: String(course._id) })),
      ...linkedDocs.map((doc) => ({ ...doc, linkedFromSibling: true, sourceCourseId: String(doc.course) })),
    ];

    // Avoid displaying the exact same all-section file twice when it was already
    // present in the current course and is also visible through a sibling course.
    const seenDocuments = new Set();
    const dedupedDocs = rawDocs.filter((doc) => {
      const sourceCourse = sourceCourseById.get(String(doc.sourceCourseId || doc.course));
      const section = String(doc.section || sourceCourse?.section || "").trim();
      doc.section = section;
      const key = [doc.itemKey, section.toLowerCase(), doc.scopeKey || "", doc.band || "", doc.originalFileName || "", doc.label || ""].join("::");
      if (seenDocuments.has(key)) return false;
      seenDocuments.add(key);
      return true;
    });

    const documents = await Promise.all(
      dedupedDocs.map(async (doc) => ({
        ...doc,
        id: String(doc._id),
        sourceCourseId: String(doc.sourceCourseId || doc.course || course._id),
        linkedFromSibling: doc.linkedFromSibling === true,
        signedUrl: await createCourseFileSignedUrl(doc.storagePath, 60 * 60).catch(() => ""),
      }))
    );

    const teacher = course.createdBy || {};
    const baseConfig = config || {
      setupCompleted: false,
      sections: [],
      labReportAssessmentIds: suggestions.defaults.labReportAssessmentIds,
      continuousLabAssessmentIds: suggestions.defaults.continuousLabAssessmentIds,
      projectReportAssessmentIds: suggestions.defaults.projectReportAssessmentIds,
      labMappingsInitialized: false,
      selections: [],
      supplementary: {
        includeMidSelectionSheet: true,
        includeFinalSelectionSheet: true,
        includeMidSignature: false,
        includeFinalSignature: false,
      },
      answerScriptRecords: { mid: [], final: [] },
      autoAttendanceEnabled: true,
    };
    const inheritedSetup = (siblingConfigs || []).find((row) => row?.setupCompleted && (row.sections || []).length);
    const effectiveConfig = {
      ...baseConfig,
      // Section/faculty setup describes the shared course-file requirement and
      // can therefore be inherited from another section of the same offering.
      // Assessment mappings/selections remain section-local because their IDs
      // and student marks are different between sections.
      setupCompleted: baseConfig.setupCompleted === true || Boolean(inheritedSetup),
      sections: mergeSectionRows(
        [...(inheritedSetup?.sections || []), ...(baseConfig.sections || [])],
        course,
        siblingCourses
      ),
    };

    const ownerAutomatic = automaticSections.find((row) => row.isOwner) || {
      attendanceReady: false, attendanceRecordCount: 0, obeReady: false, continuousLabReady: false,
    };

    return res.json({
      eligible: true,
      course: {
        id: String(course._id),
        code: course.code,
        title: course.title,
        section: course.section || "",
        intake: course.intake || "",
        shift: course.shift || "Day",
        semester: course.semester || "",
        year: course.year || "",
        courseType: course.courseType || "theory",
        department: course.department || "",
      },
      teacher: {
        id: String(teacher._id || ""),
        name: teacher.name || "",
        designation: teacher.designation || "",
        shortCode: teacher.shortCode || "",
        signatureImage: teacher.signatureImage || "",
      },
      config: effectiveConfig,
      checklist,
      documents,
      linkedCourses: automaticSections.filter((row) => !row.isOwner),
      assessments: assessments.map((a) => ({
        id: String(a._id),
        name: a.name,
        fullMarks: Number(a.fullMarks || 0),
        structureType: a.structureType,
        classification: classifyAssessment(a),
      })),
      suggestions,
      autoSources: {
        ownerSection: String(course.section || ""),
        obeReady: ownerAutomatic.obeReady === true,
        attendanceReady: ownerAutomatic.attendanceReady === true,
        attendanceRecordCount: Number(ownerAutomatic.attendanceRecordCount || 0),
        continuousLabReady: ownerAutomatic.continuousLabReady === true,
        sections: automaticSections,
      },
    });
  } catch (error) {
    console.error("getCourseFileState error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const saveCourseFileSetup = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!isCourseFileEligible(course)) return res.status(400).json({ message: "Course File Preparation is available only for Day courses." });

    const rawSections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const sections = rawSections
      .map((row) => ({
        section: String(row?.section || "").trim(),
        shortCode: String(row?.shortCode || "").trim().slice(0, 20),
      }))
      .filter((row) => row.section);

    if (!sections.length) return res.status(400).json({ message: "Add at least one section." });
    const duplicate = sections.find((row, i) => sections.findIndex((x) => x.section.toLowerCase() === row.section.toLowerCase()) !== i);
    if (duplicate) return res.status(400).json({ message: `Section ${duplicate.section} is duplicated.` });

    const ownerShortCode = course.createdBy?.shortCode || "";
    const ownerSection = String(course.section || "").trim();
    const normalized = sections.map((row) => row.section === ownerSection && !row.shortCode ? { ...row, shortCode: ownerShortCode } : row);

    const config = await CourseFileConfig.findOneAndUpdate(
      { course: courseId, createdBy: req.user.userId },
      { $set: { setupCompleted: true, sections: normalized }, $setOnInsert: { course: courseId, createdBy: req.user.userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json(config);
  } catch (error) {
    console.error("saveCourseFileSetup error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const saveCourseFileMappings = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    const assessmentIds = new Set((await Assessment.find({ course: courseId }).select("_id").lean()).map((a) => String(a._id)));
    const cleanIds = (value) => uniqueIds(value).filter((id) => assessmentIds.has(id));
    const update = {};
    if (req.body.labReportAssessmentIds !== undefined) update.labReportAssessmentIds = cleanIds(req.body.labReportAssessmentIds);
    if (req.body.continuousLabAssessmentIds !== undefined) update.continuousLabAssessmentIds = cleanIds(req.body.continuousLabAssessmentIds);
    if (req.body.projectReportAssessmentIds !== undefined) update.projectReportAssessmentIds = cleanIds(req.body.projectReportAssessmentIds);
    if (
      req.body.labReportAssessmentIds !== undefined ||
      req.body.continuousLabAssessmentIds !== undefined ||
      req.body.projectReportAssessmentIds !== undefined
    ) {
      update.labMappingsInitialized = true;
    }
    if (req.body.supplementary !== undefined) {
      update.supplementary = {
        includeMidSelectionSheet: req.body.supplementary?.includeMidSelectionSheet !== false,
        includeFinalSelectionSheet: req.body.supplementary?.includeFinalSelectionSheet !== false,
        includeMidSignature: req.body.supplementary?.includeMidSignature === true,
        includeFinalSignature: req.body.supplementary?.includeFinalSignature === true,
      };
    }
    if (req.body.answerScriptRecords !== undefined) {
      const enrolledIds = new Set(
        (await Enrollment.find({ course: courseId }).select("student").lean()).map((row) => String(row.student))
      );
      update.answerScriptRecords = {
        mid: sanitizeAnswerScriptRecordRows(req.body.answerScriptRecords?.mid, enrolledIds),
        final: sanitizeAnswerScriptRecordRows(req.body.answerScriptRecords?.final, enrolledIds),
      };
    }
    if (req.body.autoAttendanceEnabled !== undefined) {
      update.autoAttendanceEnabled = req.body.autoAttendanceEnabled !== false;
    }

    const config = await CourseFileConfig.findOneAndUpdate(
      { course: courseId, createdBy: req.user.userId },
      { $set: update, $setOnInsert: { course: courseId, createdBy: req.user.userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json(config);
  } catch (error) {
    console.error("saveCourseFileMappings error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const saveCourseFileSelection = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { scopeKey, band, studentId, included } = req.body || {};
    if (!scopeKey || !["best", "mediocre", "poor"].includes(band) || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: "A valid scope, band and student are required." });
    }
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    const enrollment = await Enrollment.findOne({ course: courseId, student: studentId }).lean();
    if (!enrollment) return res.status(400).json({ message: "Selected student is not enrolled in this course." });

    let config = await CourseFileConfig.findOne({ course: courseId, createdBy: req.user.userId });
    if (!config) config = new CourseFileConfig({ course: courseId, createdBy: req.user.userId });
    config.selections = (config.selections || []).filter((row) => !(row.scopeKey === scopeKey && row.band === band));
    config.selections.push({ scopeKey, band, studentId, included: included === true || included === "true" });
    await config.save();
    return res.json(config);
  } catch (error) {
    console.error("saveCourseFileSelection error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const uploadCourseFileDocuments = async (req, res) => {
  const uploadedPaths = [];
  try {
    const { courseId } = req.params;
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: "Choose at least one file." });

    const itemKey = String(req.body?.itemKey || "").trim();
    if (!ALLOWED_ITEM_KEYS.has(itemKey)) return res.status(400).json({ message: "Invalid course-file item." });
    const metas = safeMetaArray(req.body?.metadata, files.length);
    const created = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const meta = metas[i] || {};
      const storagePath = buildCourseFileStoragePath({ courseId, itemKey, originalFileName: file.originalname });
      await uploadCourseFileBuffer({ buffer: file.buffer, storagePath, mimeType: file.mimetype });
      uploadedPaths.push(storagePath);

      const doc = await CourseFileDocument.create({
        course: courseId,
        createdBy: req.user.userId,
        itemKey,
        section: String(meta.section || "").trim(),
        facultyShortCode: String(meta.facultyShortCode || "").trim(),
        assessmentId: mongoose.isValidObjectId(meta.assessmentId) ? meta.assessmentId : null,
        scopeKey: String(meta.scopeKey || "").trim(),
        band: ["best", "mediocre", "poor"].includes(meta.band) ? meta.band : "",
        student: mongoose.isValidObjectId(meta.studentId) ? meta.studentId : null,
        studentRoll: String(meta.studentRoll || "").trim(),
        studentName: String(meta.studentName || "").trim(),
        label: String(meta.label || "").trim(),
        originalFileName: file.originalname,
        storagePath,
        bucketName,
        mimeType: file.mimetype || "application/octet-stream",
        fileSize: file.size || file.buffer?.length || 0,
        includeInCombined: meta.includeInCombined !== false,
        sourceKind: meta.sourceKind === "generated" ? "generated" : "upload",
      });
      created.push(doc);
    }
    return res.status(201).json(created);
  } catch (error) {
    console.error("uploadCourseFileDocuments error", error);
    await Promise.all(uploadedPaths.map((p) => deleteCourseFileObject(p).catch(() => {})));
    return res.status(500).json({ message: error?.message || "Upload failed" });
  }
};

const importLabSubmissionToCourseFile = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { submissionId, itemKey = "lab_report", band = "", scopeKey = "" } = req.body || {};
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!["lab_report", "project_report"].includes(itemKey)) return res.status(400).json({ message: "This submitted file cannot be attached to that item." });

    const submission = await LabSubmission.findOne({ _id: submissionId, course: courseId, storageDeleted: { $ne: true } })
      .populate("student", "name username")
      .lean();
    if (!submission) return res.status(404).json({ message: "Submitted file not found." });

    const existing = await CourseFileDocument.findOne({ course: courseId, sourceKind: "lab_submission", sourceRef: submission._id, itemKey });
    if (existing) return res.json(existing);

    const doc = await CourseFileDocument.create({
      course: courseId,
      createdBy: req.user.userId,
      itemKey,
      assessmentId: submission.assessment,
      scopeKey: String(scopeKey || ""),
      band: ["best", "mediocre", "poor"].includes(band) ? band : "",
      student: submission.student?._id || submission.student,
      studentRoll: submission.roll || submission.student?.username || "",
      studentName: submission.student?.name || "",
      label: "Imported from student submission",
      originalFileName: submission.originalFileName,
      storagePath: submission.filePath,
      bucketName,
      mimeType: submission.mimeType || "application/octet-stream",
      fileSize: submission.fileSize || 0,
      includeInCombined: true,
      sourceKind: "lab_submission",
      sourceRef: submission._id,
    });
    return res.status(201).json(doc);
  } catch (error) {
    console.error("importLabSubmissionToCourseFile error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const updateCourseFileDocument = async (req, res) => {
  try {
    const { courseId, documentId } = req.params;
    const doc = await CourseFileDocument.findOne({ _id: documentId, course: courseId, createdBy: req.user.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    const fields = ["section", "facultyShortCode", "scopeKey", "studentRoll", "studentName", "label"];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) doc[field] = String(req.body[field] || "").trim();
    });
    if (req.body.band !== undefined) doc.band = ["best", "mediocre", "poor"].includes(req.body.band) ? req.body.band : "";
    if (req.body.includeInCombined !== undefined) doc.includeInCombined = req.body.includeInCombined !== false;
    await doc.save();
    return res.json(doc);
  } catch (error) {
    console.error("updateCourseFileDocument error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const deleteCourseFileDocument = async (req, res) => {
  try {
    const { courseId, documentId } = req.params;
    const doc = await CourseFileDocument.findOneAndDelete({ _id: documentId, course: courseId, createdBy: req.user.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    if (doc.sourceKind !== "lab_submission") await deleteCourseFileObject(doc.storagePath).catch(() => {});
    return res.json({ message: "Document removed." });
  } catch (error) {
    console.error("deleteCourseFileDocument error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const downloadCourseFileDocument = async (req, res) => {
  try {
    const { courseId, documentId } = req.params;
    const doc = await CourseFileDocument.findOne({ _id: documentId, course: courseId, createdBy: req.user.userId }).lean();
    if (!doc) return res.status(404).json({ message: "Document not found" });
    const buffer = await downloadCourseFileBuffer(doc.storagePath);
    const name = String(doc.originalFileName || "document").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("downloadCourseFileDocument error", error);
    return res.status(500).json({ message: "Download failed" });
  }
};


const convertCourseFileOfficeToPdf = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!req.file?.buffer) return res.status(400).json({ message: "Choose a Word, Excel, or PDF file to convert." });

    const pdf = await convertOfficeBufferToPdf({
      buffer: req.file.buffer,
      originalName: req.file.originalname || "document",
      sheetName: String(req.body?.sheetName || "").trim(),
    });
    const base = String(req.file.originalname || "document").replace(/\.[^.]+$/, "").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    console.error("convertCourseFileOfficeToPdf error", error);
    const status = error?.code === "LIBREOFFICE_NOT_AVAILABLE" ? 503 : 400;
    return res.status(status).json({ message: error?.message || "Could not convert the Office file to PDF." });
  }
};

module.exports = {
  getCourseFileState,
  saveCourseFileSetup,
  saveCourseFileMappings,
  saveCourseFileSelection,
  uploadCourseFileDocuments,
  importLabSubmissionToCourseFile,
  updateCourseFileDocument,
  deleteCourseFileDocument,
  downloadCourseFileDocument,
  convertCourseFileOfficeToPdf,
};
