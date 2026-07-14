const Course = require("../models/Course");
const Assessment = require("../models/Assessment");
const Mark = require("../models/Mark");
const Enrollment = require("../models/Enrollment");
const ObeAssessmentBlueprint = require("../models/ObeAssessmentBlueprint");
const ObeStudentMark = require("../models/ObeStudentMark");
const { getNotebookTargetLocks } = require("../utils/notebookMarkSync");

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function isHalfStepMark(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) return false;

  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
}

function sumSubMarks(subMarks = []) {
  return round2(
    (subMarks || []).reduce(
      (sum, item) => sum + Number(item?.obtainedMarks || 0),
      0
    )
  );
}

function getStructuredAssessmentItems(assessment, mappedComponentKeys = new Set()) {
  const config = assessment?.labFinalConfig || {};
  const mode = config.mode;
  const items = [];

  if (mode === "components") {
    (config.genericComponents || []).forEach((component) => {
      if (!component?.key) return;
      items.push({
        key: String(component.key),
        fullMarks: Number(component.marks || 0),
        readOnly:
          mappedComponentKeys.has(String(component.key)) ||
          component.sourceType === "submission",
      });
    });
    return items;
  }

  if (mode === "project_only" || mode === "mixed") {
    (config.projectComponents || []).forEach((component) => {
      if (component.entryMode === "phased") {
        (component.phases || []).forEach((phase) => {
          if (!phase?.key) return;
          items.push({
            key: String(phase.key),
            fullMarks: Number(phase.marks || 0),
            readOnly: false,
          });
        });
      } else if (component?.key) {
        items.push({
          key: String(component.key),
          fullMarks: Number(component.marks || 0),
          readOnly: false,
        });
      }
    });
  }

  if (mode === "lab_exam_only" || mode === "mixed") {
    (config.examQuestions || []).forEach((question) => {
      if (!question?.key) return;
      items.push({
        key: String(question.key),
        fullMarks: Number(question.marks || 0),
        readOnly: false,
      });
    });
  }

  return items;
}

function normalizeMarkStatus(value) {
  const status = String(value || "").trim().toLowerCase();

  if (status === "a" || status === "absent") return "absent";
  if (status === "i" || status === "incomplete") return "incomplete";

  return "present";
}


function normalizeAssessmentText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bterm\b/g, " ")
    .replace(/\bexam(?:ination)?\b/g, " ")
    .replace(/\bclass\s*test\b/g, " ct ")
    .replace(/\bquiz\b/g, " ct ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAssessmentCategory(rawName = "", explicitType = "") {
  const type = String(explicitType || "").trim().toLowerCase();
  if (["ct", "assignment", "mid", "final", "attendance"].includes(type)) {
    return type;
  }

  const name = normalizeAssessmentText(rawName);

  if (/\b(attendance|att)\b/.test(name)) return "attendance";
  if (/\bassignment\b/.test(name)) return "assignment";
  if (/\bmid\b/.test(name)) return "mid";
  if (/\bfinal\b/.test(name)) return "final";
  if (/\b(class test|ct|quiz)\b/.test(name)) return "ct";

  return "other";
}

function sameMarks(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) < 1e-9;
}

