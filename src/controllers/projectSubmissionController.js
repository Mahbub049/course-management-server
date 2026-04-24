const path = require("path");
const archiver = require("archiver");

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectGroup = require("../models/ProjectGroup");
const ProjectPhase = require("../models/ProjectPhase");
const ProjectSubmission = require("../models/ProjectSubmission");

const {
  buildProjectSubmissionStoragePath,
  uploadProjectSubmissionBuffer,
  createProjectSubmissionSignedUrl,
  downloadProjectSubmissionObject,
  sanitizeFileName,
} = require("../utils/projectSubmissionStorage");

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
  fileUrl: submission.fileUrl || "",
  fileName: submission.attachment?.originalName || "",
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

const attachSignedUrlToSubmission = async (submissionDoc) => {
  if (!submissionDoc) return null;

  const submission =
    typeof submissionDoc.toObject === "function"
      ? submissionDoc.toObject()
      : { ...submissionDoc };

  let fileUrl = "";
  if (submission?.attachment?.storagePath) {
    fileUrl = await createProjectSubmissionSignedUrl(
      submission.attachment.storagePath
    );
  }

  submission.fileUrl = fileUrl;
  return submission;
};

const safeLabel = (value, fallback = "item") => {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || fallback;
};

const buildSubmissionInfoText = (submissionItem, phase) => {
  return [
    `Phase: ${phase?.title || ""}`,
    `Phase Type: ${phase?.phaseType || ""}`,
    `Group/Student Type: ${submissionItem?.targetType || ""}`,
    `Target Name: ${submissionItem?.targetName || ""}`,
    `Submitted: ${submissionItem?.hasSubmission ? "Yes" : "No"}`,
    `Submitted By: ${submissionItem?.submittedBy?.name || ""}${
      submissionItem?.submittedBy?.roll ? ` (${submissionItem.submittedBy.roll})` : ""
    }`,
    `Submitted At: ${submissionItem?.submittedAt || ""}`,
    `Last Updated: ${submissionItem?.lastUpdatedAt || ""}`,
    `Late: ${submissionItem?.isLate ? "Yes" : "No"}`,
    `Link: ${submissionItem?.link || ""}`,
    `File Name: ${submissionItem?.fileName || ""}`,
    "",
    "Note:",
    submissionItem?.note || "",
  ].join("\n");
};

