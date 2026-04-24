const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const ProjectGroup = require("../models/ProjectGroup");
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

const FIELD_LABELS = {
  groupName: "Group name",
  projectTitle: "Project title",
  projectSummary: "Project summary",
  driveLink: "Drive link",
  repositoryLink: "Repository link",
  contactEmail: "Contact email",
  additionalNote: "Additional note",
};

const normalizeIds = (arr = []) => {
  const seen = new Set();
  return arr
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
};

const cleanString = (value) => String(value || "").trim();

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

const getProjectInfoFromBody = (body = {}) => ({
  groupName: cleanString(body.groupName),
  projectTitle: cleanString(body.projectTitle),
  projectSummary: cleanString(body.projectSummary),
  driveLink: cleanString(body.driveLink),
  repositoryLink: cleanString(body.repositoryLink),
  contactEmail: cleanString(body.contactEmail),
  additionalNote: cleanString(body.additionalNote),
});

const applyProjectInfoToGroup = (group, info) => {
  if (info.groupName !== undefined) group.groupName = info.groupName;
  if (info.projectTitle !== undefined) group.projectTitle = info.projectTitle;
  if (info.projectSummary !== undefined) group.projectSummary = info.projectSummary;
  if (info.driveLink !== undefined) group.driveLink = info.driveLink;
  if (info.repositoryLink !== undefined) group.repositoryLink = info.repositoryLink;
  if (info.contactEmail !== undefined) group.contactEmail = info.contactEmail;
  if (info.additionalNote !== undefined) group.additionalNote = info.additionalNote;
};

const pickEditableProjectInfo = (body = {}, configFields = {}) => {
  const cleaned = getProjectInfoFromBody(body);
  const payload = {};

  Object.keys(cleaned).forEach((key) => {
    if (configFields?.[key]?.editableByStudent) {
      payload[key] = cleaned[key];
    }
  });

  return payload;
};

const validateRequiredFields = (info = {}, configFields = {}, mode = "groupCreate") => {
  const ruleKey =
    mode === "projectUpdate" ? "requiredOnProjectUpdate" : "requiredOnGroupCreate";

  for (const key of Object.keys(configFields)) {
    if (!configFields[key]?.[ruleKey]) continue;

    if (!String(info[key] || "").trim()) {
      const err = new Error(`${FIELD_LABELS[key] || key} is required`);
      err.status = 400;
      throw err;
    }
  }
};

const getProjectFormFields = async (courseId) => {
  const config = await ProjectFormConfig.findOne({ course: courseId });
  return mergeProjectFields(config?.fields || {});
};

const ensureTeacherCourseAccess = async (teacherId, courseId) => {
  const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
  if (!course) {
    const err = new Error("Course not found");
    err.status = 404;
    throw err;
  }
  return course;
};

const ensureStudentEnrollment = async (studentId, courseId) => {
  const enrollment = await Enrollment.findOne({
    student: studentId,
    course: courseId,
  }).populate("course");

  if (!enrollment) {
    const err = new Error("You are not enrolled in this course");
    err.status = 403;
    throw err;
  }

  return enrollment.course;
};

const getEnrolledStudentIds = async (courseId) => {
  const enrollments = await Enrollment.find({ course: courseId }).select("student");
  return enrollments.map((e) => String(e.student));
};

const getStudentDirectory = async (courseId) => {
  const enrollments = await Enrollment.find({ course: courseId }).populate(
    "student",
    "name username email"
  );

  return enrollments
    .filter((e) => e.student)
    .map((e) => ({
      id: String(e.student._id),
      name: e.student.name || "",
      roll: e.student.username || "",
      email: e.student.email || "",
    }))
    .sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }));
};