function buildObeAssessmentMatches(blueprints = [], assessments = []) {
  const orderedBlueprints = [...blueprints].sort((a, b) => {
    const orderA = Number(a?.order ?? 0);
    const orderB = Number(b?.order ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0);
  });

  const usableAssessments = assessments.filter(
    (assessment) => assessment?.structureType !== "lab_final"
  );

  const matches = [];
  const skipped = [];
  const handledBlueprintIds = new Set();
  const usedAssessmentIds = new Set();

  const addMatch = (blueprint, assessment, matchMethod) => {
    matches.push({ blueprint, assessment, matchMethod });
    handledBlueprintIds.add(String(blueprint._id));
    usedAssessmentIds.add(String(assessment._id));
  };

  const addSkipped = (blueprint, reason) => {
    skipped.push({
      blueprintId: String(blueprint._id),
      blueprintName: blueprint.assessmentName,
      blueprintType: blueprint.assessmentType,
      totalMarks: Number(blueprint.totalMarks || 0),
      reason,
    });
    handledBlueprintIds.add(String(blueprint._id));
  };

  // First preference: same normalized name and same full marks.
  for (const blueprint of orderedBlueprints) {
    const blueprintName = normalizeAssessmentText(blueprint.assessmentName);
    const exactNameCandidates = usableAssessments.filter(
      (assessment) =>
        !usedAssessmentIds.has(String(assessment._id)) &&
        normalizeAssessmentText(assessment.name) === blueprintName
    );

    const exactMatch = exactNameCandidates.find((assessment) =>
      sameMarks(assessment.fullMarks, blueprint.totalMarks)
    );

    if (exactMatch) {
      addMatch(blueprint, exactMatch, "name_and_marks");
      continue;
    }

    if (exactNameCandidates.length > 0) {
      addSkipped(
        blueprint,
        `A marksheet field with the same name exists, but its full marks do not match ${Number(
          blueprint.totalMarks || 0
        )}.`
      );
    }
  }

  // Second preference: unique type + same full marks for standard theory components.
  for (const category of ["mid", "final", "assignment", "attendance"]) {
    const pendingBlueprints = orderedBlueprints.filter(
      (blueprint) =>
        !handledBlueprintIds.has(String(blueprint._id)) &&
        getAssessmentCategory(blueprint.assessmentName, blueprint.assessmentType) === category
    );

    const availableAssessments = usableAssessments.filter(
      (assessment) =>
        !usedAssessmentIds.has(String(assessment._id)) &&
        getAssessmentCategory(assessment.name) === category
    );

    for (const blueprint of pendingBlueprints) {
      const candidates = availableAssessments.filter(
        (assessment) =>
          !usedAssessmentIds.has(String(assessment._id)) &&
          sameMarks(assessment.fullMarks, blueprint.totalMarks)
      );

      if (candidates.length !== 1) continue;

      const candidate = candidates[0];
      const competingBlueprints = pendingBlueprints.filter(
        (otherBlueprint) =>
          !handledBlueprintIds.has(String(otherBlueprint._id)) &&
          sameMarks(otherBlueprint.totalMarks, candidate.fullMarks)
      );

      if (competingBlueprints.length === 1) {
        addMatch(blueprint, candidate, "type_and_marks");
      }
    }
  }

  // CT names should usually match exactly. Allow a type fallback only when both sides are unique.
  const remainingCtBlueprints = orderedBlueprints.filter(
    (blueprint) =>
      !handledBlueprintIds.has(String(blueprint._id)) &&
      getAssessmentCategory(blueprint.assessmentName, blueprint.assessmentType) === "ct"
  );
  const remainingCtAssessments = usableAssessments.filter(
    (assessment) =>
      !usedAssessmentIds.has(String(assessment._id)) &&
      getAssessmentCategory(assessment.name) === "ct"
  );

  if (remainingCtBlueprints.length === 1 && remainingCtAssessments.length === 1) {
    const blueprint = remainingCtBlueprints[0];
    const assessment = remainingCtAssessments[0];

    if (sameMarks(assessment.fullMarks, blueprint.totalMarks)) {
      addMatch(blueprint, assessment, "unique_ct_type_and_marks");
    }
  }

  for (const blueprint of orderedBlueprints) {
    if (handledBlueprintIds.has(String(blueprint._id))) continue;

    const category = getAssessmentCategory(
      blueprint.assessmentName,
      blueprint.assessmentType
    );

    const sameTypeFields = usableAssessments.filter(
      (assessment) =>
        !usedAssessmentIds.has(String(assessment._id)) &&
        getAssessmentCategory(assessment.name) === category
    );

    const sameMarkFields = sameTypeFields.filter((assessment) =>
      sameMarks(assessment.fullMarks, blueprint.totalMarks)
    );

    if (sameMarkFields.length > 1) {
      addSkipped(
        blueprint,
        "More than one marksheet field could match this OBE assessment. Rename the fields so the names are identical."
      );
    } else if (sameTypeFields.length > 0) {
      addSkipped(
        blueprint,
        "No unused marksheet field has both a matching assessment type and matching full marks."
      );
    } else {
      addSkipped(
        blueprint,
        "No corresponding marksheet assessment was found. Create the marksheet field first or use the same assessment name."
      );
    }
  }

  return { matches, skipped };
}

const getMarksForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const marks = await Mark.find({ course: courseId }).select(
      "student assessment obtainedMarks subMarks status"
    );

    res.json(marks);
  } catch (err) {
    console.error("Get marks error", err);
    res.status(500).json({ message: "Server error" });
  }
};

const saveMarksForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { marks } = req.body;

    if (!Array.isArray(marks)) {
      return res.status(400).json({ message: "marks must be an array" });
    }

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const assessmentIds = marks
      .map((m) => m.assessmentId || m.assessment)
      .filter(Boolean);

    const assessments = await Assessment.find({
      _id: { $in: assessmentIds },
      course: courseId,
    });

    const assessmentMap = new Map(assessments.map((a) => [String(a._id), a]));
    const [mappedSubmissionAssessments, notebookMappings] = await Promise.all([
      Assessment.find({
        course: courseId,
        structureType: "lab_submission",
        "submissionConfig.linkedMarkAssessment": { $in: assessmentIds },
      }).select(
        "submissionConfig.linkedMarkAssessment submissionConfig.linkedMarkComponentKey"
      ),
      getNotebookTargetLocks(courseId, {
        targetAssessmentIds: assessmentIds,
      }),
    ]);

    const mappedKeysByAssessment = new Map();
    const directLockedAssessmentIds = new Set();

    mappedSubmissionAssessments.forEach((sourceAssessment) => {
      const targetId = String(
        sourceAssessment?.submissionConfig?.linkedMarkAssessment || ""
      );
      const componentKey = String(
        sourceAssessment?.submissionConfig?.linkedMarkComponentKey || ""
      );
      if (!targetId) return;
      if (!componentKey) {
        directLockedAssessmentIds.add(targetId);
        return;
      }
      if (!mappedKeysByAssessment.has(targetId)) {
        mappedKeysByAssessment.set(targetId, new Set());
      }
      mappedKeysByAssessment.get(targetId).add(componentKey);
    });

    notebookMappings.forEach((mapping) => {
      const targetId = String(mapping?.targetAssessment || "");
      const componentKey = String(mapping?.targetComponentKey || "");
      if (!targetId) return;
      if (!componentKey) {
        directLockedAssessmentIds.add(targetId);
        return;
      }
      if (!mappedKeysByAssessment.has(targetId)) {
        mappedKeysByAssessment.set(targetId, new Set());
      }
      mappedKeysByAssessment.get(targetId).add(componentKey);
    });
    const studentIds = marks
      .map((m) => m.studentId || m.student)
      .filter(Boolean);
    const existingMarks = await Mark.find({
      course: courseId,
      assessment: { $in: assessmentIds },
      student: { $in: studentIds },
    }).select("student assessment obtainedMarks subMarks status");
    const existingMarkMap = new Map(
      existingMarks.map((mark) => [
        `${String(mark.student)}:${String(mark.assessment)}`,
        mark,
      ])
    );

    const cleaned = marks
      .map((m) => {
        const studentId = m.studentId || m.student;
        const assessmentId = m.assessmentId || m.assessment;
        const assessment = assessmentMap.get(String(assessmentId));

        if (!studentId || !assessmentId || !assessment) return null;

        if (
          assessment.structureType !== "lab_final" &&
          directLockedAssessmentIds.has(String(assessmentId))
        ) {
          const existingMark = existingMarkMap.get(
            `${String(studentId)}:${String(assessmentId)}`
          );

          if (!existingMark) return null;

          return {
            studentId,
            assessmentId,
            obtainedMarks: round2(existingMark.obtainedMarks || 0),
            status: normalizeMarkStatus(existingMark.status),
            subMarks: Array.isArray(existingMark.subMarks)
              ? existingMark.subMarks.map((item) => ({
                  key: String(item?.key || ""),
                  obtainedMarks: Number(item?.obtainedMarks || 0),
                }))
              : [],
          };
        }

        const rawStatus =
          String(m?.obtainedMarks || "").trim().toUpperCase() === "A"
            ? "absent"
            : m.status;

        const status = normalizeMarkStatus(rawStatus);

        const rawSubMarks = Array.isArray(m.subMarks) ? m.subMarks : [];
        let subMarks = rawSubMarks
          .map((s) => ({
            key: String(s?.key || "").trim(),
            obtainedMarks: Number(s?.obtainedMarks || 0),
          }))
          .filter((s) => s.key);

        if (assessment.structureType === "lab_final") {
          const requestedMap = new Map(
            subMarks.map((item) => [String(item.key), Number(item.obtainedMarks || 0)])
          );
          const existingMark = existingMarkMap.get(
            `${String(studentId)}:${String(assessmentId)}`
          );
          const existingSubMarkMap = new Map(
            (existingMark?.subMarks || []).map((item) => [
              String(item.key),
              Number(item.obtainedMarks || 0),
            ])
          );

          subMarks = getStructuredAssessmentItems(
            assessment,
            mappedKeysByAssessment.get(String(assessmentId)) || new Set()
          ).map((item) => {
            const requestedValue = requestedMap.has(item.key)
              ? requestedMap.get(item.key)
              : existingSubMarkMap.get(item.key) || 0;
            const obtainedMarks = item.readOnly
              ? existingSubMarkMap.get(item.key) || 0
              : requestedValue;

            return {
              key: item.key,
              obtainedMarks: Number(obtainedMarks || 0),
            };
          });
        }

        let obtainedMarks =
          m.obtainedMarks != null && !Number.isNaN(Number(m.obtainedMarks))
            ? Number(m.obtainedMarks)
            : 0;

        if (status !== "present") {
          obtainedMarks = 0;
        } else if (assessment.structureType === "lab_final") {
          obtainedMarks = sumSubMarks(subMarks);
        }

        return {
          studentId,
          assessmentId,
          obtainedMarks: round2(obtainedMarks),
          status,
          subMarks: status === "present" ? subMarks : [],
        };
      })
      .filter(Boolean);

    const invalidMark = cleaned.find((m) => {
      if (!isHalfStepMark(m.obtainedMarks)) return true;

      return (m.subMarks || []).some(
        (item) => !isHalfStepMark(item.obtainedMarks)
      );
    });

    if (invalidMark) {
      return res.status(400).json({
        message: "Marks must be whole numbers or .5 values only.",
      });
    }

    const invalidStructuredSubMark = cleaned.find((mark) => {
      const assessment = assessmentMap.get(String(mark.assessmentId));
      if (assessment?.structureType !== "lab_final") return false;

      const limits = new Map(
        getStructuredAssessmentItems(
          assessment,
          mappedKeysByAssessment.get(String(mark.assessmentId)) || new Set()
        ).map((item) => [
          item.key,
          Number(item.fullMarks || 0),
        ])
      );

      return (mark.subMarks || []).some((item) => {
        const limit = limits.get(String(item.key));
        const value = Number(item.obtainedMarks || 0);
        return limit == null || value < 0 || value > limit;
      });
    });

    if (invalidStructuredSubMark) {
      return res.status(400).json({
        message: "A structured breakdown mark is outside its allowed full marks.",
      });
    }

    const overFullMark = cleaned.find((m) => {
      const assessment = assessmentMap.get(String(m.assessmentId));
      const fullMarks = Number(assessment?.fullMarks || 0);

      if (fullMarks > 0 && Number(m.obtainedMarks || 0) > fullMarks) {
        return true;
      }

      return false;
    });

    if (overFullMark) {
      return res.status(400).json({
        message: "Marks cannot be greater than assessment full marks.",
      });
    }

    const bulkOps = cleaned.map((m) => ({
      updateOne: {
        filter: {
          course: courseId,
          student: m.studentId,
          assessment: m.assessmentId,
        },
        update: {
          $set: {
            course: courseId,
            student: m.studentId,
            assessment: m.assessmentId,
            obtainedMarks: m.obtainedMarks,
            status: m.status,
            subMarks: m.subMarks,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await Mark.bulkWrite(bulkOps);
    }

    res.json({ message: "Marks saved successfully" });
  } catch (err) {
    console.error("Save marks error", err);
    res.status(500).json({ message: "Server error" });
  }
};



const syncMarksFromObe = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const courseType = String(course.courseType || "theory").toLowerCase();
    if (courseType !== "theory") {
      return res.status(400).json({
        message: "OBE-to-marksheet fetching is currently available for theory courses only.",
      });
    }

    const [assessments, blueprints, enrollments] = await Promise.all([
      Assessment.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
      ObeAssessmentBlueprint.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
      Enrollment.find({ course: courseId }).select("student"),
    ]);

    if (!blueprints.length) {
      return res.status(400).json({
        message: "No OBE assessment blueprint was found for this course.",
      });
    }

    if (!assessments.length) {
      return res.status(400).json({
        message: "No marksheet assessment field was found for this course.",
      });
    }

    const { matches, skipped } = buildObeAssessmentMatches(
      blueprints,
      assessments
    );

    if (!matches.length) {
      return res.status(400).json({
        message:
          "No OBE assessment could be matched with a marksheet field. Assessment name/type and full marks must correspond.",
        importedRecords: 0,
        matchedAssessments: [],
        skippedBlueprints: skipped,
      });
    }

    const enrolledStudentIds = new Set(
      enrollments.map((row) => String(row.student))
    );
    const blueprintIds = matches.map(({ blueprint }) => blueprint._id);

    const obeMarks = await ObeStudentMark.find({
      course: courseId,
      blueprint: { $in: blueprintIds },
      student: { $in: [...enrolledStudentIds] },
    }).select("student blueprint totalMarks");

    const matchByBlueprintId = new Map(
      matches.map((match) => [String(match.blueprint._id), match])
    );
    const importedCountByBlueprintId = new Map(
      matches.map((match) => [String(match.blueprint._id), 0])
    );

    const bulkOps = [];

    for (const obeMark of obeMarks) {
      const studentId = String(obeMark.student);
      if (!enrolledStudentIds.has(studentId)) continue;

      const match = matchByBlueprintId.get(String(obeMark.blueprint));
      if (!match) continue;

      const obtainedMarks = round2(obeMark.totalMarks);
      const assessmentFullMarks = Number(match.assessment.fullMarks || 0);

      if (
        !Number.isFinite(obtainedMarks) ||
        obtainedMarks < 0 ||
        obtainedMarks > assessmentFullMarks
      ) {
        return res.status(400).json({
          message: `${match.blueprint.assessmentName} contains a total that is outside the matched marksheet field limit.`,
        });
      }

      bulkOps.push({
        updateOne: {
          filter: {
            course: courseId,
            student: obeMark.student,
            assessment: match.assessment._id,
          },
          update: {
            $set: {
              course: courseId,
              student: obeMark.student,
              assessment: match.assessment._id,
              obtainedMarks,
              status: "present",
              subMarks: [],
            },
          },
          upsert: true,
        },
      });

      const blueprintId = String(match.blueprint._id);
      importedCountByBlueprintId.set(
        blueprintId,
        Number(importedCountByBlueprintId.get(blueprintId) || 0) + 1
      );
    }

    if (bulkOps.length > 0) {
      await Mark.bulkWrite(bulkOps, { ordered: false });
    }

    const matchedAssessments = matches.map(
      ({ blueprint, assessment, matchMethod }) => ({
        blueprintId: String(blueprint._id),
        blueprintName: blueprint.assessmentName,
        assessmentId: String(assessment._id),
        assessmentName: assessment.name,
        fullMarks: Number(assessment.fullMarks || 0),
        matchMethod,
        importedStudents: Number(
          importedCountByBlueprintId.get(String(blueprint._id)) || 0
        ),
      })
    );

    const matchedWithoutSavedMarks = matchedAssessments
      .filter((row) => row.importedStudents === 0)
      .map((row) => ({
        blueprintId: row.blueprintId,
        blueprintName: row.blueprintName,
        blueprintType: getAssessmentCategory(row.blueprintName),
        totalMarks: row.fullMarks,
        reason: "The assessment matched, but no saved OBE student marks were found.",
      }));

    return res.json({
      message:
        bulkOps.length > 0
          ? `${bulkOps.length} student assessment total(s) were fetched from OBE/CO-PO. Existing values in matched marksheet fields were replaced.`
          : "Assessment fields matched, but there were no saved OBE student marks to import.",
      importedRecords: bulkOps.length,
      matchedAssessments,
      skippedBlueprints: [...skipped, ...matchedWithoutSavedMarks],
    });
  } catch (err) {
    console.error("Sync marks from OBE error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getMarksForCourse,
  saveMarksForCourse,
  syncMarksFromObe,
};