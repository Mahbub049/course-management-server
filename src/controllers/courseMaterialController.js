const Course = require("../models/Course");
const CourseMaterial = require("../models/CourseMaterial");
const Enrollment = require("../models/Enrollment");

function isGoogleDriveLike(url = "") {
  const value = String(url).toLowerCase();
  return (
    value.includes("drive.google.com") ||
    value.includes("docs.google.com") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

// ==============================
// Teacher: get materials of a course
// GET /api/courses/:courseId/materials
// ==============================
const getTeacherCourseMaterials = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const materials = await CourseMaterial.find({
      course: courseId,
      createdBy: teacherId,
    }).sort({ sortOrder: 1, createdAt: -1 });

    res.json(materials);
  } catch (err) {
    console.error("getTeacherCourseMaterials error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// Teacher: create material
// POST /api/courses/:courseId/materials
// ==============================
const createCourseMaterial = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const {
      title,
      topic,
      description,
      driveLink,
      fileType,
      visibleToStudents,
      sortOrder,
    } = req.body;

    if (!title || !driveLink) {
      return res.status(400).json({ message: "Title and drive link are required." });
    }

    if (!isGoogleDriveLike(driveLink)) {
      return res.status(400).json({ message: "Please provide a valid Google Drive or web link." });
    }

    const material = await CourseMaterial.create({
      course: courseId,
      createdBy: teacherId,
      title: String(title).trim(),
      topic: topic ? String(topic).trim() : "",
      description: description ? String(description).trim() : "",
      driveLink: String(driveLink).trim(),
      fileType: fileType || "google_slide",
      visibleToStudents:
        visibleToStudents === false || visibleToStudents === "false" ? false : true,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    });

    res.status(201).json(material);
  } catch (err) {
    console.error("createCourseMaterial error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// Teacher: update material
// PUT /api/courses/materials/:materialId
// ==============================
const updateCourseMaterial = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { materialId } = req.params;

    const material = await CourseMaterial.findOne({
      _id: materialId,
      createdBy: teacherId,
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    const {
      title,
      topic,
      description,
      driveLink,
      fileType,
      visibleToStudents,
      sortOrder,
    } = req.body;

    if (title !== undefined) material.title = String(title).trim();
    if (topic !== undefined) material.topic = String(topic).trim();
    if (description !== undefined) material.description = String(description).trim();

    if (driveLink !== undefined) {
      if (!isGoogleDriveLike(driveLink)) {
        return res.status(400).json({ message: "Please provide a valid Google Drive or web link." });
      }
      material.driveLink = String(driveLink).trim();
    }

    if (fileType !== undefined) material.fileType = fileType;
    if (visibleToStudents !== undefined) {
      material.visibleToStudents =
        visibleToStudents === false || visibleToStudents === "false" ? false : true;
    }
    if (sortOrder !== undefined) {
      material.sortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0;
    }

    await material.save();
    res.json(material);
  } catch (err) {
    console.error("updateCourseMaterial error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// Teacher: delete material
// DELETE /api/courses/materials/:materialId
// ==============================
const deleteCourseMaterial = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { materialId } = req.params;

    const material = await CourseMaterial.findOneAndDelete({
      _id: materialId,
      createdBy: teacherId,
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    res.json({ message: "Material deleted successfully." });
  } catch (err) {
    console.error("deleteCourseMaterial error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ==============================
// Student: get visible materials
// GET /api/student/courses/:courseId/materials
// ==============================
const getStudentCourseMaterials = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const enrollment = await Enrollment.findOne({
      student: studentId,
      course: courseId,
    }).populate("course");

    if (!enrollment || !enrollment.course || enrollment.course.archived === true) {
      return res.status(404).json({ message: "Course not found for this student" });
    }

    const materials = await CourseMaterial.find({
      course: courseId,
      visibleToStudents: true,
    }).sort({ sortOrder: 1, createdAt: -1 });

    res.json(materials);
  } catch (err) {
    console.error("getStudentCourseMaterials error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getTeacherCourseMaterials,
  createCourseMaterial,
  updateCourseMaterial,
  deleteCourseMaterial,
  getStudentCourseMaterials,
};