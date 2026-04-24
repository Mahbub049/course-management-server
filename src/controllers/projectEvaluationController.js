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
  evaluationScope: evaluation.evaluationScope || extra.evaluationScope || "combined",
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

const buildTeacherEvaluationPayload = ({ phases, submissions, evaluations }) => {
  const evaluationByGroup = new Map();
  const evaluationByStudent = new Map();

  evaluations.forEach((item) => {
    if (item.group && !item.student) {
      evaluationByGroup.set(
        `group:${String(item.phase._id)}:${String(item.group._id)}`,
        item
      );
    }

    if (item.student) {
      evaluationByStudent.set(
        `student:${String(item.phase._id)}:${String(item.student._id)}`,
        item
      );
    }
  });

  const phaseBlocks = phases.map((phase) => {
    const phaseSubmissions = submissions.filter(
      (item) => String(item.phase._id) === String(phase._id)
    );

    const items = [];

    if (phase.phaseType === "group") {
      phaseSubmissions.forEach((submission) => {
        const group = submission.group;
        if (!group) return;

        const combinedEvaluation = evaluationByGroup.get(
          `group:${String(phase._id)}:${String(group._id)}`
        );

        const memberEvaluations = (group.members || []).map((member) => {
          const evaluation = evaluationByStudent.get(
            `student:${String(phase._id)}:${String(member._id)}`
          );

          return {
            student: {
              id: String(member._id),
              name: member.name || "",
              roll: member.username || "",
              email: member.email || "",
            },
            evaluation: evaluation
              ? formatEvaluation(evaluation, { evaluationScope: "member" })
              : null,
          };
        });

        const memberSavedCount = memberEvaluations.filter(
          (item) => item.evaluation
        ).length;

        items.push({
          targetKey: `group:${String(group._id)}`,
          submission: {
            id: String(submission._id),
            link: submission.link || "",
            note: submission.note || "",
            submittedAt: submission.submittedAt,
            lastUpdatedAt: submission.lastUpdatedAt,
            submissionType: submission.submissionType,
          },
          group: {
            id: String(group._id),
            groupName: group.groupName || "",
            projectTitle: group.projectTitle || "",
            members: (group.members || []).map((member) => ({
              id: String(member._id),
              name: member.name || "",
              roll: member.username || "",
              email: member.email || "",
            })),
          },
          suggestedMode: combinedEvaluation
            ? "combined"
            : memberSavedCount > 0
              ? "member"
              : "combined",
          combinedEvaluation: combinedEvaluation
            ? formatEvaluation(combinedEvaluation, {
                evaluationScope: "combined",
              })
            : null,
          memberEvaluations,
        });
      });
    } else {
      phaseSubmissions.forEach((submission) => {
        const student = submission.student;
        if (!student) return;

        const evaluation = evaluationByStudent.get(
          `student:${String(phase._id)}:${String(student._id)}`
        );

        items.push({
          targetKey: `student:${String(student._id)}`,
          submission: {
            id: String(submission._id),
            link: submission.link || "",
            note: submission.note || "",
            submittedAt: submission.submittedAt,
            lastUpdatedAt: submission.lastUpdatedAt,
            submissionType: submission.submissionType,
          },
          student: {
            id: String(student._id),
            name: student.name || "",
            roll: student.username || "",
            email: student.email || "",
          },
          evaluation: evaluation
            ? formatEvaluation(evaluation, { evaluationScope: "combined" })
            : null,
        });
      });
    }

    items.sort((a, b) => {
      const left = a.group?.groupName || a.student?.name || "";
      const right = b.group?.groupName || b.student?.name || "";
      return left.localeCompare(right);
    });

    const evaluatedCount =
      phase.phaseType === "group"
        ? items.filter(
            (item) =>
              item.combinedEvaluation ||
              item.memberEvaluations.some((member) => member.evaluation)
          ).length
        : items.filter((item) => item.evaluation).length;

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
      summary: {
        submissionCount: items.length,
        evaluatedCount,
        pendingCount: Math.max(items.length - evaluatedCount, 0),
      },
      items,
    };
  });

  const totals = phaseBlocks.reduce(
    (acc, block) => {
      acc.phaseCount += 1;
      acc.submissionCount += block.summary.submissionCount;
      acc.evaluatedCount += block.summary.evaluatedCount;
      acc.pendingCount += block.summary.pendingCount;
      return acc;
    },
    {
      phaseCount: 0,
      submissionCount: 0,
      evaluatedCount: 0,
      pendingCount: 0,
    }
  );

  return {
    totals,
    phases: phaseBlocks,
  };
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

    const [submissions, evaluations] = await Promise.all([
      ProjectSubmission.find({
        course: courseId,
        phase: { $in: phaseIds },
      })
        .populate("phase")
        .populate({
          path: "group",
          select: "groupName projectTitle members",
          populate: {
            path: "members",
            select: "name username email",
          },
        })
        .populate("student", "name username email")
        .sort({ submittedAt: 1, createdAt: 1 }),

      ProjectEvaluation.find({
        course: courseId,
        phase: { $in: phaseIds },
      })
        .populate("phase")
        .populate("group", "groupName projectTitle")
        .populate("student", "name username email")
        .populate("evaluatedBy", "name username email"),
    ]);

    const payload = buildTeacherEvaluationPayload({
      phases,
      submissions,
      evaluations,
    });

    return res.json(payload);
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
    const evaluationScope =
      cleanString(req.body.evaluationScope) || "combined";
    const targetStudentId = cleanString(req.body.targetStudentId);
    const marksObtained = Number(req.body.marksObtained || 0);

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
    });

    if (!phase) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    if (!submissionId) {
      return res.status(400).json({ message: "Submission is required" });
    }

    if (marksObtained < 0 || marksObtained > Number(phase.totalMarks || 0)) {
      return res.status(400).json({
        message: `Marks must be between 0 and ${Number(phase.totalMarks || 0)}`,
      });
    }

    const submission = await ProjectSubmission.findOne({
      _id: submissionId,
      course: courseId,
      phase: phaseId,
    })
      .populate({
        path: "group",
        select: "groupName members",
        populate: {
          path: "members",
          select: "name username email",
        },
      })
      .populate("student", "name username email");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (phase.phaseType === "group") {
      if (evaluationScope === "member") {
        if (!targetStudentId) {
          return res.status(400).json({
            message: "Target student is required for member-wise marking",
          });
        }

        const memberIds = (submission.group?.members || []).map((item) =>
          String(item._id)
        );

        if (!memberIds.includes(String(targetStudentId))) {
          return res.status(400).json({
            message: "Selected student is not part of this group",
          });
        }

        await ProjectEvaluation.deleteMany({
          course: courseId,
          phase: phaseId,
          group: submission.group?._id || null,
          student: null,
        });

        let evaluation = await ProjectEvaluation.findOne({
          course: courseId,
          phase: phaseId,
          student: targetStudentId,
        });

        if (evaluation) {
          evaluation.marksObtained = marksObtained;
          evaluation.feedback = feedback;
          evaluation.evaluatedBy = teacherId;
          evaluation.submission = submission._id;
          evaluation.group = submission.group?._id || null;
          evaluation.evaluationType = "group";
          evaluation.evaluationScope = "member";
          await evaluation.save();
        } else {
          evaluation = await ProjectEvaluation.create({
            course: courseId,
            phase: phaseId,
            evaluationType: "group",
            evaluationScope: "member",
            group: submission.group?._id || null,
            student: targetStudentId,
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

        return res.json(
          formatEvaluation(evaluation, { evaluationScope: "member" })
        );
      }

      await ProjectEvaluation.deleteMany({
        course: courseId,
        phase: phaseId,
        student: {
          $in: (submission.group?.members || []).map((item) => item._id),
        },
      });

      let evaluation = await ProjectEvaluation.findOne({
        course: courseId,
        phase: phaseId,
        group: submission.group?._id || null,
        student: null,
      });

      if (evaluation) {
        evaluation.marksObtained = marksObtained;
        evaluation.feedback = feedback;
        evaluation.evaluatedBy = teacherId;
        evaluation.submission = submission._id;
        evaluation.evaluationType = "group";
        evaluation.evaluationScope = "combined";
        await evaluation.save();
      } else {
        evaluation = await ProjectEvaluation.create({
          course: courseId,
          phase: phaseId,
          evaluationType: "group",
          evaluationScope: "combined",
          group: submission.group?._id || null,
          student: null,
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

      return res.json(
        formatEvaluation(evaluation, { evaluationScope: "combined" })
      );
    }

    let evaluation = await ProjectEvaluation.findOne({
      course: courseId,
      phase: phaseId,
      student: submission.student?._id || null,
    });

    if (evaluation) {
      evaluation.marksObtained = marksObtained;
      evaluation.feedback = feedback;
      evaluation.evaluatedBy = teacherId;
      evaluation.submission = submission._id;
      evaluation.evaluationType = "individual";
      evaluation.evaluationScope = "combined";
      await evaluation.save();
    } else {
      evaluation = await ProjectEvaluation.create({
        course: courseId,
        phase: phaseId,
        evaluationType: "individual",
        evaluationScope: "combined",
        group: null,
        student: submission.student?._id || null,
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

    return res.json(
      formatEvaluation(evaluation, { evaluationScope: "combined" })
    );
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
        ...(myGroup ? [{ group: myGroup._id, student: null }] : []),
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