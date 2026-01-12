// ===========================================
// enrollmentController.js  (FULL CLEAN VERSION)
// ===========================================

const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const Course = require("../models/Course");
const Mark = require("../models/Mark"); // ✅ NEW (needed to delete marks)
const { sendMail } = require("../utils/mailer");

// ---------------------------------------------
// HELPER: Generate Random Password
// ---------------------------------------------
const generateRandomPassword = (length = 8) => {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$!";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

// small helper: normalize email (avoid null/empty string duplicates)
const normalizeEmail = (email) => {
  const e = (email || "").trim();
  return e ? e : undefined; // ✅ IMPORTANT: never return null
};

// ✅ helper: ensure teacher owns the course
const getTeacherCourseOr404 = async (courseId, teacherId) => {
  const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
  return course;
};

// ===============================================================
// 1️⃣ ADD SINGLE STUDENT TO COURSE
// ===============================================================
exports.addStudentToCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { roll, name, email } = req.body;

    if (!roll || !name) {
      return res.status(400).json({ message: "Roll and Name are required." });
    }

    // Ensure course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found." });
    }

    const emailValue = normalizeEmail(email);

    // Try to find existing user
    let student = await User.findOne({ username: roll, role: "student" });

    let temporaryPassword = null;
    let note = "";

    if (!student) {
      // Create brand new student account
      const password = generateRandomPassword();
      temporaryPassword = password;

      const userData = {
        username: roll,
        name,
        role: "student",
      };
      if (emailValue) userData.email = emailValue;

      student = new User(userData);

      if (typeof student.setPassword === "function") {
        await student.setPassword(password);
      } else {
        student.password = password;
      }

      await student.save();
      note = "New account created & enrolled";
    } else {
      note = "Existing student account found";
    }

    // Check if already enrolled
    let enrollment = await Enrollment.findOne({
      course: courseId,
      student: student._id,
    });

    if (!enrollment) {
      enrollment = await Enrollment.create({
        course: courseId,
        student: student._id,
        temporaryPassword: temporaryPassword || undefined,
      });

      if (!temporaryPassword) {
        note = "Existing account enrolled";
      }
    } else {
      // If already enrolled and we created a new password (rare case), keep it stored
      if (temporaryPassword) {
        enrollment.temporaryPassword = temporaryPassword;
        await enrollment.save();
      }
    }

    return res.json({
      enrollmentId: enrollment._id,
      student: {
        id: student._id,
        roll: student.username,
        name: student.name,
        email: student.email || null,
      },
      temporaryPassword,
      note,
    });
  } catch (err) {
    console.error("Add Student Error:", err);
    return res.status(500).json({ message: "Failed to add student to course." });
  }
};

// ===============================================================
// 2️⃣ BULK ADD STUDENTS
// ===============================================================
exports.bulkAddStudentsToCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { students } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: "Students array is required." });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found." });
    }

    const results = [];

    for (const row of students) {
      const roll = (row.roll || "").trim();
      const name = (row.name || "").trim();
      const emailValue = normalizeEmail(row.email);

      if (!roll || !name) {
        results.push({
          roll,
          name,
          email: emailValue || null,
          status: "error",
          note: "Invalid row — roll and name required",
        });
        continue;
      }

      let temporaryPassword = null;
      let note = "";

      // Find or create account
      let student = await User.findOne({ username: roll, role: "student" });

      if (!student) {
        const password = generateRandomPassword();
        temporaryPassword = password;

        const userData = {
          username: roll,
          name,
          role: "student",
        };
        if (emailValue) userData.email = emailValue;

        student = new User(userData);

        if (typeof student.setPassword === "function") {
          await student.setPassword(password);
        } else {
          student.password = password;
        }

        await student.save();
        note = "New student created & enrolled";
      } else {
        note = "Existing student enrolled";
      }

      // Check if already enrolled
      let enrollment = await Enrollment.findOne({
        course: courseId,
        student: student._id,
      });

      if (!enrollment) {
        enrollment = await Enrollment.create({
          course: courseId,
          student: student._id,
          temporaryPassword: temporaryPassword || undefined,
        });
      } else {
        // If newly created now, store its temp password
        if (temporaryPassword) {
          enrollment.temporaryPassword = temporaryPassword;
          await enrollment.save();
        }
      }

      results.push({
        roll,
        name,
        email: student.email || null,
        status: temporaryPassword ? "created" : "existing",
        enrollmentId: enrollment._id,
        studentId: student._id,
        temporaryPassword,
        note,
      });
    }

    return res.json({ results });
  } catch (err) {
    console.error("Bulk Add Error:", err);
    return res.status(500).json({ message: "Failed to bulk add students." });
  }
};

