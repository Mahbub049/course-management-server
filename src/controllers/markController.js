const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

// GET /api/courses/:courseId/marks
// Returns all marks for that course
const getMarksForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const marks = await Mark.find({ course: courseId }).select(
      'student assessment obtainedMarks'
    );

    res.json(marks);
  } catch (err) {
    console.error('Get marks error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/courses/:courseId/marks
// body: { marks: [{ studentId, assessmentId, obtainedMarks }] }
const saveMarksForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { marks } = req.body;

    if (!Array.isArray(marks)) {
      return res.status(400).json({ message: 'marks must be an array' });
    }

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Accept both shapes:
    //  - { studentId, assessmentId, obtainedMarks }
    //  - { student,   assessment,   obtainedMarks }
    const cleaned = marks
      .map((m) => ({
        studentId: m.studentId || m.student,
        assessmentId: m.assessmentId || m.assessment,
        obtainedMarks: m.obtainedMarks,
      }))
      .filter(
        (m) =>
          m.studentId &&
          m.assessmentId &&
          m.obtainedMarks != null &&
          !Number.isNaN(Number(m.obtainedMarks))
      );

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
            obtainedMarks: Number(m.obtainedMarks),
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await Mark.bulkWrite(bulkOps);
    }

    res.json({ message: 'Marks saved successfully' });
  } catch (err) {
    console.error('Save marks error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getMarksForCourse,
  saveMarksForCourse,
};
