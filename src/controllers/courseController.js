// server/src/controllers/courseController.js

const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');
const Mark = require('../models/Mark');
const SelfStudyBillConfig = require('../models/SelfStudyBillConfig');
const {
  normalizeShift,
  isProgramAllowedForShift,
} = require('../constants/bubtAcademicPrograms');
// If you also track complaints per course, you can uncomment this
// and the delete block below.
// const Complaint = require('../models/Complaint');

const ALLOWED_COURSE_TYPES = ['theory', 'lab', 'hybrid', 'self_study'];
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

const sanitizeAssignmentPolicy = (raw = {}) => ({
  mode: raw?.mode === 'proportional_full_marks' ? 'proportional_full_marks' : 'equal_parts_scaled',
  totalWeight: Number.isFinite(Number(raw?.totalWeight)) && Number(raw.totalWeight) >= 0
    ? Number(raw.totalWeight)
    : 10,
});

const getMaxCtWeight = () => 15;

const getCtWeightLimitMessage = (courseType = 'theory', maxWeight) => {
  return String(courseType || 'theory').toLowerCase() === 'hybrid'
    ? `CT + Assignment + Attendance cannot cross 30. For hybrid courses, CT weight cannot be more than ${maxWeight}.`
    : `CT + Assignment + Attendance cannot cross 30. For theory courses, CT weight cannot be more than ${maxWeight}.`;
};

const LEGACY_COMPLAINT_CLOSED_MESSAGE =
  "Complaint submission is currently closed by the course teacher.";
const DEFAULT_ISSUE_CLOSED_MESSAGE =
  "Issue submission is currently closed by the course teacher.";

const normalizeIssueClosedMessage = (value) => {
  const message = String(value || "").trim();
  if (!message || message === LEGACY_COMPLAINT_CLOSED_MESSAGE) {
    return DEFAULT_ISSUE_CLOSED_MESSAGE;
  }
  return message;
};

const sanitizeComplaintSettings = (raw = {}, existing = {}) => {
  const allowStudentComplaints =
    raw?.allowStudentComplaints === undefined
      ? existing?.allowStudentComplaints !== false
      : !(raw?.allowStudentComplaints === false || raw?.allowStudentComplaints === "false");

  const fallbackMessage = normalizeIssueClosedMessage(existing?.closedMessage);

  const closedMessage =
    typeof raw?.closedMessage === "string" && raw.closedMessage.trim()
      ? normalizeIssueClosedMessage(raw.closedMessage)
      : fallbackMessage;

  return {
    allowStudentComplaints,
    closedMessage,
    updatedAt: new Date(),
  };
};

const formatComplaintSettings = (course) => ({
  allowStudentComplaints:
    course?.complaintSettings?.allowStudentComplaints !== false,
  closedMessage: normalizeIssueClosedMessage(
    course?.complaintSettings?.closedMessage
  ),
  updatedAt: course?.complaintSettings?.updatedAt || null,
});

