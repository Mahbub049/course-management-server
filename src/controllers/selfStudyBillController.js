const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const SelfStudyBillConfig = require("../models/SelfStudyBillConfig");
const { resolveSelfStudyFee, normalizeIntake } = require("../utils/selfStudyFeeSchedule");
const { generateSelfStudyBillDocument } = require("../utils/selfStudyBillDocumentGenerator");

function extractCourseIntakes(value) {
  return [...new Set((String(value || "").match(/\d+/g) || []).map(Number).filter(Number.isFinite))];
}

async function getOwnedSelfStudyCourse(courseId, teacherId) {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
}

async function saveIntakeMappings(course, teacherId, mappings = []) {
  const enrollments = await Enrollment.find({ course: course._id }).select("student");
  const allowed = new Set(enrollments.map((row) => String(row.student)));
  const normalized = [];
  for (const item of Array.isArray(mappings) ? mappings : []) {
    const studentId = String(item?.studentId || "");
    const intake = normalizeIntake(item?.intake);
    if (!allowed.has(studentId)) continue;
    if (!intake) continue;
    normalized.push({ student: studentId, intake: String(intake) });
  }

  return SelfStudyBillConfig.findOneAndUpdate(
    { course: course._id },
    { $set: { teacher: teacherId, studentIntakes: normalized } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function buildPreview(course, teacherId) {
  const [teacher, enrollments, config] = await Promise.all([
    User.findById(teacherId).select("name shortCode designation department"),
    Enrollment.find({ course: course._id }).populate("student", "username name").sort({ createdAt: 1 }),
    SelfStudyBillConfig.findOne({ course: course._id, teacher: teacherId }),
  ]);

  const mappings = new Map(
    (config?.studentIntakes || []).map((item) => [String(item.student), String(item.intake || "")])
  );
  const courseIntakes = extractCourseIntakes(course.intake);
  const singleDefaultIntake = courseIntakes.length === 1 ? String(courseIntakes[0]) : "";
  const creditHours = Number(course.creditHours || 0);

  const students = enrollments.map((enrollment) => {
    const student = enrollment.student;
    const studentId = String(student?._id || enrollment.student || "");
    const intake = mappings.get(studentId) || singleDefaultIntake;
    const fee = resolveSelfStudyFee({
      program: course.department,
      shift: course.shift,
      intake,
    });
    const studentPaid = fee && creditHours > 0 ? fee.tuitionFeePerCredit * creditHours : null;
    const facultyPayment = studentPaid !== null ? studentPaid / 2 : null;

    return {
      studentId,
      enrollmentId: String(enrollment._id),
      roll: student?.username || "",
      name: student?.name || "",
      intake,
      semesterCharge: fee?.semesterCharge ?? null,
      tuitionFeePerCredit: fee?.tuitionFeePerCredit ?? null,
      program: fee?.program || course.department || "",
      studentPaid,
      facultyPayment,
      feeResolved: Boolean(fee && creditHours > 0),
    };
  });

  const resolvedStudents = students.filter((row) => row.feeResolved);
  const totalStudentPaid = resolvedStudents.reduce((sum, row) => sum + Number(row.studentPaid || 0), 0);
  const totalFacultyPayment = resolvedStudents.reduce((sum, row) => sum + Number(row.facultyPayment || 0), 0);

  const feeMap = new Map();
  resolvedStudents.forEach((row) => {
    const key = `${row.intake}|${row.tuitionFeePerCredit}`;
    if (!feeMap.has(key)) {
      feeMap.set(key, {
        intake: Number(row.intake),
        program: row.program,
        semesterCharge: row.semesterCharge,
        tuitionFeePerCredit: row.tuitionFeePerCredit,
        studentPaid: row.studentPaid,
        facultyPayment: row.facultyPayment,
        studentCount: 0,
      });
    }
    feeMap.get(key).studentCount += 1;
  });

  const feeDetails = [...feeMap.values()].sort((a, b) => Number(a.intake) - Number(b.intake));
  const unresolvedCount = students.length - resolvedStudents.length;

  return {
    course: {
      id: String(course._id),
      code: course.code,
      title: course.title,
      section: course.section,
      intake: course.intake || "",
      shift: course.shift || "Day",
      department: course.department || "",
      semester: course.semester,
      year: course.year,
      courseType: course.courseType,
      creditHours,
    },
    faculty: {
      name: teacher?.name || "",
      shortCode: teacher?.shortCode || "",
      designation: teacher?.designation || "Lecturer",
      department: teacher?.department || "",
    },
    availableIntakes: courseIntakes,
    students,
    feeDetails,
    totals: {
      students: students.length,
      totalStudentPaid,
      totalFacultyPayment,
    },
    readyToGenerate:
      students.length > 0 &&
      unresolvedCount === 0 &&
      creditHours > 0 &&
      Boolean(teacher?.name && teacher?.shortCode),
    unresolvedCount,
  };
}

exports.getSelfStudyBill = async (req, res) => {
  try {
    const course = await getOwnedSelfStudyCourse(req.params.courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found." });
    if (course.courseType !== "self_study") {
      return res.status(400).json({ message: "Bill Generate is available only for Self Study courses." });
    }
    return res.json(await buildPreview(course, req.user.userId));
  } catch (error) {
    console.error("Self-study bill preview error:", error);
    return res.status(500).json({ message: "Failed to prepare self-study bill." });
  }
};

exports.updateSelfStudyBillIntakes = async (req, res) => {
  try {
    const course = await getOwnedSelfStudyCourse(req.params.courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found." });
    if (course.courseType !== "self_study") {
      return res.status(400).json({ message: "This is not a Self Study course." });
    }
    await saveIntakeMappings(course, req.user.userId, req.body?.students || []);
    return res.json(await buildPreview(course, req.user.userId));
  } catch (error) {
    console.error("Self-study intake update error:", error);
    return res.status(500).json({ message: "Failed to update student intake information." });
  }
};

exports.downloadSelfStudyBill = async (req, res) => {
  try {
    const course = await getOwnedSelfStudyCourse(req.params.courseId, req.user.userId);
    if (!course) return res.status(404).json({ message: "Course not found." });
    if (course.courseType !== "self_study") {
      return res.status(400).json({ message: "Bill Generate is available only for Self Study courses." });
    }

    if (Array.isArray(req.body?.students)) {
      await saveIntakeMappings(course, req.user.userId, req.body.students);
    }

    const preview = await buildPreview(course, req.user.userId);
    if (!preview.readyToGenerate) {
      const reason = !preview.students.length
        ? "Add students to the course before generating the bill."
        : preview.unresolvedCount
        ? "Some student intakes do not match the stored fee schedule. Fix their intake values first."
        : "Faculty profile or credit-hour information is incomplete.";
      return res.status(400).json({ message: reason, preview });
    }

    const buffer = await generateSelfStudyBillDocument({
      ...preview,
      totalFacultyPayment: preview.totals.totalFacultyPayment,
    });
    const safeCode = String(course.code || "course").replace(/[^a-z0-9]+/gi, "_");
    const safeSemester = `${course.semester || ""}_${course.year || ""}`.replace(/[^a-z0-9]+/gi, "_");
    const filename = `${preview.faculty.shortCode || "Faculty"}_Self_Study_Payment_${safeSemester}_${safeCode}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Self-study bill download error:", error);
    return res.status(500).json({ message: "Failed to generate the self-study payment document." });
  }
};
