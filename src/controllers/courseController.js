// server/src/controllers/courseController.js

const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');
const Mark = require('../models/Mark');
// If you also track complaints per course, you can uncomment this
// and the delete block below.
// const Complaint = require('../models/Complaint');

const ALLOWED_COURSE_TYPES = ['theory', 'lab', 'hybrid'];
const ALLOWED_CT_POLICY_MODES = [
  'best_n_individual_scaled',
  'best_n_average_scaled',
  'best_one_scaled',
  'manual_average_scaled',
];

const sanitizeProjectFeature = (raw = {}) => {
  const mode = raw?.mode === "project" ? "project" : "lab_final";

  const totalProjectMarksRaw = Number(raw?.totalProjectMarks);
  const totalProjectMarks =
    Number.isFinite(totalProjectMarksRaw) && totalProjectMarksRaw >= 0
      ? totalProjectMarksRaw
      : 40;

  return {
    mode,
    totalProjectMarks,
    allowStudentGroupCreation: raw?.allowStudentGroupCreation !== false,
    allowTeacherGroupEditing: raw?.allowTeacherGroupEditing !== false,
    visibleToStudents: raw?.visibleToStudents !== false,
  };
};

const sanitizeClassTestPolicy = (raw = {}) => {
  const mode = ALLOWED_CT_POLICY_MODES.includes(raw?.mode)
    ? raw.mode
    : 'best_n_average_scaled';

  const bestCountRaw = Number(raw?.bestCount);
  const totalWeightRaw = Number(raw?.totalWeight);

  const bestCount =
    mode === 'best_one_scaled'
      ? 1
      : Number.isFinite(bestCountRaw) && bestCountRaw > 0
        ? Math.floor(bestCountRaw)
        : 2;

  const totalWeight =
    Number.isFinite(totalWeightRaw) && totalWeightRaw >= 0
      ? totalWeightRaw
      : 15;

  const manualSelectedAssessmentIds = Array.isArray(raw?.manualSelectedAssessmentIds)
    ? raw.manualSelectedAssessmentIds
      .map((id) => String(id).trim())
      .filter(Boolean)
    : [];

  return {
    mode,
    bestCount,
    totalWeight,
    manualSelectedAssessmentIds,
  };
};

// POST /api/courses  (teacher only)
const createCourse = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { code, title, section, semester, year, courseType, projectFeature } = req.body;

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
      projectFeature: sanitizeProjectFeature(projectFeature),
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

    const archivedParam = req.query.archived;
    const archived = archivedParam === "true";

    let filter = { createdBy: teacherId };

    if (archived) {
      // Archived tab → only archived = true
      filter.archived = true;
    } else {
      // My Courses → archived = false OR field does not exist (old data)
      filter.$or = [
        { archived: false },
        { archived: { $exists: false } }
      ];
    }

    const courses = await Course.find(filter)
      .sort({ createdAt: -1 });

    const formatted = courses.map((c) => ({
      id: c._id.toString(),
      code: c.code,
      title: c.title,
      section: c.section,
      semester: c.semester,
      year: c.year,
      courseType: c.courseType,
      archived: c.archived ?? false,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("getCourses error:", err);
    res.status(500).json({ message: "Server error" });
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

    const {
      title,
      section,
      semester,
      year,
      courseType,
      archived,
      classTestPolicy,
      projectFeature,
    } = req.body;

    // ✅ build update dynamically (avoid undefined overwrite)
    const update = {};

    if (title !== undefined) update.title = String(title).trim();
    if (section !== undefined) update.section = String(section).trim();
    if (semester !== undefined) update.semester = String(semester).trim();
    if (year !== undefined) update.year = Number(year);

    if (courseType && ALLOWED_COURSE_TYPES.includes(courseType)) {
      update.courseType = String(courseType).toLowerCase();
    }

    if (classTestPolicy !== undefined) {
      update.classTestPolicy = sanitizeClassTestPolicy(classTestPolicy);
    }

    if (projectFeature !== undefined) {
      update.projectFeature = sanitizeProjectFeature(projectFeature);
    }

    if (archived !== undefined) {
      const isArchived = archived === true || archived === "true";
      update.archived = isArchived;
      update.archivedAt = isArchived ? new Date() : null;
    }

    // ✅ prevent empty title
    if ("title" in update && !update.title) {
      return res.status(400).json({ message: "Title is required." });
    }

    const course = await Course.findOneAndUpdate(
      { _id: id, createdBy: teacherId },
      { $set: update },
      { new: true }
    );

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    res.json(course);
  } catch (err) {
    console.error("Update course error", err);
    res.status(500).json({ message: "Server error" });
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