// ===============================================================
// 3️⃣ GET STUDENTS
// ===============================================================
exports.getCourseStudents = async (req, res) => {
  try {
    const { courseId } = req.params;

    const enrollments = await Enrollment.find({ course: courseId }).populate("student");

    const list = enrollments.map((enr) => ({
      enrollmentId: enr._id,
      id: enr.student?._id,
      roll: enr.student?.username,
      name: enr.student?.name,
      email: enr.student?.email || null,
      temporaryPassword: enr.temporaryPassword || null,
    }));

    return res.json(list);
  } catch (err) {
    console.error("Get Students Error:", err);
    return res.status(500).json({ message: "Failed to load course students." });
  }
};

// ===============================================================
// 4️⃣ REMOVE STUDENT FROM COURSE  (by enrollmentId)
// ✅ UPDATED: also delete their marks for this course
// ===============================================================
exports.removeStudentFromCourse = async (req, res) => {
  try {
    const { courseId, enrollmentId } = req.params;

    const enrollment = await Enrollment.findOne({
      _id: enrollmentId,
      course: courseId,
    });

    if (!enrollment) {
      return res.status(404).json({ message: "Enrollment not found for this course." });
    }

    const studentId = enrollment.student;

    // ✅ delete marks for this student in this course
    await Mark.deleteMany({ course: courseId, student: studentId });

    await enrollment.deleteOne();

    return res.json({ message: "Student removed from course (and marks deleted)." });
  } catch (err) {
    console.error("Remove Student Error:", err);
    return res.status(500).json({ message: "Failed to remove student." });
  }
};

// ===============================================================
// ✅ NEW: REMOVE ALL STUDENTS FROM COURSE
// Deletes enrollments + marks for this course
// DELETE /api/courses/:courseId/students
// ===============================================================
exports.removeAllStudentsFromCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const teacherId = req.user?.userId;

    // ✅ ensure teacher owns this course
    const course = await getTeacherCourseOr404(courseId, teacherId);
    if (!course) {
      return res.status(404).json({ message: "Course not found (or not yours)." });
    }

    const [enrResult, markResult] = await Promise.all([
      Enrollment.deleteMany({ course: courseId }),
      Mark.deleteMany({ course: courseId }),
    ]);

    return res.json({
      message: "All students removed from course.",
      removedEnrollments: enrResult?.deletedCount || 0,
      deletedMarks: markResult?.deletedCount || 0,
    });
  } catch (err) {
    console.error("Remove All Students Error:", err);
    return res.status(500).json({ message: "Failed to remove all students." });
  }
};

