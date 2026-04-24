const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");
const Mark = require("../models/Mark");
const ProjectGroup = require("../models/ProjectGroup");
const ProjectPhase = require("../models/ProjectPhase");
const ProjectEvaluation = require("../models/ProjectEvaluation");
const ProjectMarkSyncConfig = require("../models/ProjectMarkSyncConfig");

const ensureTeacherCourseAccess = async (teacherId, courseId) => {
  const course = await Course.findOne({
    _id: courseId,
    createdBy: teacherId,
  });

  if (!course) {
    const err = new Error("Course not found");
    err.status = 404;
    throw err;
  }

  if (course?.projectFeature?.mode !== "project") {
    const err = new Error("Project workflow is not enabled for this course");
    err.status = 400;
    throw err;
  }

  return course;
};

const getOrCreateSyncConfig = async (courseId) => {
  let config = await ProjectMarkSyncConfig.findOne({ course: courseId });

  if (!config) {
    config = await ProjectMarkSyncConfig.create({
      course: courseId,
      targetAssessmentId: null,
      syncEnabled: false,
    });
  }

  return config;
};

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function clamp(value, min, max) {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}

function toObjectIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
}

function getOrderedProjectPhases(phases = []) {
  return [...phases].sort((a, b) => {
    const orderDiff = Number(a.order || 0) - Number(b.order || 0);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
}

function getProjectAssessmentTargets(assessment) {
  const config = assessment?.labFinalConfig || {};
  const mode = config.mode;
  const targets = [];

  if (mode !== "project_only" && mode !== "mixed") {
    return targets;
  }

  (config.projectComponents || []).forEach((component, componentIndex) => {
    if (component.entryMode === "phased") {
      (component.phases || []).forEach((phase, phaseIndex) => {
        targets.push({
          key: phase.key,
          label: `${component.name} - ${phase.name}`,
          fullMarks: Number(phase.marks || 0),
          componentKey: component.key,
          componentName: component.name || `Component ${componentIndex + 1}`,
          order: `${componentIndex}-${phaseIndex}`,
        });
      });
    } else {
      targets.push({
        key: component.key,
        label: component.name,
        fullMarks: Number(component.marks || 0),
        componentKey: component.key,
        componentName: component.name || `Component ${componentIndex + 1}`,
        order: `${componentIndex}`,
      });
    }
  });

  return targets;
}

function getAllAssessmentItems(assessment) {
  const config = assessment?.labFinalConfig || {};
  const mode = config.mode;
  const items = [];

  if (mode === "project_only" || mode === "mixed") {
    (config.projectComponents || []).forEach((component) => {
      if (component.entryMode === "phased") {
        (component.phases || []).forEach((phase) => {
          items.push({
            key: phase.key,
            fullMarks: Number(phase.marks || 0),
            section: "project",
          });
        });
      } else {
        items.push({
          key: component.key,
          fullMarks: Number(component.marks || 0),
          section: "project",
        });
      }
    });
  }

  if (mode === "lab_exam_only" || mode === "mixed") {
    (config.examQuestions || []).forEach((question) => {
      items.push({
        key: question.key,
        fullMarks: Number(question.marks || 0),
        section: "lab_final",
      });
    });
  }

  return items;
}

function calculateLabFinalObtained(assessment, subMarks = []) {
  const allowedMap = new Map(
    getAllAssessmentItems(assessment).map((item) => [String(item.key), Number(item.fullMarks || 0)])
  );

  return round2(
    (subMarks || []).reduce((sum, item) => {
      const key = String(item?.key || "");
      const limit = allowedMap.get(key);
      if (limit == null) return sum;
      return sum + clamp(item?.obtainedMarks, 0, limit);
    }, 0)
  );
}

function buildExistingSubMarkMap(subMarks = []) {
  const map = new Map();
  (subMarks || []).forEach((item) => {
    if (!item?.key) return;
    map.set(String(item.key), Number(item.obtainedMarks || 0));
  });
  return map;
}

function buildStudentPhaseMatrix({ phases, groups, enrollments, evaluations }) {
  const orderedPhases = getOrderedProjectPhases(phases);

  const rows = new Map();
  enrollments.forEach((enrollment) => {
    if (!enrollment.student?._id) return;

    const studentId = String(enrollment.student._id);
    rows.set(studentId, {
      studentId,
      name: enrollment.student.name || "",
      roll: enrollment.student.username || "",
      available: 0,
      obtained: 0,
      syncedMarks: 0,
      phaseScores: orderedPhases.map(() => 0),
    });
  });

  const groupMap = new Map();
  groups.forEach((group) => {
    groupMap.set(String(group._id), group);
  });

  orderedPhases.forEach((phase, phaseIndex) => {
    const phaseId = String(phase._id);
    const relevantEvaluations = evaluations.filter(
      (item) => String(item.phase?._id || item.phase) === phaseId
    );

    if (phase.phaseType === "group") {
      groups.forEach((group) => {
        const groupId = String(group._id);
        const evaluation = relevantEvaluations.find(
          (item) => String(item.group?._id || item.group) === groupId
        );

        const groupMark = Number(evaluation?.marksObtained || 0);
        const memberIds = Array.isArray(group.members)
          ? group.members.map((member) => String(member._id || member))
          : [];

        memberIds.forEach((studentId) => {
          const row = rows.get(studentId);
          if (!row) return;
          row.available += Number(phase.totalMarks || 0);
          row.obtained += groupMark;
          row.phaseScores[phaseIndex] = groupMark;
        });
      });
    } else {
      rows.forEach((row) => {
        row.available += Number(phase.totalMarks || 0);
      });

      relevantEvaluations.forEach((evaluation) => {
        const studentId = String(evaluation.student?._id || evaluation.student || "");
        const row = rows.get(studentId);
        if (!row) return;

        const markValue = Number(evaluation.marksObtained || 0);
        row.obtained += markValue;
        row.phaseScores[phaseIndex] = markValue;
      });
    }
  });

  rows.forEach((row) => {
    row.obtained = round2(row.obtained);
    row.available = round2(row.available);
    row.syncedMarks = round2(row.obtained);
    row.phaseScores = row.phaseScores.map((value) => round2(value));
  });

  return {
    orderedPhases,
    rows: Array.from(rows.values()),
  };
}

async function buildStudentProjectTotals(courseId) {
  const [phases, groups, enrollments, evaluations] = await Promise.all([
    ProjectPhase.find({ course: courseId }),
    ProjectGroup.find({ course: courseId }).populate("members", "_id"),
    Enrollment.find({ course: courseId }).populate("student", "_id name username"),
    ProjectEvaluation.find({ course: courseId })
      .populate("phase")
      .populate("group", "members")
      .populate("student", "_id"),
  ]);

  const matrix = buildStudentPhaseMatrix({
    phases,
    groups,
    enrollments,
    evaluations,
  });

  return matrix.rows;
}

const getTeacherProjectSyncState = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const [config, assessments] = await Promise.all([
      getOrCreateSyncConfig(courseId),
      Assessment.find({ course: courseId }).sort({ createdAt: 1 }),
    ]);

    return res.json({
      config: {
        targetAssessmentId: config.targetAssessmentId
          ? String(config.targetAssessmentId)
          : "",
        syncEnabled: config.syncEnabled === true,
        lastSyncedAt: config.lastSyncedAt,
      },
      assessments: assessments.map((item) => ({
        id: String(item._id),
        title: item.title || item.name || "Untitled Assessment",
        marks: Number(item.totalMarks || item.fullMarks || item.marks || 0),
        structureType: item.structureType || "regular",
        labFinalMode: item.labFinalConfig?.mode || "",
      })),
    });
  } catch (err) {
    console.error("getTeacherProjectSyncState error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const saveTeacherProjectSyncConfig = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;
    const { targetAssessmentId, syncEnabled } = req.body;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const config = await getOrCreateSyncConfig(courseId);

    if (targetAssessmentId) {
      const assessment = await Assessment.findOne({
        _id: targetAssessmentId,
        course: courseId,
      });

      if (!assessment) {
        return res.status(404).json({ message: "Target assessment not found" });
      }

      config.targetAssessmentId = targetAssessmentId;
    } else {
      config.targetAssessmentId = null;
    }

    config.syncEnabled = syncEnabled === true;
    await config.save();

    return res.json({
      message: "Project sync configuration updated successfully",
      config: {
        targetAssessmentId: config.targetAssessmentId
          ? String(config.targetAssessmentId)
          : "",
        syncEnabled: config.syncEnabled === true,
        lastSyncedAt: config.lastSyncedAt,
      },
    });
  } catch (err) {
    console.error("saveTeacherProjectSyncConfig error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

async function syncIntoRegularAssessment({
  courseId,
  targetAssessment,
  totals,
}) {
  let syncedCount = 0;

  for (const item of totals) {
    const markValue = round2(item.syncedMarks || 0);

    let existingMark = await Mark.findOne({
      course: courseId,
      assessment: targetAssessment._id,
      student: item.studentId,
    });

    if (existingMark) {
      existingMark.obtainedMarks = markValue;
      existingMark.subMarks = [];
      await existingMark.save();
    } else {
      await Mark.create({
        course: courseId,
        assessment: targetAssessment._id,
        student: item.studentId,
        obtainedMarks: markValue,
        subMarks: [],
      });
    }

    syncedCount += 1;
  }

  return { syncedCount };
}

async function syncIntoAdvancedLabFinal({
  courseId,
  targetAssessment,
  totals,
  orderedProjectPhases,
}) {
  const projectTargets = getProjectAssessmentTargets(targetAssessment);

  if (!projectTargets.length) {
    const err = new Error(
      "Selected Advanced Lab Final has no project breakdown items to sync into"
    );
    err.status = 400;
    throw err;
  }

  if (orderedProjectPhases.length !== projectTargets.length) {
    const err = new Error(
      `Project phase count (${orderedProjectPhases.length}) does not match assessment project breakdown count (${projectTargets.length}). Please make them equal first.`
    );
    err.status = 400;
    throw err;
  }

  const mapping = orderedProjectPhases.map((phase, index) => ({
    phaseId: String(phase._id),
    phaseTitle: phase.title || `Phase ${index + 1}`,
    phaseMarks: Number(phase.totalMarks || 0),
    targetKey: projectTargets[index].key,
    targetLabel: projectTargets[index].label,
    targetMarks: Number(projectTargets[index].fullMarks || 0),
  }));

  let syncedCount = 0;

  for (const item of totals) {
    let existingMark = await Mark.findOne({
      course: courseId,
      assessment: targetAssessment._id,
      student: item.studentId,
    });

    const existingSubMarkMap = buildExistingSubMarkMap(existingMark?.subMarks || []);

    mapping.forEach((mapItem, index) => {
      existingSubMarkMap.set(
        String(mapItem.targetKey),
        round2(item.phaseScores[index] || 0)
      );
    });

    const nextSubMarks = Array.from(existingSubMarkMap.entries()).map(
      ([key, obtainedMarks]) => ({
        key,
        obtainedMarks: round2(obtainedMarks),
      })
    );

    const nextObtainedMarks = calculateLabFinalObtained(
      targetAssessment,
      nextSubMarks
    );

    if (existingMark) {
      existingMark.obtainedMarks = nextObtainedMarks;
      existingMark.subMarks = nextSubMarks;
      await existingMark.save();
    } else {
      await Mark.create({
        course: courseId,
        assessment: targetAssessment._id,
        student: item.studentId,
        obtainedMarks: nextObtainedMarks,
        subMarks: nextSubMarks,
      });
    }

    syncedCount += 1;
  }

  return { syncedCount, mapping };
}

const runProjectFinalSync = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const config = await getOrCreateSyncConfig(courseId);

    if (!config.syncEnabled) {
      return res.status(400).json({
        message: "Project mark sync is disabled",
      });
    }

    if (!config.targetAssessmentId) {
      return res.status(400).json({
        message: "Please select a target assessment first",
      });
    }

    const targetAssessment = await Assessment.findOne({
      _id: config.targetAssessmentId,
      course: courseId,
    });

    if (!targetAssessment) {
      return res.status(404).json({
        message: "Target assessment not found",
      });
    }

    const [phases, groups, enrollments, evaluations] = await Promise.all([
      ProjectPhase.find({ course: courseId }),
      ProjectGroup.find({ course: courseId }).populate("members", "_id"),
      Enrollment.find({ course: courseId }).populate("student", "_id name username"),
      ProjectEvaluation.find({ course: courseId })
        .populate("phase")
        .populate("group", "members")
        .populate("student", "_id"),
    ]);

    const matrix = buildStudentPhaseMatrix({
      phases,
      groups,
      enrollments,
      evaluations,
    });

    let syncMeta = { syncedCount: 0, mapping: [] };

    if (targetAssessment.structureType === "lab_final") {
      if (targetAssessment.labFinalConfig?.mode === "lab_exam_only") {
        return res.status(400).json({
          message:
            "Selected Advanced Lab Final is set to Lab Final Only. It has no project section to sync into.",
        });
      }

      syncMeta = await syncIntoAdvancedLabFinal({
        courseId,
        targetAssessment,
        totals: matrix.rows,
        orderedProjectPhases: matrix.orderedPhases,
      });
    } else {
      syncMeta = await syncIntoRegularAssessment({
        courseId,
        targetAssessment,
        totals: matrix.rows,
      });
    }

    config.lastSyncedAt = new Date();
    await config.save();

    return res.json({
      message:
        targetAssessment.structureType === "lab_final"
          ? "Project phase marks synced into advanced lab final breakdown successfully"
          : "Project totals synced successfully",
      syncedCount: syncMeta.syncedCount,
      targetAssessment: {
        id: String(targetAssessment._id),
        title: targetAssessment.title || targetAssessment.name || "Assessment",
        marks: Number(
          targetAssessment.totalMarks ||
            targetAssessment.fullMarks ||
            targetAssessment.marks ||
            0
        ),
        structureType: targetAssessment.structureType || "regular",
        labFinalMode: targetAssessment.labFinalConfig?.mode || "",
      },
      lastSyncedAt: config.lastSyncedAt,
      totals: matrix.rows,
      mapping: syncMeta.mapping || [],
    });
  } catch (err) {
    console.error("runProjectFinalSync error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const getStudentProjectTotalSummary = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const enrollment = await Enrollment.findOne({
      course: courseId,
      student: studentId,
    }).populate("course");

    if (!enrollment) {
      return res.status(403).json({
        message: "You are not enrolled in this course",
      });
    }

    if (enrollment?.course?.projectFeature?.mode !== "project") {
      return res.status(400).json({
        message: "Project workflow is not enabled for this course",
      });
    }

    const totals = await buildStudentProjectTotals(courseId);
    const mine = totals.find((item) => String(item.studentId) === String(studentId));

    return res.json({
      totalObtained: Number(mine?.obtained || 0),
      totalAvailable: Number(mine?.available || 0),
      syncedMarks: Number(mine?.syncedMarks || 0),
    });
  } catch (err) {
    console.error("getStudentProjectTotalSummary error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

module.exports = {
  getTeacherProjectSyncState,
  saveTeacherProjectSyncConfig,
  runProjectFinalSync,
  getStudentProjectTotalSummary,
};