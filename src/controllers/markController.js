const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Mark = require('../models/Mark');

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function sumSubMarks(subMarks = []) {
  return round2(
    (subMarks || []).reduce((sum, item) => sum + Number(item?.obtainedMarks || 0), 0)
  );
}

// GET /api/courses/:courseId/marks
const getMarksForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const marks = await Mark.find({ course: courseId }).select(
      'student assessment obtainedMarks subMarks'
    );

    res.json(marks);
  } catch (err) {
    console.error('Get marks error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/courses/:courseId/marks
// body:
// {
//   marks: [
//     {
//       studentId,
//       assessmentId,
//       obtainedMarks,
//       subMarks?: [{ key, obtainedMarks }]
//     }
//   ]
// }
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

    const assessmentIds = marks
      .map((m) => m.assessmentId || m.assessment)
      .filter(Boolean);

    const assessments = await Assessment.find({
      _id: { $in: assessmentIds },
      course: courseId,
    });

    const assessmentMap = new Map(
      assessments.map((a) => [String(a._id), a])
    );

    const cleaned = marks
      .map((m) => {
        const studentId = m.studentId || m.student;
        const assessmentId = m.assessmentId || m.assessment;
        const assessment = assessmentMap.get(String(assessmentId));

        if (!studentId || !assessmentId || !assessment) return null;

        const rawSubMarks = Array.isArray(m.subMarks) ? m.subMarks : [];
        const subMarks = rawSubMarks
          .map((s) => ({
            key: String(s?.key || '').trim(),
            obtainedMarks: Number(s?.obtainedMarks || 0),
          }))
          .filter((s) => s.key);

        let obtainedMarks =
          m.obtainedMarks != null && !Number.isNaN(Number(m.obtainedMarks))
            ? Number(m.obtainedMarks)
            : 0;

        if (assessment.structureType === 'lab_final') {
          obtainedMarks = sumSubMarks(subMarks);
        }

        return {
          studentId,
          assessmentId,
          obtainedMarks: round2(obtainedMarks),
          subMarks,
        };
      })
      .filter(Boolean);

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
            subMarks: m.subMarks,
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