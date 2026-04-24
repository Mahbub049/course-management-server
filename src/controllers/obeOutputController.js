const Course = require('../models/Course');
const { buildOutputData } = require('../utils/obeCalculation');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const getObeOutput = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const data = await buildOutputData(courseId);
    return res.json(data);
  } catch (error) {
    console.error('getObeOutput error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getObeOutput,
};