const buildTeacherSubmissionView = ({
  phase,
  targets,
  submissionDocs,
}) => {
  const submissionMap = new Map();

  for (const item of submissionDocs) {
    if (phase.phaseType === "group" && item.group?._id) {
      submissionMap.set(`group:${String(item.group._id)}`, item);
    } else if (phase.phaseType === "individual" && item.student?._id) {
      submissionMap.set(`student:${String(item.student._id)}`, item);
    }
  }

  const submissionItems = targets.map((target) => {
    const key =
      phase.phaseType === "group"
        ? `group:${String(target.id)}`
        : `student:${String(target.id)}`;

    const submission = submissionMap.get(key);

    if (!submission) {
      return {
        id: key,
        targetId: String(target.id),
        targetType: phase.phaseType === "group" ? "group" : "student",
        targetName: target.name,
        targetSecondary: target.secondary || "",
        memberCount: target.memberCount || 0,
        hasSubmission: false,
        hasFile: false,
        hasLink: false,
        fileName: "",
        fileUrl: "",
        link: "",
        note: "",
        submittedAt: null,
        lastUpdatedAt: null,
        isLate: false,
        submittedBy: null,
        student: target.student || null,
        group: target.group || null,
      };
    }

    const formatted = formatSubmission(submission, {
      isLate: getLateStatus(phase.dueDate, submission.submittedAt),
    });

    return {
      id: formatted.id,
      targetId: String(target.id),
      targetType: phase.phaseType === "group" ? "group" : "student",
      targetName: target.name,
      targetSecondary: target.secondary || "",
      memberCount: target.memberCount || 0,
      hasSubmission: true,
      hasFile: Boolean(formatted.fileUrl),
      hasLink: Boolean(formatted.link),
      fileName: formatted.fileName || "",
      fileUrl: formatted.fileUrl || "",
      link: formatted.link || "",
      note: formatted.note || "",
      submittedAt: formatted.submittedAt,
      lastUpdatedAt: formatted.lastUpdatedAt,
      isLate: formatted.isLate,
      submittedBy: formatted.submittedBy,
      student: formatted.student || target.student || null,
      group: formatted.group || target.group || null,
    };
  });

  const submittedCount = submissionItems.filter((item) => item.hasSubmission).length;
  const pendingCount = submissionItems.length - submittedCount;
  const withFileCount = submissionItems.filter((item) => item.hasFile).length;
  const linkOnlyCount = submissionItems.filter(
    (item) => item.hasSubmission && item.hasLink && !item.hasFile
  ).length;

  submissionItems.sort((a, b) => {
    if (a.hasSubmission !== b.hasSubmission) return a.hasSubmission ? -1 : 1;
    return a.targetName.localeCompare(b.targetName);
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
      isVisibleToStudents: phase.isVisibleToStudents !== false,
      resourceLinks: Array.isArray(phase.resourceLinks) ? phase.resourceLinks : [],
    },
    overview: {
      expectedCount: submissionItems.length,
      submittedCount,
      pendingCount,
      withFileCount,
      linkOnlyCount,
    },
    submissions: submissionItems,
  };
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
      $or: [{ student: studentId }, ...(myGroup ? [{ group: myGroup._id }] : [])],
    })
      .populate("phase")
      .populate("submittedBy", "name username email")
      .populate("student", "name username email")
      .populate("group", "groupName projectTitle");

    const submissionMap = new Map();
    for (const item of submissions) {
      const withUrl = await attachSignedUrlToSubmission(item);
      submissionMap.set(String(item.phase._id), withUrl);
    }

    const result = phases.map((phase) => {
      const submission = submissionMap.get(String(phase._id));
      const canSubmit = phase.phaseType === "group" ? Boolean(myGroup) : true;

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
          resourceLinks: Array.isArray(phase.resourceLinks) ? phase.resourceLinks : [],
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

    if (!link && !req.file) {
      return res.status(400).json({
        message: "Please provide submission link or upload a file",
      });
    }

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
      isVisibleToStudents: true,
    });

    if (!phase) {
      return res.status(404).json({ message: "Project phase not found" });
    }

    const submissionType = phase.phaseType;

    if (phase.phaseType === "group") {
      const group = await getStudentGroupForCourse(studentId, courseId);

      if (!group) {
        return res.status(400).json({
          message: "You must be in a project group to submit this phase",
        });
      }

      const submissionQuery = {
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

        if (req.file) {
          const storagePath = buildProjectSubmissionStoragePath({
            courseId,
            phaseId,
            studentId,
            originalFileName: req.file.originalname,
          });

          await uploadProjectSubmissionBuffer({
            buffer: req.file.buffer,
            storagePath,
            mimeType: req.file.mimetype,
          });

          submission.attachment = {
            originalName: req.file.originalname,
            storagePath,
            mimeType: req.file.mimetype,
            size: req.file.size,
          };
        }

        await submission.save();

        submission = await ProjectSubmission.findById(submission._id)
          .populate("phase")
          .populate("submittedBy", "name username email")
          .populate("group", "groupName projectTitle");

        const withUrl = await attachSignedUrlToSubmission(submission);

        return res.json(
          formatSubmission(withUrl, {
            isLate: getLateStatus(phase.dueDate, withUrl.submittedAt),
          })
        );
      }

      const newSubmissionData = {
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
      };

      if (req.file) {
        const storagePath = buildProjectSubmissionStoragePath({
          courseId,
          phaseId,
          studentId,
          originalFileName: req.file.originalname,
        });

        await uploadProjectSubmissionBuffer({
          buffer: req.file.buffer,
          storagePath,
          mimeType: req.file.mimetype,
        });

        newSubmissionData.attachment = {
          originalName: req.file.originalname,
          storagePath,
          mimeType: req.file.mimetype,
          size: req.file.size,
        };
      }

      submission = await ProjectSubmission.create(newSubmissionData);

      submission = await ProjectSubmission.findById(submission._id)
        .populate("phase")
        .populate("submittedBy", "name username email")
        .populate("group", "groupName projectTitle");

      const withUrl = await attachSignedUrlToSubmission(submission);

      return res.status(201).json(
        formatSubmission(withUrl, {
          isLate: getLateStatus(phase.dueDate, withUrl.submittedAt),
        })
      );
    }

    const submissionQuery = {
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

      if (req.file) {
        const storagePath = buildProjectSubmissionStoragePath({
          courseId,
          phaseId,
          studentId,
          originalFileName: req.file.originalname,
        });

        await uploadProjectSubmissionBuffer({
          buffer: req.file.buffer,
          storagePath,
          mimeType: req.file.mimetype,
        });

        submission.attachment = {
          originalName: req.file.originalname,
          storagePath,
          mimeType: req.file.mimetype,
          size: req.file.size,
        };
      }

      await submission.save();

      submission = await ProjectSubmission.findById(submission._id)
        .populate("phase")
        .populate("submittedBy", "name username email")
        .populate("student", "name username email");

      const withUrl = await attachSignedUrlToSubmission(submission);

      return res.json(
        formatSubmission(withUrl, {
          isLate: getLateStatus(phase.dueDate, withUrl.submittedAt),
        })
      );
    }

    const newSubmissionData = {
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
    };

    if (req.file) {
      const storagePath = buildProjectSubmissionStoragePath({
        courseId,
        phaseId,
        studentId,
        originalFileName: req.file.originalname,
      });

      await uploadProjectSubmissionBuffer({
        buffer: req.file.buffer,
        storagePath,
        mimeType: req.file.mimetype,
      });

      newSubmissionData.attachment = {
        originalName: req.file.originalname,
        storagePath,
        mimeType: req.file.mimetype,
        size: req.file.size,
      };
    }

    submission = await ProjectSubmission.create(newSubmissionData);

    submission = await ProjectSubmission.findById(submission._id)
      .populate("phase")
      .populate("submittedBy", "name username email")
      .populate("student", "name username email");

    const withUrl = await attachSignedUrlToSubmission(submission);

    return res.status(201).json(
      formatSubmission(withUrl, {
        isLate: getLateStatus(phase.dueDate, withUrl.submittedAt),
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

    const [phases, groups, enrollments, submissions] = await Promise.all([
      ProjectPhase.find({ course: courseId }).sort({ order: 1, createdAt: 1 }),
      ProjectGroup.find({ course: courseId })
        .populate("leader", "name username email")
        .populate("members", "name username email")
        .sort({ groupName: 1, createdAt: 1 }),
      Enrollment.find({ course: courseId }).populate("student", "name username email"),
      ProjectSubmission.find({ course: courseId })
        .populate("phase")
        .populate("submittedBy", "name username email")
        .populate("student", "name username email")
        .populate("group", "groupName projectTitle"),
    ]);

    const groupTargets = groups.map((group) => ({
      id: String(group._id),
      name: group.groupName || "Unnamed Group",
      secondary: group.projectTitle || "",
      memberCount: Array.isArray(group.members) ? group.members.length : 0,
      group: {
        id: String(group._id),
        groupName: group.groupName || "",
        projectTitle: group.projectTitle || "",
      },
      student: null,
    }));

    const individualTargets = enrollments
      .filter((item) => item.student)
      .map((item) => ({
        id: String(item.student._id),
        name: item.student.name || "Unnamed Student",
        secondary: item.student.username ? `Roll: ${item.student.username}` : "",
        memberCount: 1,
        group: null,
        student: {
          id: String(item.student._id),
          name: item.student.name || "",
          roll: item.student.username || "",
          email: item.student.email || "",
        },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const phaseViews = [];

    for (const phase of phases) {
      const phaseDocs = submissions.filter(
        (item) => String(item.phase?._id || item.phase) === String(phase._id)
      );

      const withUrls = [];
      for (const doc of phaseDocs) {
        withUrls.push(await attachSignedUrlToSubmission(doc));
      }

      const targets = phase.phaseType === "group" ? groupTargets : individualTargets;

      phaseViews.push(
        buildTeacherSubmissionView({
          phase,
          targets,
          submissionDocs: withUrls,
        })
      );
    }

    const totals = phaseViews.reduce(
      (acc, item) => {
        acc.phaseCount += 1;
        acc.expectedCount += item.overview.expectedCount;
        acc.submittedCount += item.overview.submittedCount;
        acc.pendingCount += item.overview.pendingCount;
        acc.withFileCount += item.overview.withFileCount;
        acc.linkOnlyCount += item.overview.linkOnlyCount;
        return acc;
      },
      {
        phaseCount: 0,
        expectedCount: 0,
        submittedCount: 0,
        pendingCount: 0,
        withFileCount: 0,
        linkOnlyCount: 0,
      }
    );

    return res.json({
      totals,
      phases: phaseViews,
    });
  } catch (err) {
    console.error("getTeacherProjectSubmissions error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Server error",
    });
  }
};

const downloadTeacherProjectSubmissionZip = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, phaseId } = req.params;

    await ensureTeacherCourseAccess(teacherId, courseId);

    const phase = await ProjectPhase.findOne({
      _id: phaseId,
      course: courseId,
    });

    if (!phase) {
      return res.status(404).json({
        message: "Project phase not found",
      });
    }

    const submissionDocs = await ProjectSubmission.find({
      course: courseId,
      phase: phaseId,
    })
      .populate("submittedBy", "name username email")
      .populate("student", "name username email")
      .populate("group", "groupName projectTitle");

    const zipItems = [];
    for (const doc of submissionDocs) {
      const withUrl = await attachSignedUrlToSubmission(doc);
      zipItems.push(
        formatSubmission(withUrl, {
          isLate: getLateStatus(phase.dueDate, withUrl.submittedAt),
        })
      );
    }

    if (zipItems.length === 0) {
      return res.status(404).json({
        message: "No submissions found for this phase",
      });
    }

    const zipName = `${safeLabel(phase.title || "phase")}_submissions.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(res);

    for (let index = 0; index < zipItems.length; index += 1) {
      const item = zipItems[index];

      const folderName =
        item.group?.groupName ||
        item.student?.roll ||
        item.student?.name ||
        `submission_${index + 1}`;

      const folder = `${String(index + 1).padStart(2, "0")}_${safeLabel(folderName)}`;

      if (item.fileName && docHasStoragePath(item, submissionDocs[index])) {
        const storagePath = submissionDocs[index]?.attachment?.storagePath || "";
        const downloadResult = await downloadProjectSubmissionObject(storagePath);

        if (downloadResult?.buffer) {
          const originalName =
            submissionDocs[index]?.attachment?.originalName ||
            path.basename(storagePath) ||
            "submission-file";
          const sanitizedOriginalName = sanitizeFileName(originalName).safeName;

          archive.append(downloadResult.buffer, {
            name: `${folder}/${sanitizedOriginalName}`,
          });
        }
      }

      archive.append(buildSubmissionInfoText(item, phase), {
        name: `${folder}/submission-info.txt`,
      });
    }

    await archive.finalize();
  } catch (err) {
    console.error("downloadTeacherProjectSubmissionZip error:", err);
    if (!res.headersSent) {
      return res.status(err.status || 500).json({
        message: err.message || "Failed to create ZIP file",
      });
    }
  }
};

function docHasStoragePath(formattedItem, submissionDoc) {
  return Boolean(
    formattedItem?.fileName &&
      submissionDoc?.attachment &&
      submissionDoc.attachment.storagePath
  );
}

module.exports = {
  getStudentProjectSubmissions,
  submitStudentProjectPhase,
  getTeacherProjectSubmissions,
  downloadTeacherProjectSubmissionZip,
};