const formatGroup = (group) => ({
  id: String(group._id),
  courseId: String(group.course),
  groupName: group.groupName || "",
  projectTitle: group.projectTitle || "",
  projectSummary: group.projectSummary || "",
  driveLink: group.driveLink || "",
  repositoryLink: group.repositoryLink || "",
  contactEmail: group.contactEmail || "",
  additionalNote: group.additionalNote || "",
  createdByRole: group.createdByRole || "student",
  leader: group.leader
    ? {
        id: String(group.leader._id),
        name: group.leader.name || "",
        roll: group.leader.username || "",
        email: group.leader.email || "",
      }
    : null,
  members: Array.isArray(group.members)
    ? group.members.map((m) => ({
        id: String(m._id),
        name: m.name || "",
        roll: m.username || "",
        email: m.email || "",
      }))
    : [],
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const validateProjectMode = (course) => {
  if (course?.projectFeature?.mode !== "project") {
    const err = new Error("Project workflow is not enabled for this course");
    err.status = 400;
    throw err;
  }
};

const validateMembersAgainstEnrollment = (memberIds, enrolledIds) => {
  const invalid = memberIds.filter((id) => !enrolledIds.includes(id));
  if (invalid.length) {
    const err = new Error("One or more selected students are not enrolled in this course");
    err.status = 400;
    throw err;
  }
};

const checkMemberConflicts = async ({ courseId, memberIds, excludeGroupId = null }) => {
  const query = {
    course: courseId,
    members: { $in: memberIds },
  };

  if (excludeGroupId) {
    query._id = { $ne: excludeGroupId };
  }

  const conflictGroup = await ProjectGroup.findOne(query).populate(
    "members",
    "name username"
  );

  if (!conflictGroup) return null;

  const overlapping = conflictGroup.members
    .filter((m) => memberIds.includes(String(m._id)))
    .map((m) => `${m.username} - ${m.name}`);

  const err = new Error(
    `Some selected students are already in another group: ${overlapping.join(", ")}`
  );
  err.status = 400;
  throw err;
};

const getTeacherProjectGroups = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;

    const course = await ensureTeacherCourseAccess(teacherId, courseId);
    validateProjectMode(course);

    const [groups, students] = await Promise.all([
      ProjectGroup.find({ course: courseId })
        .populate("leader", "name username email")
        .populate("members", "name username email")
        .sort({ createdAt: 1 }),
      getStudentDirectory(courseId),
    ]);

    const assignedIds = new Set(
      groups.flatMap((g) => g.members.map((m) => String(m._id)))
    );

    const availableStudents = students.filter((s) => !assignedIds.has(s.id));

    return res.json({
      groups: groups.map(formatGroup),
      students,
      availableStudents,
    });
  } catch (err) {
    console.error("getTeacherProjectGroups error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const createTeacherProjectGroup = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId } = req.params;
    const { leaderId, memberIds = [] } = req.body;
    const info = getProjectInfoFromBody(req.body);

    const course = await ensureTeacherCourseAccess(teacherId, courseId);
    validateProjectMode(course);

    const normalizedMembers = normalizeIds(memberIds);
    if (!leaderId) {
      return res.status(400).json({ message: "Leader is required" });
    }

    const leader = String(leaderId);
    const finalMembers = normalizeIds([leader, ...normalizedMembers]);

    if (!finalMembers.length) {
      return res.status(400).json({ message: "At least one member is required" });
    }

    const enrolledIds = await getEnrolledStudentIds(courseId);
    validateMembersAgainstEnrollment(finalMembers, enrolledIds);
    await checkMemberConflicts({ courseId, memberIds: finalMembers });

    const group = await ProjectGroup.create({
      course: courseId,
      leader,
      members: finalMembers,
      ...info,
      createdByRole: "teacher",
    });

    const populated = await ProjectGroup.findById(group._id)
      .populate("leader", "name username email")
      .populate("members", "name username email");

    return res.status(201).json(formatGroup(populated));
  } catch (err) {
    console.error("createTeacherProjectGroup error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const updateTeacherProjectGroup = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, groupId } = req.params;
    const { leaderId, memberIds = [] } = req.body;
    const info = getProjectInfoFromBody(req.body);

    const course = await ensureTeacherCourseAccess(teacherId, courseId);
    validateProjectMode(course);

    const existing = await ProjectGroup.findOne({ _id: groupId, course: courseId });
    if (!existing) {
      return res.status(404).json({ message: "Project group not found" });
    }

    const leader = String(leaderId || existing.leader);
    const finalMembers = normalizeIds([leader, ...memberIds]);

    if (!finalMembers.length) {
      return res.status(400).json({ message: "At least one member is required" });
    }

    const enrolledIds = await getEnrolledStudentIds(courseId);
    validateMembersAgainstEnrollment(finalMembers, enrolledIds);
    await checkMemberConflicts({
      courseId,
      memberIds: finalMembers,
      excludeGroupId: groupId,
    });

    existing.leader = leader;
    existing.members = finalMembers;
    applyProjectInfoToGroup(existing, info);

    await existing.save();

    const populated = await ProjectGroup.findById(existing._id)
      .populate("leader", "name username email")
      .populate("members", "name username email");

    return res.json(formatGroup(populated));
  } catch (err) {
    console.error("updateTeacherProjectGroup error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const deleteTeacherProjectGroup = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { courseId, groupId } = req.params;

    const course = await ensureTeacherCourseAccess(teacherId, courseId);
    validateProjectMode(course);

    const deleted = await ProjectGroup.findOneAndDelete({
      _id: groupId,
      course: courseId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Project group not found" });
    }

    return res.json({ message: "Project group deleted successfully" });
  } catch (err) {
    console.error("deleteTeacherProjectGroup error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const getStudentProjectGroups = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const course = await ensureStudentEnrollment(studentId, courseId);
    validateProjectMode(course);

    if (course?.projectFeature?.visibleToStudents === false) {
      return res.status(403).json({ message: "Project workflow is hidden for students" });
    }

    const [groups, students] = await Promise.all([
      ProjectGroup.find({ course: courseId })
        .populate("leader", "name username email")
        .populate("members", "name username email")
        .sort({ createdAt: 1 }),
      getStudentDirectory(courseId),
    ]);

    const myGroupDoc = groups.find((g) =>
      g.members.some((m) => String(m._id) === String(studentId))
    );

    const assignedIds = new Set(
      groups.flatMap((g) => g.members.map((m) => String(m._id)))
    );

    const availableStudents = students.filter(
      (s) => !assignedIds.has(s.id) && s.id !== String(studentId)
    );

    return res.json({
      groups: groups.map(formatGroup),
      myGroup: myGroupDoc ? formatGroup(myGroupDoc) : null,
      students,
      availableStudents,
      canCreateGroup: course?.projectFeature?.allowStudentGroupCreation !== false,
      canEditProjectInfo: myGroupDoc
        ? String(myGroupDoc.leader?._id) === String(studentId)
        : false,
    });
  } catch (err) {
    console.error("getStudentProjectGroups error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const createStudentProjectGroup = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;
    const { memberIds = [] } = req.body;

    const course = await ensureStudentEnrollment(studentId, courseId);
    validateProjectMode(course);

    if (course?.projectFeature?.visibleToStudents === false) {
      return res.status(403).json({ message: "Project workflow is hidden for students" });
    }

    if (course?.projectFeature?.allowStudentGroupCreation === false) {
      return res.status(403).json({ message: "Student group creation is disabled" });
    }

    const alreadyGrouped = await ProjectGroup.findOne({
      course: courseId,
      members: studentId,
    });

    if (alreadyGrouped) {
      return res.status(400).json({ message: "You are already in a project group" });
    }

    const configFields = await getProjectFormFields(courseId);

    const info = {
      groupName: cleanString(req.body.groupName),
      projectTitle: cleanString(req.body.projectTitle),
      projectSummary: "",
      driveLink: "",
      repositoryLink: "",
      contactEmail: "",
      additionalNote: "",
    };

    validateRequiredFields(info, configFields, "groupCreate");

    const finalMembers = normalizeIds([studentId, ...memberIds]);
    const enrolledIds = await getEnrolledStudentIds(courseId);
    validateMembersAgainstEnrollment(finalMembers, enrolledIds);
    await checkMemberConflicts({ courseId, memberIds: finalMembers });

    const group = await ProjectGroup.create({
      course: courseId,
      leader: studentId,
      members: finalMembers,
      ...info,
      createdByRole: "student",
    });

    const populated = await ProjectGroup.findById(group._id)
      .populate("leader", "name username email")
      .populate("members", "name username email");

    return res.status(201).json(formatGroup(populated));
  } catch (err) {
    console.error("createStudentProjectGroup error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

const updateStudentProjectInfo = async (req, res) => {
  try {
    const studentId = req.user.userId;
    const { courseId } = req.params;

    const course = await ensureStudentEnrollment(studentId, courseId);
    validateProjectMode(course);

    if (course?.projectFeature?.visibleToStudents === false) {
      return res.status(403).json({ message: "Project workflow is hidden for students" });
    }

    const group = await ProjectGroup.findOne({
      course: courseId,
      members: studentId,
    });

    if (!group) {
      return res.status(404).json({ message: "You are not in any project group" });
    }

    if (String(group.leader) !== String(studentId)) {
      return res.status(403).json({
        message: "Only the group leader can update project information",
      });
    }

    const configFields = await getProjectFormFields(courseId);
    const editableInfo = pickEditableProjectInfo(req.body, configFields);

    validateRequiredFields(
      { ...formatGroup(group), ...editableInfo },
      configFields,
      "projectUpdate"
    );

    applyProjectInfoToGroup(group, editableInfo);
    await group.save();

    const populated = await ProjectGroup.findById(group._id)
      .populate("leader", "name username email")
      .populate("members", "name username email");

    return res.json(formatGroup(populated));
  } catch (err) {
    console.error("updateStudentProjectInfo error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
};

module.exports = {
  getTeacherProjectGroups,
  createTeacherProjectGroup,
  updateTeacherProjectGroup,
  deleteTeacherProjectGroup,
  getStudentProjectGroups,
  createStudentProjectGroup,
  updateStudentProjectInfo,
};