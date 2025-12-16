// server/src/controllers/courseController.js

const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');
const Mark = require('../models/Mark');
// If you also track complaints per course, you can uncomment this
// and the delete block below.
// const Complaint = require('../models/Complaint');

const ALLOWED_COURSE_TYPES = ['theory', 'lab', 'hybrid'];

// POST /api/courses  (teacher only)
const createCourse = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { code, title, section, semester, year, courseType } = req.body;

    if (!code || !title || !section || !semester || !year) {
      return res
        .status(400)
        .json({ message: 'Missing required fields' });
    }

    const normalizedType = ALLOWED_COURSE_TYPES.includes(courseType)
      ? courseType
      : 'theory';

    const course = new Course({
      code,
      title,
      section,
      semester,
      year,
      courseType: normalizedType,
      createdBy: teacherId,
    });

    await course.save();

    // respond in the same "flat" format we use in getCourses
    res.json({
      id: course._id.toString(),
      code: course.code,
      title: course.title,
      section: course.section,
      semester: course.semester,
      year: course.year,
      courseType: course.courseType,
    });
  } catch (err) {
    console.error('Create course error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/courses  (teacher only – list own courses)
const getCourses = async (req, res) => {
  try {
    const teacherId = req.user.userId;

    const courses = await Course.find({ createdBy: teacherId })
      .sort({ year: -1, semester: 1, code: 1 });

    // Return a very clean, string-based payload
    const formatted = courses.map((c) => ({
      id: c._id.toString(),
      code: c.code,
      title: c.title,
      section: c.section,
      semester: c.semester,
      year: c.year,
      courseType: c.courseType,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Get courses error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/courses/:id  (teacher only)
const getCourseById = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const id = req.params.courseId || req.params.id;

    const course = await Course.findOne({ _id: id, createdBy: teacherId });

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json(course);
  } catch (err) {
    console.error('Get course error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/courses/:id  (optional)
const updateCourse = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const id = req.params.courseId || req.params.id;
    const { code, title, section, semester, year, courseType } = req.body;

    const update = {
      code,
      title,
      section,
      semester,
      year,
    };

    if (courseType && ALLOWED_COURSE_TYPES.includes(courseType)) {
      update.courseType = courseType;
    }

    const course = await Course.findOneAndUpdate(
      { _id: id, createdBy: teacherId },
      { $set: update },
      { new: true }
    );

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json(course);
  } catch (err) {
    console.error('Update course error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/courses/:id  (teacher only)
// Deletes the course AND all related students, assessments, marks.
const deleteCourse = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const id = req.params.courseId || req.params.id;

    const course = await Course.findOneAndDelete({
      _id: id,
      createdBy: teacherId,
    });

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const courseId = course._id;

    await Promise.all([
      Assessment.deleteMany({ course: courseId }),
      Enrollment.deleteMany({ course: courseId }),
      Mark.deleteMany({ course: courseId }),
      // Complaint && Complaint.deleteMany({ course: courseId }),
    ]);

    res.json({ message: 'Course and related data deleted' });
  } catch (err) {
    console.error('Delete course error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
};