// POST /api/courses  (teacher only)
const createCourse = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const {
      code,
      title,
      section,
      intake,
      shift,
      department,
      semester,
      year,
      courseType,
      creditHours,
      projectFeature,
      complaintSettings,
    } = req.body;

    if (!code || !title || !section || !shift || !department || !semester || !year) {
      return res.status(400).json({
        message: 'Course code, title, section, shift, department, semester, and year are required.',
      });
    }

    const normalizedShift = normalizeShift(shift);
    const normalizedDepartment = String(department || '').trim();

    if (!isProgramAllowedForShift(normalizedDepartment, normalizedShift)) {
      return res.status(400).json({
        message: `The selected department/program is not available for the ${normalizedShift} shift.`,
      });
    }

    const normalizedType = ALLOWED_COURSE_TYPES.includes(courseType)
      ? courseType
      : 'theory';

    const normalizedCreditHours = Number(creditHours);
    if (normalizedType === 'self_study') {
      if (!String(intake || '').trim()) {
        return res.status(400).json({ message: 'Intake is required for a Self Study Course.' });
      }
      if (!Number.isFinite(normalizedCreditHours) || normalizedCreditHours <= 0) {
        return res.status(400).json({ message: 'Credit hour must be a number greater than 0 for a Self Study Course.' });
      }
    }

    const course = new Course({
      code,
      title,
      section,
      intake: typeof intake === "string" ? intake.trim() : intake || "",
      shift: normalizedShift,
      department: normalizedDepartment,
      semester,
      year,
      courseType: normalizedType,
      creditHours: normalizedType === 'self_study' ? normalizedCreditHours : null,
      createdBy: teacherId,
      projectFeature: sanitizeProjectFeature(projectFeature),
      complaintSettings:
        complaintSettings !== undefined
          ? sanitizeComplaintSettings(complaintSettings)
          : undefined,
    });

    await course.save();

    // respond in the same "flat" format we use in getCourses
    res.json({
      id: course._id.toString(),
      code: course.code,
      title: course.title,
      section: course.section,
      intake: course.intake || "",
      shift: course.shift || "Day",
      department: course.department || "",
      program: course.department || "",
      semester: course.semester,
      year: course.year,
      courseType: course.courseType,
      creditHours: course.creditHours ?? null,
      complaintSettings: formatComplaintSettings(course),
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
      intake: c.intake || "",
      shift: c.shift || "Day",
      department: c.department || "",
      program: c.department || "",
      semester: c.semester,
      year: c.year,
      courseType: c.courseType,
      creditHours: c.creditHours ?? null,
      archived: c.archived ?? false,
      complaintSettings: formatComplaintSettings(c),
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
      intake,
      shift,
      department,
      semester,
      year,
      courseType,
      creditHours,
      archived,
      classTestPolicy,
      assignmentPolicy,
      projectFeature,
      complaintSettings,
    } = req.body;

    // ✅ build update dynamically (avoid undefined overwrite)
    const update = {};

    if (title !== undefined) update.title = String(title).trim();
    if (section !== undefined) update.section = String(section).trim();
    if (intake !== undefined) update.intake = String(intake).trim();
    if (semester !== undefined) update.semester = String(semester).trim();
    if (year !== undefined) update.year = Number(year);

    if (shift !== undefined || department !== undefined) {
      const existingCourseForAcademicFields = await Course.findOne({
        _id: id,
        createdBy: teacherId,
      }).select('shift department');

      if (!existingCourseForAcademicFields) {
        return res.status(404).json({ message: 'Course not found' });
      }

      const nextShift = normalizeShift(
        shift !== undefined ? shift : existingCourseForAcademicFields.shift || 'Day'
      );
      const nextDepartment = String(
        department !== undefined
          ? department
          : existingCourseForAcademicFields.department || ''
      ).trim();

      if (!nextDepartment) {
        return res.status(400).json({ message: 'Department/program is required.' });
      }

      if (!isProgramAllowedForShift(nextDepartment, nextShift)) {
        return res.status(400).json({
          message: `The selected department/program is not available for the ${nextShift} shift.`,
        });
      }

      update.shift = nextShift;
      update.department = nextDepartment;
    }

    if (courseType && ALLOWED_COURSE_TYPES.includes(courseType)) {
      update.courseType = String(courseType).toLowerCase();
    }

    if (courseType !== undefined || creditHours !== undefined || intake !== undefined) {
      const existingForSelfStudy = await Course.findOne({ _id: id, createdBy: teacherId })
        .select('courseType creditHours intake');
      if (!existingForSelfStudy) {
        return res.status(404).json({ message: 'Course not found' });
      }

      const nextType = String(update.courseType || existingForSelfStudy.courseType || 'theory').toLowerCase();
      if (nextType === 'self_study') {
        const nextIntake = String(update.intake !== undefined ? update.intake : existingForSelfStudy.intake || '').trim();
        const nextCreditHours = Number(creditHours !== undefined ? creditHours : existingForSelfStudy.creditHours);
        if (!nextIntake) {
          return res.status(400).json({ message: 'Intake is required for a Self Study Course.' });
        }
        if (!Number.isFinite(nextCreditHours) || nextCreditHours <= 0) {
          return res.status(400).json({ message: 'Credit hour must be a number greater than 0 for a Self Study Course.' });
        }
        update.creditHours = nextCreditHours;
      } else if (courseType !== undefined) {
        update.creditHours = null;
      }
    }

    if (classTestPolicy !== undefined) {
      const existingCourseForPolicy = await Course.findOne({ _id: id, createdBy: teacherId })
        .select('courseType');

      if (!existingCourseForPolicy) {
        return res.status(404).json({ message: "Course not found" });
      }

      const sanitizedPolicy = sanitizeClassTestPolicy(classTestPolicy);
      const nextCourseType = String(
        update.courseType || existingCourseForPolicy.courseType || 'theory'
      ).toLowerCase();
      const maxCtWeight = getMaxCtWeight(nextCourseType);

      if (nextCourseType !== 'lab' && sanitizedPolicy.totalWeight > maxCtWeight) {
        return res.status(400).json({
          message: getCtWeightLimitMessage(nextCourseType, maxCtWeight),
        });
      }

      update.classTestPolicy = sanitizedPolicy;
    }

    if (assignmentPolicy !== undefined) {
      update.assignmentPolicy = sanitizeAssignmentPolicy(assignmentPolicy);
    }

    if (projectFeature !== undefined) {
      update.projectFeature = sanitizeProjectFeature(projectFeature);
    }

    if (complaintSettings !== undefined) {
      const existingCourse = await Course.findOne({ _id: id, createdBy: teacherId })
        .select("complaintSettings");

      if (!existingCourse) {
        return res.status(404).json({ message: "Course not found" });
      }

      update.complaintSettings = sanitizeComplaintSettings(
        complaintSettings,
        existingCourse.complaintSettings || {}
      );
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
      SelfStudyBillConfig.deleteMany({ course: courseId }),
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
