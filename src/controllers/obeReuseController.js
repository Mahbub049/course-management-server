const Course = require('../models/Course');
const CourseOutcome = require('../models/CourseOutcome');
const CourseObeConfig = require('../models/CourseObeConfig');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');
const ObeStudentMark = require('../models/ObeStudentMark');

const cleanText = (value = '') => String(value || '').trim();
const cleanCode = (value = '') => cleanText(value).toUpperCase();

const copyOutcomeRows = (rows = []) =>
  rows.map((row, index) => ({
    code: cleanCode(row.code),
    statement: cleanText(row.statement),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
    isActive: row.isActive !== false,
  }));

const copyStatementRows = (rows = []) =>
  rows.map((row, index) => ({
    code: cleanCode(row.code),
    statement: cleanText(row.statement),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
    isActive: row.isActive !== false,
  }));

const copyMappings = (rows = []) =>
  rows.map((row) => ({
    coCode: cleanCode(row.coCode),
    targetType: cleanCode(row.targetType) === 'PSO' ? 'PSO' : 'PO',
    targetCode: cleanCode(row.targetCode),
    strength: Number(row.strength),
  }));

const copyAttainmentLevels = (rows = []) =>
  rows.map((row) => ({
    min: Number(row.min),
    max: Number(row.max),
    level: Number(row.level),
  }));

const copyBlueprintDocument = (blueprint, targetCourseId) => ({
  course: targetCourseId,
  assessmentName: cleanText(blueprint.assessmentName),
  assessmentType: cleanText(blueprint.assessmentType).toLowerCase(),
  totalMarks: Number(blueprint.totalMarks || 0),
  order: Number.isFinite(Number(blueprint.order)) ? Number(blueprint.order) : 0,
  notes: cleanText(blueprint.notes),
  items: (blueprint.items || []).map((item, index) => ({
    key: cleanText(item.key || `q${index + 1}`),
    label: cleanText(item.label || `Q${index + 1}`),
    marks: Number(item.marks || 0),
    coCode: cleanCode(item.coCode),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
  })),
});

const findOwnedCourses = async ({ sourceCourseId, targetCourseId, teacherId }) => {
  const courses = await Course.find({
    _id: { $in: [sourceCourseId, targetCourseId] },
    createdBy: teacherId,
  }).select('_id code title intake section semester year archived');

  const byId = new Map(courses.map((course) => [String(course._id), course]));

  return {
    sourceCourse: byId.get(String(sourceCourseId)) || null,
    targetCourse: byId.get(String(targetCourseId)) || null,
  };
};

