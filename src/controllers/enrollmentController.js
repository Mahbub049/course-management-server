// ===========================================
// enrollmentController.js  (FULL CLEAN VERSION)
// ===========================================

const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const Course = require("../models/Course");
const Mark = require("../models/Mark"); // ✅ NEW (needed to delete marks)
const ObeStudentMark = require("../models/ObeStudentMark");
const AttendanceSummary = require("../models/AttendanceSummary");
const Attendance = require("../models/Attendance");
const LabSubmission = require("../models/LabSubmission");
const NotebookNote = require("../models/NotebookNote");
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
// Bulk-pasted tables often contain a third column such as "Regular".
// Treat a value as an email only when it actually looks like one.
const normalizeEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined;
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

    // Ensure this teacher owns the target course
    const course = await getTeacherCourseOr404(courseId, req.user?.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found (or not yours)." });
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

    const course = await getTeacherCourseOr404(courseId, req.user?.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found (or not yours)." });
    }

    const results = [];

    const seenRolls = new Set();

    for (const row of students) {
      const roll = String(row?.roll || "").replace(/\u200B/g, "").trim();
      const name = String(row?.name || "").replace(/\s+/g, " ").trim();
      const emailValue = normalizeEmail(row?.email);

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

      if (seenRolls.has(roll)) {
        results.push({
          roll,
          name,
          email: emailValue || null,
          status: "skipped",
          note: "Duplicate roll in pasted list",
        });
        continue;
      }
      seenRolls.add(roll);

      try {
        let temporaryPassword = null;
        let note = "";

        // Find or create account by student roll.
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
          note =
            student.name && student.name.trim() !== name
              ? `Existing student enrolled (saved name: ${student.name})`
              : "Existing student enrolled";
        }

        let enrollment = await Enrollment.findOne({
          course: courseId,
          student: student._id,
        });

        const wasAlreadyEnrolled = Boolean(enrollment);
        if (!enrollment) {
          enrollment = await Enrollment.create({
            course: courseId,
            student: student._id,
            temporaryPassword: temporaryPassword || undefined,
          });
        }

        results.push({
          roll,
          name: student.name || name,
          email: student.email || null,
          status: temporaryPassword
            ? "created"
            : wasAlreadyEnrolled
              ? "already_enrolled"
              : "existing",
          enrollmentId: enrollment._id,
          studentId: student._id,
          temporaryPassword,
          note: wasAlreadyEnrolled ? "Already enrolled in this course" : note,
        });
      } catch (rowError) {
        console.error(`Bulk Add Row Error (${roll}):`, rowError);
        results.push({
          roll,
          name,
          email: emailValue || null,
          status: "error",
          note:
            rowError?.code === 11000
              ? "A student account already uses the same username or email"
              : "Could not add this row",
        });
      }
    }

    return res.json({ results });
  } catch (err) {
    console.error("Bulk Add Error:", err);
    return res.status(500).json({ message: "Failed to bulk add students." });
  }
};

