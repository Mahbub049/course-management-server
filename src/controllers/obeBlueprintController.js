const Course = require('../models/Course');
const CourseOutcome = require('../models/CourseOutcome');
const ObeAssessmentBlueprint = require('../models/ObeAssessmentBlueprint');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const cleanText = (value = '') => String(value || '').trim();
const cleanCode = (value = '') => cleanText(value).toUpperCase();
const round2 = (num) => Math.round(Number(num || 0) * 100) / 100;

const normalizeItems = (items = []) => {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      key: cleanText(item?.key || `q${index + 1}`),
      label: cleanText(item?.label || `Q${index + 1}`),
      marks: round2(item?.marks),
      coCode: cleanCode(item?.coCode),
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
    }))
    .filter((item) => item.key && item.label && item.coCode && item.marks >= 0);
};

const getObeBlueprints = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const blueprints = await ObeAssessmentBlueprint.find({ course: courseId }).sort({ order: 1, createdAt: 1 });
    return res.json(blueprints);
  } catch (error) {
    console.error('getObeBlueprints error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const createObeBlueprint = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      assessmentName,
      assessmentType = 'custom',
      totalMarks = 0,
      order = 0,
      items = [],
      notes = '',
    } = req.body || {};

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const normalizedItems = normalizeItems(items);
    if (!cleanText(assessmentName)) {
      return res.status(400).json({ message: 'assessmentName is required.' });
    }
    if (!normalizedItems.length) {
      return res.status(400).json({ message: 'At least one blueprint item is required.' });
    }

    const availableCOs = await CourseOutcome.find({ course: courseId }).select('code');
    const allowedCOCodes = new Set(availableCOs.map((row) => cleanCode(row.code)));

    const invalidItem = normalizedItems.find((item) => !allowedCOCodes.has(item.coCode));
    if (invalidItem) {
      return res.status(400).json({ message: `Invalid CO selected for item ${invalidItem.label}.` });
    }

    const itemTotal = round2(normalizedItems.reduce((sum, item) => sum + Number(item.marks || 0), 0));
    const requestedTotal = round2(totalMarks);

    if (requestedTotal !== itemTotal) {
      return res.status(400).json({
        message: `Total marks mismatch. Assessment total is ${requestedTotal}, but items add up to ${itemTotal}.`,
      });
    }

    const blueprint = await ObeAssessmentBlueprint.create({
      course: courseId,
      assessmentName: cleanText(assessmentName),
      assessmentType: cleanText(assessmentType).toLowerCase(),
      totalMarks: requestedTotal,
      order: Number(order) || 0,
      items: normalizedItems,
      notes: cleanText(notes),
    });

    return res.status(201).json(blueprint);
  } catch (error) {
    console.error('createObeBlueprint error', error);
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'Blueprint with this assessment name already exists.' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

const updateObeBlueprint = async (req, res) => {
  try {
    const { courseId, blueprintId } = req.params;
    const {
      assessmentName,
      assessmentType = 'custom',
      totalMarks = 0,
      order = 0,
      items = [],
      notes = '',
    } = req.body || {};

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const blueprint = await ObeAssessmentBlueprint.findOne({ _id: blueprintId, course: courseId });
    if (!blueprint) {
      return res.status(404).json({ message: 'Blueprint not found.' });
    }

    const normalizedItems = normalizeItems(items);
    if (!cleanText(assessmentName)) {
      return res.status(400).json({ message: 'assessmentName is required.' });
    }
    if (!normalizedItems.length) {
      return res.status(400).json({ message: 'At least one blueprint item is required.' });
    }

    const availableCOs = await CourseOutcome.find({ course: courseId }).select('code');
    const allowedCOCodes = new Set(availableCOs.map((row) => cleanCode(row.code)));

    const invalidItem = normalizedItems.find((item) => !allowedCOCodes.has(item.coCode));
    if (invalidItem) {
      return res.status(400).json({ message: `Invalid CO selected for item ${invalidItem.label}.` });
    }

    const itemTotal = round2(normalizedItems.reduce((sum, item) => sum + Number(item.marks || 0), 0));
    const requestedTotal = round2(totalMarks);

    if (requestedTotal !== itemTotal) {
      return res.status(400).json({
        message: `Total marks mismatch. Assessment total is ${requestedTotal}, but items add up to ${itemTotal}.`,
      });
    }

    blueprint.assessmentName = cleanText(assessmentName);
    blueprint.assessmentType = cleanText(assessmentType).toLowerCase();
    blueprint.totalMarks = requestedTotal;
    blueprint.order = Number(order) || 0;
    blueprint.items = normalizedItems;
    blueprint.notes = cleanText(notes);
    await blueprint.save();

    return res.json(blueprint);
  } catch (error) {
    console.error('updateObeBlueprint error', error);
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'Blueprint with this assessment name already exists.' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

const deleteObeBlueprint = async (req, res) => {
  try {
    const { courseId, blueprintId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const deleted = await ObeAssessmentBlueprint.findOneAndDelete({ _id: blueprintId, course: courseId });
    if (!deleted) {
      return res.status(404).json({ message: 'Blueprint not found.' });
    }

    return res.json({ message: 'Blueprint deleted successfully.' });
  } catch (error) {
    console.error('deleteObeBlueprint error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getObeBlueprints,
  createObeBlueprint,
  updateObeBlueprint,
  deleteObeBlueprint,
};
