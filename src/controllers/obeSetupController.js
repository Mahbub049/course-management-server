const Course = require('../models/Course');
const CourseOutcome = require('../models/CourseOutcome');
const CourseObeConfig = require('../models/CourseObeConfig');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const cleanText = (value = '') => String(value || '').trim();
const cleanCode = (value = '') => cleanText(value).toUpperCase();

const normalizeOutcomeRows = (rows = [], prefix = '') => {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      code: cleanCode(row?.code || `${prefix}${index + 1}`),
      statement: cleanText(row?.statement),
      order: Number.isFinite(Number(row?.order)) ? Number(row.order) : index,
      isActive: row?.isActive !== false,
    }))
    .filter((row) => row.code && row.statement);
};

const normalizeAttainmentLevels = (levels = []) => {
  const normalized = (Array.isArray(levels) ? levels : [])
    .map((row) => ({
      min: Number(row?.min),
      max: Number(row?.max),
      level: Number(row?.level),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.min) &&
        Number.isFinite(row.max) &&
        Number.isFinite(row.level) &&
        row.min >= 0 &&
        row.max <= 100 &&
        row.min <= row.max
    )
    .sort((a, b) => b.min - a.min);

  return normalized.length
    ? normalized
    : [
        { min: 70, max: 100, level: 4 },
        { min: 60, max: 69.99, level: 3 },
        { min: 50, max: 59.99, level: 2 },
        { min: 40, max: 49.99, level: 1 },
        { min: 0, max: 39.99, level: 0 },
      ];
};

const normalizeMappings = (rows = []) => {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      coCode: cleanCode(row?.coCode),
      targetType: cleanCode(row?.targetType) === 'PSO' ? 'PSO' : 'PO',
      targetCode: cleanCode(row?.targetCode),
      strength: Number(row?.strength),
    }))
    .filter(
      (row) =>
        row.coCode &&
        row.targetCode &&
        [1, 2, 3].includes(row.strength)
    );
};

const getObeSetup = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const [courseOutcomes, config] = await Promise.all([
      CourseOutcome.find({ course: courseId }).sort({ order: 1, code: 1 }),
      CourseObeConfig.findOne({ course: courseId }),
    ]);

    return res.json({
      courseId,
      thresholdPercent: config?.thresholdPercent ?? 40,
      courseOutcomes,
      poStatements: config?.poStatements || [],
      psoStatements: config?.psoStatements || [],
      mappings: config?.mappings || [],
      attainmentLevels: config?.attainmentLevels || [],
      notes: config?.notes || '',
    });
  } catch (error) {
    console.error('getObeSetup error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const saveObeSetup = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      thresholdPercent = 40,
      courseOutcomes = [],
      poStatements = [],
      psoStatements = [],
      mappings = [],
      attainmentLevels = [],
      notes = '',
    } = req.body || {};

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const normalizedCOs = normalizeOutcomeRows(courseOutcomes, 'CO');
    const normalizedPOs = normalizeOutcomeRows(poStatements, 'PO');
    const normalizedPSOs = normalizeOutcomeRows(psoStatements, 'PSO');
    const normalizedMappings = normalizeMappings(mappings);
    const normalizedLevels = normalizeAttainmentLevels(attainmentLevels);

    if (!normalizedCOs.length) {
      return res.status(400).json({ message: 'At least one CO is required.' });
    }

    const coCodes = new Set(normalizedCOs.map((row) => row.code));
    const poCodes = new Set(normalizedPOs.map((row) => row.code));
    const psoCodes = new Set(normalizedPSOs.map((row) => row.code));

    const invalidMapping = normalizedMappings.find((row) => {
      if (!coCodes.has(row.coCode)) return true;
      if (row.targetType === 'PO') return !poCodes.has(row.targetCode);
      return !psoCodes.has(row.targetCode);
    });

    if (invalidMapping) {
      return res.status(400).json({
        message: `Invalid mapping detected for ${invalidMapping.coCode} -> ${invalidMapping.targetCode}.`,
      });
    }

    await CourseOutcome.deleteMany({ course: courseId });
    if (normalizedCOs.length) {
      await CourseOutcome.insertMany(
        normalizedCOs.map((row) => ({
          course: courseId,
          code: row.code,
          statement: row.statement,
          order: row.order,
          isActive: row.isActive,
        }))
      );
    }

    const config = await CourseObeConfig.findOneAndUpdate(
      { course: courseId },
      {
        $set: {
          course: courseId,
          thresholdPercent: Number(thresholdPercent) || 40,
          poStatements: normalizedPOs,
          psoStatements: normalizedPSOs,
          mappings: normalizedMappings,
          attainmentLevels: normalizedLevels,
          notes: cleanText(notes),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({
      message: 'OBE setup saved successfully.',
      config,
    });
  } catch (error) {
    console.error('saveObeSetup error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getObeSetup,
  saveObeSetup,
};
