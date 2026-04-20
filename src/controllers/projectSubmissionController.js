const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectGroup = require("../models/ProjectGroup");
const ProjectPhase = require("../models/ProjectPhase");
const ProjectSubmission = require("../models/ProjectSubmission");

const cleanString = (value) => String(value || "").trim();

const formatSubmission = (submission, extra = {}) => ({
  id: String(submission._id),
  courseId: String(submission.course),
  phaseId: String(submission.phase?._id || submission.phase),
  phaseTitle: submission.phase?.title || extra.phaseTitle || "",
  phaseType: submission.phase?.phaseType || extra.phaseType || "",
  totalMarks: Number(submission.phase?.totalMarks || extra.totalMarks || 0),
  dueDate: submission.phase?.dueDate || extra.dueDate || null,
  submissionType: submission.submissionType,
  link: submission.link || "",
  note: submission.note || "",
  submittedAt: submission.submittedAt,
  lastUpdatedAt: submission.lastUpdatedAt,
  isLate: extra.isLate || false,
  submittedBy: submission.submittedBy
    ? {
        id: String(submission.submittedBy._id),
        name: submission.submittedBy.name || "",
        roll: submission.submittedBy.username || "",
        email: submission.submittedBy.email || "",
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
  group: submission.group
    ? {
        id: String(submission.group._id),
        groupName: submission.group.groupName || "",
        projectTitle: submission.group.projectTitle || "",
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

const getLateStatus = (dueDate, submittedAt) => {
  if (!dueDate || !submittedAt) return false;
  const due = new Date(dueDate);
  const sub = new Date(submittedAt);

  if (Number.isNaN(due.getTime()) || Number.isNaN(sub.getTime())) return false;
  return sub.getTime() > due.getTime();
};

const getStudentGroupForCourse = async (studentId, courseId) => {
  return ProjectGroup.findOne({
    course: courseId,
    members: studentId,
  });
};

const getStudentProjectSubmissions = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    await ensureStudentAccess(studentId, courseId);

    const phases = await ProjectPhase.find({
      course: courseId,
      isVisibleToStudents: true,
    }).sort({ order: 1, createdAt: 1 });

    const myGroup = await getStudentGroupForCourse(studentId, courseId);

    const phaseIds = phases.map((p) => p._id);

    const submissions = await ProjectSubmission.find({
      course: courseId,
      phase: { $in: phaseIds },
      $or: [
        { student: studentId },
        ...(myGroup ? [{ group: myGroup._id }] : []),
      ],
    })
      .populate("phase")
      .populate("submittedBy", "name username email")
      .populate("student", "name username email")
      .populate("group", "groupName projectTitle");

    const submissionMap = new Map(
      submissions.map((item) => [String(item.phase._id), item])
    );

    const result = phases.map((phase) => {
      const submission = submissionMap.get(String(phase._id));
      const canSubmit =
        phase.phaseType === "group" ? Boolean(myGroup) : true;

      return {
        phase: {
          id: String(phase._id),
          title: phase.title || "",
          instructions: phase.instructions || "",
          phaseType: phase.phaseType || "group",
          dueDate: phase.dueDate,
          totalMarks: Number(phase.totalMarks || 0),
          order: Number(phase.order || 0),
          isVisibleToStudents: phase.isVisibleToStudents !== false,
        },
        submission: submission
          ? formatSubmission(submission, {
              isLate: getLateStatus(phase.dueDate, submission.submittedAt),
            })
          : null,
        canSubmit,
        submissionLabel:
          phase.phaseType === "group" ? "Group Submission" : "Individual Submission",
      };
    });

    return res.json({
      myGroup: myGroup
        ? {
            id: String(myGroup._id),
            groupName: myGroup.groupName || "",
            projectTitle: myGroup.projectTitle || "",
          }
        : null,
      items: result,
    });
  } catch (err) {
    console.error("getStudentProjectSubmissions error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const submitStudentProjectPhase = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId, phaseId } = req.params;
    const link = cleanString(req.body.link);
    const note = cleanString(req.body.note);

    await ensureStudentAccess(studentId, courseId);

    if (!link) {
      return res.status(400).json({ message: "Submission link is required" });
    }

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
      isVisibleToStudents: true,
    });

    if (!phase) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    let submissionQuery = {};
    let submissionType = phase.phaseType;

    if (phase.phaseType === "group") {
      const group = await getStudentGroupForCourse(studentId, courseId);

      if (!group) {
        return res.status(400).json({
          message: "You must be in a project group to submit this phase",
        });
      }

      submissionQuery = {
        course: courseId,
        phase: phaseId,
        group: group._id,
      };

      let submission = await ProjectSubmission.findOne(submissionQuery);

      if (submission) {
        submission.link = link;
        submission.note = note;
        submission.submittedBy = studentId;
        submission.lastUpdatedAt = new Date();
        await submission.save();

        submission = await ProjectSubmission.findById(submission._id)
          .populate("phase")
          .populate("submittedBy", "name username email")
          .populate("group", "groupName projectTitle");

        return res.json(
          formatSubmission(submission, {
            isLate: getLateStatus(phase.dueDate, submission.submittedAt),
          })
        );
      }

      submission = await ProjectSubmission.create({
        course: courseId,
        phase: phaseId,
        submissionType,
        group: group._id,
        student: null,
        submittedBy: studentId,
        link,
        note,
        submittedAt: new Date(),
        lastUpdatedAt: new Date(),
      });

      submission = await ProjectSubmission.findById(submission._id)
        .populate("phase")
        .populate("submittedBy", "name username email")
        .populate("group", "groupName projectTitle");

      return res.status(201).json(
        formatSubmission(submission, {
          isLate: getLateStatus(phase.dueDate, submission.submittedAt),
        })
      );
    }

    submissionQuery = {
      course: courseId,
      phase: phaseId,
      student: studentId,
    };

    let submission = await ProjectSubmission.findOne(submissionQuery);

    if (submission) {
      submission.link = link;
      submission.note = note;
      submission.submittedBy = studentId;
      submission.lastUpdatedAt = new Date();
      await submission.save();

      submission = await ProjectSubmission.findById(submission._id)
        .populate("phase")
        .populate("submittedBy", "name username email")
        .populate("student", "name username email");

      return res.json(
        formatSubmission(submission, {
          isLate: getLateStatus(phase.dueDate, submission.submittedAt),
        })
      );
    }

    submission = await ProjectSubmission.create({
      course: courseId,
      phase: phaseId,
      submissionType,
      group: null,
      student: studentId,
      submittedBy: studentId,
      link,
      note,
      submittedAt: new Date(),
      lastUpdatedAt: new Date(),
    });

    submission = await ProjectSubmission.findById(submission._id)
      .populate("phase")
      .populate("submittedBy", "name username email")
      .populate("student", "name username email");

    return res.status(201).json(
      formatSubmission(submission, {
        isLate: getLateStatus(phase.dueDate, submission.submittedAt),
      })
    );
  } catch (err) {
    console.error("submitStudentProjectPhase error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const getTeacherProjectSubmissions = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phases = await ProjectPhase.find({ course: courseId }).sort({
      order: 1,
      createdAt: 1,
    });

    const phaseIds = phases.map((p) => p._id);

    const submissions = await ProjectSubmission.find({
      course: courseId,
      phase: { $in: phaseIds },
    })
      .populate("phase")
      .populate("submittedBy", "name username email")
      .populate("student", "name username email")
      .populate("group", "groupName projectTitle");

    const grouped = phases.map((phase) => {
      const phaseSubmissions = submissions
        .filter((item) => String(item.phase._id) === String(phase._id))
        .map((item) =>
          formatSubmission(item, {
            isLate: getLateStatus(phase.dueDate, item.submittedAt),
          })
        );

      return {
        phase: {
          id: String(phase._id),
          title: phase.title || "",
          instructions: phase.instructions || "",
          phaseType: phase.phaseType || "group",
          dueDate: phase.dueDate,
          totalMarks: Number(phase.totalMarks || 0),
          order: Number(phase.order || 0),
          isVisibleToStudents: phase.isVisibleToStudents !== false,
        },
        submissions: phaseSubmissions,
        submittedCount: phaseSubmissions.length,
      };
    });

    return res.json(grouped);
  } catch (err) {
    console.error("getTeacherProjectSubmissions error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

module.exports = {
  getStudentProjectSubmissions,
  submitStudentProjectPhase,
  getTeacherProjectSubmissions,
};