// ===============================================================
// 5️⃣ RESET STUDENT PASSWORD (Regenerate)  (by studentId)
// ===============================================================
exports.resetStudentPassword = async (req, res) => {
  try {
    const { courseId, studentId } = req.params;

    const enrollment = await Enrollment.findOne({
      course: courseId,
      student: studentId,
    }).populate("student");

    if (!enrollment) {
      return res.status(404).json({ message: "Student is not enrolled in this course." });
    }

    const student = enrollment.student;
    if (!student) {
      return res.status(404).json({ message: "Student account not found." });
    }

    const newPassword = generateRandomPassword();

    if (typeof student.setPassword === "function") {
      await student.setPassword(newPassword);
    } else {
      student.password = newPassword;
    }

    await student.save();

    enrollment.temporaryPassword = newPassword;
    await enrollment.save();

    return res.json({
      enrollmentId: enrollment._id,
      student: {
        id: student._id,
        roll: student.username,
        name: student.name,
        email: student.email || null,
      },
      temporaryPassword: newPassword,
      note: "Password regenerated successfully",
    });
  } catch (err) {
    console.error("Password Reset Error:", err);
    return res.status(500).json({ message: "Failed to reset student password." });
  }
};

// ===============================================================
// 6️⃣ EXPORT STUDENTS (Excel)
// ===============================================================
exports.exportCourseStudents = async (req, res) => {
  try {
    const { courseId } = req.params;

    const enrollments = await Enrollment.find({ course: courseId })
      .populate("student")
      .sort({ "student.username": 1 });

    const rows = enrollments.map((enr) => ({
      Roll: enr.student?.username || "",
      Name: enr.student?.name || "",
      Email: enr.student?.email || "",
      Password: enr.temporaryPassword || "",
    }));

    return res.json(rows);
  } catch (err) {
    console.error("Export Students Error:", err);
    return res.status(500).json({ message: "Failed to export students" });
  }
};

// ===============================================================
// 7️⃣ SEND PASSWORD EMAILS (to enrolled students)
// ===============================================================
exports.sendPasswordsByEmail = async (req, res) => {
  try {
    const { courseId } = req.params;

    // optional custom message from teacher
    const customMessage =
      (req.body?.message || "").trim() ||
      "Please use the following credentials to login. After login, change your password immediately.";

    const enrollments = await Enrollment.find({ course: courseId })
      .populate("student")
      .populate("course")
      .lean();

    if (!enrollments.length) {
      return res.status(404).json({ message: "No enrolled students found." });
    }

    const subject = req.body?.subject?.trim() || `BUBT Marks Portal Login Credentials`;

    const results = {
      total: enrollments.length,
      sent: 0,
      skippedNoEmail: 0,
      skippedNoPassword: 0,
      failed: 0,
      details: [],
    };

    // ⚠️ Send sequentially to avoid SMTP rate limits
    for (const enr of enrollments) {
      const student = enr.student;
      const to = student?.email;
      const username = student?.username || "";
      const password = enr.temporaryPassword || "";

      if (!to) {
        results.skippedNoEmail++;
        results.details.push({ username, status: "skipped", reason: "No email" });
        continue;
      }

      if (!password) {
        results.skippedNoPassword++;
        results.details.push({
          username,
          email: to,
          status: "skipped",
          reason: "No temporary password saved",
        });
        continue;
      }

      const html = `
        <div style="font-family: Arial, sans-serif; line-height:1.6;">
          <h3 style="margin:0 0 8px;">BUBT Marks Portal</h3>
          <p style="margin:0 0 12px;">${customMessage}</p>

          <div style="border:1px solid #e5e7eb; padding:12px; border-radius:8px;">
            <p style="margin:0;"><b>Username (Roll):</b> ${username}</p>
            <p style="margin:6px 0 0;"><b>Temporary Password:</b> ${password}</p>
          </div>

          <p style="margin:12px 0 0; color:#475569; font-size:13px;">
            ⚠️ Please change your password after first login.
          </p>
        </div>
      `;

      try {
        await sendMail({ to, subject, html });
        results.sent++;
        results.details.push({ username, email: to, status: "sent" });
      } catch (e) {
        results.failed++;
        results.details.push({
          username,
          email: to,
          status: "failed",
          reason: e.message,
        });
      }
    }

    return res.json(results);
  } catch (err) {
    console.error("Send Password Emails Error:", err);
    return res.status(500).json({ message: "Failed to send emails." });
  }
};
