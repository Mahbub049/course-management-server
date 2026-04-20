const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectGroup = require("../models/ProjectGroup");
const ProjectPhase = require("../models/ProjectPhase");
const ProjectSubmission = require("../models/ProjectSubmission");
const ProjectEvaluation = require("../models/ProjectEvaluation");

const cleanString = (value) => String(value || "").trim();

const formatEvaluation = (evaluation, extra = {}) => ({
  id: String(evaluation._id),
  courseId: String(evaluation.course),
  phaseId: String(evaluation.phase?._id || evaluation.phase),
  evaluationType: evaluation.evaluationType,
  marksObtained: Number(evaluation.marksObtained || 0),
  feedback: evaluation.feedback || "",
  createdAt: evaluation.createdAt,
  updatedAt: evaluation.updatedAt,
  phase: evaluation.phase
    ? {
        id: String(evaluation.phase._id),
        title: evaluation.phase.title || "",
        phaseType: evaluation.phase.phaseType || "",
        totalMarks: Number(evaluation.phase.totalMarks || 0),
        dueDate: evaluation.phase.dueDate || null,
      }
    : extra.phase || null,
  group: evaluation.group
    ? {
        id: String(evaluation.group._id),
        groupName: evaluation.group.groupName || "",
        projectTitle: evaluation.group.projectTitle || "",
      }
    : null,
  student: evaluation.student
    ? {
        id: String(evaluation.student._id),
        name: evaluation.student.name || "",
        roll: evaluation.student.username || "",
        email: evaluation.student.email || "",
      }
    : null,
  evaluatedBy: evaluation.evaluatedBy
    ? {
        id: String(evaluation.evaluatedBy._id),
        name: evaluation.evaluatedBy.name || "",
        roll: evaluation.evaluatedBy.username || "",
        email: evaluation.evaluatedBy.email || "",
      }
    : null,
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

const getTeacherProjectEvaluations = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phases = await ProjectPhase.find({ course: courseId }).sort({
      order: 1,
      createdAt: 1,
    });

    const phaseIds = phases.map((phase) => phase._id);

    const submissions = await ProjectSubmission.find({
      course: courseId,
      phase: { $in: phaseIds },
    })
      .populate("phase")
      .populate("group", "groupName projectTitle")
      .populate("student", "name username email");

    const evaluations = await ProjectEvaluation.find({
      course: courseId,
      phase: { $in: phaseIds },
    })
      .populate("phase")
      .populate("group", "groupName projectTitle")
      .populate("student", "name username email")
      .populate("evaluatedBy", "name username email");

    const evaluationMap = new Map();
    evaluations.forEach((item) => {
      const key =
        item.group
          ? `group:${String(item.phase._id)}:${String(item.group._id)}`
          : `student:${String(item.phase._id)}:${String(item.student._id)}`;
      evaluationMap.set(key, item);
    });

    const grouped = phases.map((phase) => {
      const phaseSubmissions = submissions
        .filter((item) => String(item.phase._id) === String(phase._id))
        .map((submission) => {
          const key =
            submission.group
              ? `group:${String(phase._id)}:${String(submission.group._id)}`
              : `student:${String(phase._id)}:${String(submission.student._id)}`;

          const evaluation = evaluationMap.get(key);

          return {
            submission: {
              id: String(submission._id),
              link: submission.link || "",
              note: submission.note || "",
              submittedAt: submission.submittedAt,
              lastUpdatedAt: submission.lastUpdatedAt,
              submissionType: submission.submissionType,
              group: submission.group
                ? {
                    id: String(submission.group._id),
                    groupName: submission.group.groupName || "",
                    projectTitle: submission.group.projectTitle || "",
                  }
                : null,
              student: submission.student
                ? {
                    id: String(submission.student._id),
                    name: submission.student.name || "",
                    roll: submission.student.username || "",
                    email: submission.student.email || "",
                  }
                : null,
            },
            evaluation: evaluation ? formatEvaluation(evaluation) : null,
          };
        });

      return {
        phase: {
          id: String(phase._id),
          title: phase.title || "",
          instructions: phase.instructions || "",
          phaseType: phase.phaseType || "group",
          dueDate: phase.dueDate,
          totalMarks: Number(phase.totalMarks || 0),
          order: Number(phase.order || 0),
        },
        items: phaseSubmissions,
      };
    });

    return res.json(grouped);
  } catch (err) {
    console.error("getTeacherProjectEvaluations error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const saveProjectEvaluation = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, phaseId } = req.params;
    const submissionId = cleanString(req.body.submissionId);
    const feedback = cleanString(req.body.feedback);
    const marksObtained = Number(req.body.marksObtained || 0);

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
    });

    if (!phase) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    if (marksObtained < 0 || marksObtained > Number(phase.totalMarks || 0)) {
      return res.status(400).json({
        message: `Marks must be between 0 and ${Number(phase.totalMarks || 0)}`,
      });
    }

    if (!submissionId) {
      return res.status(400).json({ message: "Submission is required" });
    }

    const submission = await ProjectSubmission.findOne({
      _id: submissionId,
      course: courseId,
      phase: phaseId,
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    const query = submission.group
      ? { course: courseId, phase: phaseId, group: submission.group }
      : { course: courseId, phase: phaseId, student: submission.student };

    let evaluation = await ProjectEvaluation.findOne(query);

    if (evaluation) {
      evaluation.marksObtained = marksObtained;
      evaluation.feedback = feedback;
      evaluation.evaluatedBy = teacherId;
      evaluation.submission = submission._id;
      await evaluation.save();
    } else {
      evaluation = await ProjectEvaluation.create({
        course: courseId,
        phase: phaseId,
        evaluationType: submission.submissionType,
        group: submission.group || null,
        student: submission.student || null,
        submission: submission._id,
        marksObtained,
        feedback,
        evaluatedBy: teacherId,
      });
    }

    evaluation = await ProjectEvaluation.findById(evaluation._id)
      .populate("phase")
      .populate("group", "groupName projectTitle")
      .populate("student", "name username email")
      .populate("evaluatedBy", "name username email");

    return res.json(formatEvaluation(evaluation));
  } catch (err) {
    console.error("saveProjectEvaluation error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const getStudentProjectEvaluations = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    await ensureStudentAccess(studentId, courseId);

    const phases = await ProjectPhase.find({
      course: courseId,
      isVisibleToStudents: true,
    }).sort({ order: 1, createdAt: 1 });

    const myGroup = await ProjectGroup.findOne({
      course: courseId,
      members: studentId,
    });

    const phaseIds = phases.map((phase) => phase._id);

    const evaluations = await ProjectEvaluation.find({
      course: courseId,
      phase: { $in: phaseIds },
      $or: [
        { student: studentId },
        ...(myGroup ? [{ group: myGroup._id }] : []),
      ],
    })
      .populate("phase")
      .populate("group", "groupName projectTitle")
      .populate("student", "name username email")
      .populate("evaluatedBy", "name username email");

    const evaluationMap = new Map();
    evaluations.forEach((item) => {
      evaluationMap.set(String(item.phase._id), item);
    });

    const items = phases.map((phase) => {
      const evaluation = evaluationMap.get(String(phase._id));
      return {
        phase: {
          id: String(phase._id),
          title: phase.title || "",
          instructions: phase.instructions || "",
          phaseType: phase.phaseType || "group",
          dueDate: phase.dueDate,
          totalMarks: Number(phase.totalMarks || 0),
          order: Number(phase.order || 0),
        },
        evaluation: evaluation ? formatEvaluation(evaluation) : null,
      };
    });

    const totalObtained = items.reduce(
      (sum, item) => sum + Number(item.evaluation?.marksObtained || 0),
      0
    );

    const totalAvailable = items.reduce(
      (sum, item) => sum + Number(item.phase?.totalMarks || 0),
      0
    );

    return res.json({
      items,
      totalObtained,
      totalAvailable,
    });
  } catch (err) {
    console.error("getStudentProjectEvaluations error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

module.exports = {
  getTeacherProjectEvaluations,
  saveProjectEvaluation,
  getStudentProjectEvaluations,
};