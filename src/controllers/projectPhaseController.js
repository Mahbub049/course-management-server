const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectPhase = require("../models/ProjectPhase");

const cleanString = (value) => String(value || "").trim();

const cleanResourceLinks = (links = []) => {
  if (!Array.isArray(links)) return [];
  return links
    .map((item) => ({
      label: cleanString(item?.label),
      url: cleanString(item?.url),
    }))
    .filter((item) => item.url);
};

const normalizePhasePayload = (body = {}) => {
  const totalMarks = Number(body.totalMarks || 0);
  const order = Number(body.order || 0);

  return {
    title: cleanString(body.title),
    instructions: cleanString(body.instructions),
    phaseType: body.phaseType === "individual" ? "individual" : "group",
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    totalMarks: Number.isFinite(totalMarks) ? totalMarks : 0,
    order: Number.isFinite(order) ? order : 0,
    resourceLinks: cleanResourceLinks(body.resourceLinks),
    isVisibleToStudents: body.isVisibleToStudents !== false,
  };
};

const formatPhase = (phase) => ({
  id: String(phase._id),
  courseId: String(phase.course),
  title: phase.title || "",
  instructions: phase.instructions || "",
  phaseType: phase.phaseType || "group",
  dueDate: phase.dueDate,
  totalMarks: Number(phase.totalMarks || 0),
  order: Number(phase.order || 0),
  resourceLinks: Array.isArray(phase.resourceLinks) ? phase.resourceLinks : [],
  isVisibleToStudents: phase.isVisibleToStudents !== false,
  createdAt: phase.createdAt,
  updatedAt: phase.updatedAt,
});

const ensureTeacherCourseAccess = async (teacherId, courseId) => {
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
    const err = new Error("Project workflow is not enabled for this course");
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
    const err = new Error("Project workflow is not enabled for this course");
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

const resequenceCoursePhases = async (courseId) => {
  const phases = await ProjectPhase.find({ course: courseId }).sort({
    order: 1,
    createdAt: 1,
  });

  for (let i = 0; i < phases.length; i += 1) {
    phases[i].order = i + 1;
    await phases[i].save();
  }

  return phases;
};

const getTeacherProjectPhases = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phases = await ProjectPhase.find({ course: courseId }).sort({
      order: 1,
      createdAt: 1,
    });

    return res.json(phases.map(formatPhase));
  } catch (err) {
    console.error("getTeacherProjectPhases error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const createProjectPhase = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const payload = normalizePhasePayload(req.body);

    if (!payload.title) {
      return res.status(400).json({ message: "Phase title is required" });
    }

    const currentCount = await ProjectPhase.countDocuments({ course: courseId });

    const phase = await ProjectPhase.create({
      course: courseId,
      ...payload,
      order: currentCount + 1,
    });

    return res.status(201).json(formatPhase(phase));
  } catch (err) {
    console.error("createProjectPhase error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const updateProjectPhase = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, phaseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
    });

    if (!phase) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    const payload = normalizePhasePayload(req.body);

    if (!payload.title) {
      return res.status(400).json({ message: "Phase title is required" });
    }

    phase.title = payload.title;
    phase.instructions = payload.instructions;
    phase.phaseType = payload.phaseType;
    phase.dueDate = payload.dueDate;
    phase.totalMarks = payload.totalMarks;
    phase.resourceLinks = payload.resourceLinks;
    phase.isVisibleToStudents = payload.isVisibleToStudents;

    await phase.save();

    return res.json(formatPhase(phase));
  } catch (err) {
    console.error("updateProjectPhase error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const moveProjectPhase = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, phaseId } = req.params;
    const direction = cleanString(req.body.direction).toLowerCase();

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phases = await ProjectPhase.find({ course: courseId }).sort({
      order: 1,
      createdAt: 1,
    });

    const currentIndex = phases.findIndex((item) => String(item._id) === String(phaseId));
    if (currentIndex === -1) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    const targetIndex =
      direction === "up"
        ? currentIndex - 1
        : direction === "down"
        ? currentIndex + 1
        : currentIndex;

    if (targetIndex < 0 || targetIndex >= phases.length) {
      return res.json(phases.map(formatPhase));
    }

    const temp = phases[currentIndex];
    phases[currentIndex] = phases[targetIndex];
    phases[targetIndex] = temp;

    for (let i = 0; i < phases.length; i += 1) {
      phases[i].order = i + 1;
      await phases[i].save();
    }

    return res.json(phases.map(formatPhase));
  } catch (err) {
    console.error("moveProjectPhase error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const deleteProjectPhase = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, phaseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const deleted = await ProjectPhase.findOneAndDelete({
      _id: phaseId,
      course: courseId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    await resequenceCoursePhases(courseId);

    return res.json({ message: "Project phase deleted successfully" });
  } catch (err) {
    console.error("deleteProjectPhase error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const getStudentProjectPhases = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    await ensureStudentAccess(studentId, courseId);

    const phases = await ProjectPhase.find({
      course: courseId,
      isVisibleToStudents: true,
    }).sort({
      order: 1,
      createdAt: 1,
    });

    return res.json(phases.map(formatPhase));
  } catch (err) {
    console.error("getStudentProjectPhases error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

module.exports = {
  getTeacherProjectPhases,
  createProjectPhase,
  updateProjectPhase,
  moveProjectPhase,
  deleteProjectPhase,
  getStudentProjectPhases,
};