const reuseObeData = async (req, res) => {
  try {
    const { courseId: targetCourseId } = req.params;
    const {
      sourceCourseId,
      copySetup = true,
      copyBlueprints = true,
      blueprintMode = 'skip_duplicates',
    } = req.body || {};

    const shouldCopySetup = copySetup === true;
    const shouldCopyBlueprints = copyBlueprints === true;
    const normalizedBlueprintMode =
      blueprintMode === 'replace' ? 'replace' : 'skip_duplicates';

    if (!sourceCourseId) {
      return res.status(400).json({ message: 'Please select a source course.' });
    }

    if (String(sourceCourseId) === String(targetCourseId)) {
      return res.status(400).json({ message: 'Source and target courses must be different.' });
    }

    if (!shouldCopySetup && !shouldCopyBlueprints) {
      return res.status(400).json({
        message: 'Select at least one item to copy: OBE setup or assessment blueprints.',
      });
    }

    const { sourceCourse, targetCourse } = await findOwnedCourses({
      sourceCourseId,
      targetCourseId,
      teacherId: req.user.userId,
    });

    if (!targetCourse) {
      return res.status(404).json({ message: 'Target course not found.' });
    }

    if (!sourceCourse) {
      return res.status(404).json({
        message: 'Source course not found or it does not belong to your account.',
      });
    }

    const [sourceOutcomes, sourceConfig, sourceBlueprints, targetOutcomes, targetBlueprints] =
      await Promise.all([
        CourseOutcome.find({ course: sourceCourseId }).sort({ order: 1, code: 1 }).lean(),
        CourseObeConfig.findOne({ course: sourceCourseId }).lean(),
        ObeAssessmentBlueprint.find({ course: sourceCourseId })
          .sort({ order: 1, createdAt: 1 })
          .lean(),
        CourseOutcome.find({ course: targetCourseId }).sort({ order: 1, code: 1 }).lean(),
        ObeAssessmentBlueprint.find({ course: targetCourseId })
          .sort({ order: 1, createdAt: 1 })
          .lean(),
      ]);

    if (shouldCopySetup && (!sourceOutcomes.length || !sourceConfig)) {
      return res.status(400).json({
        message: 'The selected source course does not have a saved OBE setup to copy.',
      });
    }

    if (shouldCopyBlueprints && !sourceBlueprints.length) {
      return res.status(400).json({
        message: 'The selected source course does not have any assessment blueprints to copy.',
      });
    }

    const resultingCoCodes = new Set(
      (shouldCopySetup ? sourceOutcomes : targetOutcomes).map((row) => cleanCode(row.code))
    );

    if (shouldCopyBlueprints) {
      const invalidSourceBlueprint = sourceBlueprints.find((blueprint) =>
        (blueprint.items || []).some((item) => !resultingCoCodes.has(cleanCode(item.coCode)))
      );

      if (invalidSourceBlueprint) {
        return res.status(400).json({
          message: shouldCopySetup
            ? `The source blueprint "${invalidSourceBlueprint.assessmentName}" contains a CO that is missing from its own OBE setup.`
            : `The target course does not contain every CO required by "${invalidSourceBlueprint.assessmentName}". Copy the OBE setup together with the blueprints.`,
        });
      }
    }

    if (shouldCopySetup && targetBlueprints.length && normalizedBlueprintMode !== 'replace') {
      const incompatibleTargetBlueprint = targetBlueprints.find((blueprint) =>
        (blueprint.items || []).some((item) => !resultingCoCodes.has(cleanCode(item.coCode)))
      );

      if (incompatibleTargetBlueprint) {
        return res.status(400).json({
          message:
            `The existing target blueprint "${incompatibleTargetBlueprint.assessmentName}" uses a CO that is not available in the copied setup. ` +
            'Select Assessment Blueprints and choose Replace all target blueprints.',
        });
      }
    }

    let copiedSetup = false;
    let copiedBlueprintCount = 0;
    let skippedBlueprintCount = 0;
    let clearedMarkCount = 0;

    if (shouldCopySetup) {
      const outcomeRows = copyOutcomeRows(sourceOutcomes);

      await CourseOutcome.deleteMany({ course: targetCourseId });
      await CourseOutcome.insertMany(
        outcomeRows.map((row) => ({ ...row, course: targetCourseId }))
      );

      await CourseObeConfig.findOneAndUpdate(
        { course: targetCourseId },
        {
          $set: {
            course: targetCourseId,
            thresholdPercent: Number(sourceConfig.thresholdPercent ?? 40),
            poStatements: copyStatementRows(sourceConfig.poStatements || []),
            psoStatements: copyStatementRows(sourceConfig.psoStatements || []),
            mappings: copyMappings(sourceConfig.mappings || []),
            attainmentLevels: copyAttainmentLevels(sourceConfig.attainmentLevels || []),
            notes: cleanText(sourceConfig.notes),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      copiedSetup = true;
    }

    if (shouldCopyBlueprints) {
      let blueprintsToInsert = sourceBlueprints;

      if (normalizedBlueprintMode === 'replace') {
        const markDeleteResult = await ObeStudentMark.deleteMany({ course: targetCourseId });
        clearedMarkCount = Number(markDeleteResult.deletedCount || 0);
        await ObeAssessmentBlueprint.deleteMany({ course: targetCourseId });
      } else {
        const existingNames = new Set(
          targetBlueprints.map((row) => cleanText(row.assessmentName).toLowerCase())
        );

        blueprintsToInsert = sourceBlueprints.filter(
          (row) => !existingNames.has(cleanText(row.assessmentName).toLowerCase())
        );
        skippedBlueprintCount = sourceBlueprints.length - blueprintsToInsert.length;
      }

      if (blueprintsToInsert.length) {
        await ObeAssessmentBlueprint.insertMany(
          blueprintsToInsert.map((blueprint) =>
            copyBlueprintDocument(blueprint, targetCourseId)
          )
        );
      }

      copiedBlueprintCount = blueprintsToInsert.length;
    }

    return res.json({
      message: 'OBE data reused successfully.',
      sourceCourse: {
        id: String(sourceCourse._id),
        code: sourceCourse.code,
        title: sourceCourse.title,
        intake: sourceCourse.intake || '',
        section: sourceCourse.section || '',
        semester: sourceCourse.semester || '',
        year: sourceCourse.year || '',
      },
      result: {
        copiedSetup,
        copiedBlueprintCount,
        skippedBlueprintCount,
        clearedMarkCount,
        blueprintMode: normalizedBlueprintMode,
      },
    });
  } catch (error) {
    console.error('reuseObeData error', error);

    if (error?.code === 11000) {
      return res.status(400).json({
        message: 'A blueprint with the same assessment name already exists in the target course.',
      });
    }

    return res.status(500).json({ message: 'Server error while reusing OBE data.' });
  }
};

module.exports = {
  reuseObeData,
};
