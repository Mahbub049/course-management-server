const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectFormConfig = require("../models/ProjectFormConfig");

const DEFAULT_FIELDS = {
  groupName: {
    visibleToStudent: true,
    editableByStudent: false,
    requiredOnGroupCreate: true,
    requiredOnProjectUpdate: false,
  },
  projectTitle: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: true,
  },
  projectSummary: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: false,
  },
  driveLink: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: false,
  },
  repositoryLink: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: false,
  },
  contactEmail: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: false,
  },
  additionalNote: {
    visibleToStudent: true,
    editableByStudent: true,
    requiredOnGroupCreate: false,
    requiredOnProjectUpdate: false,
  },
};

const mergeProjectFields = (rawFields = {}) => {
  const merged = {};

  Object.keys(DEFAULT_FIELDS).forEach((key) => {
    merged[key] = {
      visibleToStudent:
        rawFields?.[key]?.visibleToStudent ??
        DEFAULT_FIELDS[key].visibleToStudent,

      editableByStudent:
        rawFields?.[key]?.editableByStudent ??
        DEFAULT_FIELDS[key].editableByStudent,

      requiredOnGroupCreate:
        rawFields?.[key]?.requiredOnGroupCreate ??
        DEFAULT_FIELDS[key].requiredOnGroupCreate,

      requiredOnProjectUpdate:
        rawFields?.[key]?.requiredOnProjectUpdate ??
        DEFAULT_FIELDS[key].requiredOnProjectUpdate,
    };
  });

  return merged;
};

const ensureTeacherAccess = async (teacherId, courseId) => {
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
    const err = new Error("Project workflow is not enabled");
    err.status = 400;
    throw err;
  }

  return course;
};

const ensureStudentAccess = async (studentId, courseId) => {
  const enrollment = await Enrollment.findOne({
    student: studentId,
    course: courseId,
  }).populate("course");

  if (!enrollment) {
    const err = new Error("You are not enrolled in this course");
    err.status = 403;
    throw err;
  }

  if (enrollment?.course?.projectFeature?.mode !== "project") {
    const err = new Error("Project workflow is not enabled");
    err.status = 400;
    throw err;
  }

  if (enrollment?.course?.projectFeature?.visibleToStudents === false) {
    const err = new Error("Project workflow is hidden for students");
    err.status = 403;
    throw err;
  }

  return enrollment.course;
};

const getOrCreateConfig = async (courseId) => {
  let config = await ProjectFormConfig.findOne({ course: courseId });

  if (!config) {
    config = await ProjectFormConfig.create({
      course: courseId,
      fields: mergeProjectFields(),
    });
  } else {
    config.fields = mergeProjectFields(config.fields || {});
    await config.save();
  }

  return config;
};

const getProjectFormConfig = async (req, res) => {
  try {
    const { courseId } = req.params;
    const teacherId = req.user.userId;

    await ensureTeacherAccess(teacherId, courseId);
    const config = await getOrCreateConfig(courseId);

    return res.json({
      ...config.toObject(),
      fields: mergeProjectFields(config.fields || {}),
    });
  } catch (err) {
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Server error" });
  }
};

const updateProjectFormConfig = async (req, res) => {
  try {
    const { courseId } = req.params;
    const teacherId = req.user.userId;
    const { fields } = req.body;

    await ensureTeacherAccess(teacherId, courseId);

    const config = await getOrCreateConfig(courseId);

    if (fields) {
      config.fields = mergeProjectFields(fields);
    } else {
      config.fields = mergeProjectFields(config.fields || {});
    }

    await config.save();

    return res.json({
      ...config.toObject(),
      fields: mergeProjectFields(config.fields || {}),
    });
  } catch (err) {
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Server error" });
  }
};

const getStudentProjectFormConfig = async (req, res) => {
  try {
    const { courseId } = req.params;
    const studentId = req.user.userId;

    await ensureStudentAccess(studentId, courseId);
    const config = await getOrCreateConfig(courseId);

    return res.json({
      ...config.toObject(),
      fields: mergeProjectFields(config.fields || {}),
    });
  } catch (err) {
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Server error" });
  }
};

module.exports = {
  getProjectFormConfig,
  updateProjectFormConfig,
  getStudentProjectFormConfig,
};