// ===============================================================
// 2B️⃣ COPY STUDENTS FROM ANOTHER COURSE
// Enrolls the same student accounts only. Marks, attendance, OBE
// data and temporary passwords are intentionally NOT copied.
// ===============================================================
exports.copyStudentsFromCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { sourceCourseId } = req.body || {};
    const teacherId = req.user?.userId;

    if (!sourceCourseId) {
      return res.status(400).json({ message: "Source course is required." });
    }

    if (String(sourceCourseId) === String(courseId)) {
      return res.status(400).json({ message: "Source and target course cannot be the same." });
    }

    const [targetCourse, sourceCourse] = await Promise.all([
      getTeacherCourseOr404(courseId, teacherId),
      getTeacherCourseOr404(sourceCourseId, teacherId),
    ]);

    if (!targetCourse) {
      return res.status(404).json({ message: "Target course not found (or not yours)." });
    }
    if (!sourceCourse) {
      return res.status(404).json({ message: "Source course not found (or not yours)." });
    }

    const sourceEnrollments = await Enrollment.find({ course: sourceCourseId })
      .select("student")
      .lean();

    const studentIds = sourceEnrollments
      .map((item) => item.student)
      .filter(Boolean);

    if (!studentIds.length) {
      return res.json({
        message: "The selected source course has no students.",
        sourceCount: 0,
        copiedCount: 0,
        alreadyEnrolledCount: 0,
      });
    }

    const existing = await Enrollment.find({
      course: courseId,
      student: { $in: studentIds },
    })
      .select("student")
      .lean();

    const existingIds = new Set(existing.map((item) => String(item.student)));
    const missingIds = studentIds.filter((id) => !existingIds.has(String(id)));

    if (missingIds.length) {
      await Enrollment.bulkWrite(
        missingIds.map((studentId) => ({
          updateOne: {
            filter: { course: courseId, student: studentId },
            update: {
              $setOnInsert: {
                course: courseId,
                student: studentId,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    return res.json({
      message: "Students copied successfully.",
      sourceCount: studentIds.length,
      copiedCount: missingIds.length,
      alreadyEnrolledCount: studentIds.length - missingIds.length,
      sourceCourse: {
        id: sourceCourse._id,
        code: sourceCourse.code,
        section: sourceCourse.section,
        semester: sourceCourse.semester,
        year: sourceCourse.year,
      },
    });
  } catch (err) {
    console.error("Copy Students From Course Error:", err);
    return res.status(500).json({
      message: "Failed to copy students from the selected course.",
    });
  }
};

// ===============================================================
// 3️⃣ GET STUDENTS
// ===============================================================
exports.getCourseStudents = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await getTeacherCourseOr404(courseId, req.user?.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found (or not yours)." });
    }

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
// 3B️⃣ UPDATE STUDENT ACCOUNT DETAILS
// Changing the roll changes the student's login username globally. Because a few
// older modules store a roll snapshot, those snapshots are kept in sync too.
// ===============================================================
exports.updateCourseStudent = async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const teacherId = req.user?.userId;
    const roll = String(req.body?.roll || "").replace(/\u200B/g, "").trim();
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
    const emailValue = normalizeEmail(req.body?.email);

    if (!roll || !name) {
      return res.status(400).json({ message: "Roll and name are required." });
    }

    if (!/^\d{6,20}$/.test(roll)) {
      return res.status(400).json({ message: "Student roll must contain 6 to 20 digits." });
    }

    const course = await getTeacherCourseOr404(courseId, teacherId);
    if (!course) {
      return res.status(404).json({ message: "Course not found (or not yours)." });
    }

    const enrollment = await Enrollment.findOne({
      course: courseId,
      student: studentId,
    }).populate("student");

    if (!enrollment?.student || enrollment.student.role !== "student") {
      return res.status(404).json({ message: "Student is not enrolled in this course." });
    }

    const student = enrollment.student;
    const oldRoll = String(student.username || "").trim();

    const rollOwner = await User.findOne({
      username: roll,
      _id: { $ne: student._id },
    }).select("_id");
    if (rollOwner) {
      return res.status(409).json({ message: "Another account already uses this roll number." });
    }

    if (emailValue) {
      const emailOwner = await User.findOne({
        email: emailValue,
        _id: { $ne: student._id },
      }).select("_id");
      if (emailOwner) {
        return res.status(409).json({ message: "Another account already uses this email address." });
      }
    }

    student.username = roll;
    student.name = name;
    student.email = emailValue || undefined;
    await student.save();

    // Keep denormalized roll/name snapshots consistent with the account.
    const studentEnrollments = await Enrollment.find({ student: student._id })
      .select("course")
      .lean();
    const enrolledCourseIds = studentEnrollments.map((item) => item.course).filter(Boolean);

    const syncJobs = [];
    if (oldRoll && oldRoll !== roll && enrolledCourseIds.length) {
      syncJobs.push(
        Attendance.updateMany(
          { course: { $in: enrolledCourseIds }, "records.roll": oldRoll },
          { $set: { "records.$[row].roll": roll } },
          { arrayFilters: [{ "row.roll": oldRoll }] }
        )
      );
      syncJobs.push(
        LabSubmission.updateMany(
          { student: student._id },
          { $set: { roll } }
        )
      );
    }

    syncJobs.push(
      NotebookNote.updateMany(
        { "evaluationRows.student": student._id },
        {
          $set: {
            "evaluationRows.$[row].roll": roll,
            "evaluationRows.$[row].name": name,
          },
        },
        { arrayFilters: [{ "row.student": student._id }] }
      )
    );

    await Promise.all(syncJobs);

    return res.json({
      message: "Student details updated successfully.",
      student: {
        id: student._id,
        roll: student.username,
        name: student.name,
        email: student.email || null,
      },
      loginChanged: oldRoll !== roll,
    });
  } catch (err) {
    console.error("Update Student Error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({ message: "The roll number or email is already in use." });
    }
    return res.status(500).json({ message: "Failed to update student details." });
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

    // Remove every course-level mark record that can keep the student visible
    // in the standard marks and OBE workspaces.
    await Promise.all([
      Mark.deleteMany({ course: courseId, student: studentId }),
      ObeStudentMark.deleteMany({ course: courseId, student: studentId }),
      AttendanceSummary.deleteMany({ course: courseId, student: studentId }),
      enrollment.deleteOne(),
    ]);

    return res.json({
      message: "Student removed from course and all related marks were deleted.",
    });
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

    const [enrResult, markResult, obeMarkResult, attendanceResult] =
      await Promise.all([
        Enrollment.deleteMany({ course: courseId }),
        Mark.deleteMany({ course: courseId }),
        ObeStudentMark.deleteMany({ course: courseId }),
        AttendanceSummary.deleteMany({ course: courseId }),
      ]);

    return res.json({
      message: "All students removed from course.",
      removedEnrollments: enrResult?.deletedCount || 0,
      deletedMarks: markResult?.deletedCount || 0,
      deletedObeMarks: obeMarkResult?.deletedCount || 0,
      deletedAttendanceSummaries: attendanceResult?.deletedCount || 0,
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
// 5B️⃣ RESET ALL STUDENT PASSWORDS (Regenerate All)
// ===============================================================
exports.resetAllStudentPasswords = async (req, res) => {
  try {
    const { courseId } = req.params;

    const enrollments = await Enrollment.find({ course: courseId }).populate("student");

    if (!enrollments.length) {
      return res.status(404).json({ message: "No students found in this course." });
    }

    const updatedStudents = [];

    for (const enrollment of enrollments) {
      const student = enrollment.student;
      if (!student) continue;

      const newPassword = generateRandomPassword();

      if (typeof student.setPassword === "function") {
        await student.setPassword(newPassword);
      } else {
        student.password = newPassword;
      }

      await student.save();

      enrollment.temporaryPassword = newPassword;
      await enrollment.save();

      updatedStudents.push({
        enrollmentId: enrollment._id,
        studentId: student._id,
        roll: student.username,
        name: student.name,
        email: student.email || null,
        temporaryPassword: newPassword,
      });
    }

    return res.json({
      message: "All student passwords regenerated successfully.",
      totalUpdated: updatedStudents.length,
      students: updatedStudents,
    });
  } catch (err) {
    console.error("Reset All Passwords Error:", err);
    return res.status(500).json({ message: "Failed to reset all student passwords." });
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
