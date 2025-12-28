// ===========================================
// enrollmentController.js  (FULL CLEAN VERSION)
// ===========================================

const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const Course = require("../models/Course");

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

    const enrollments = await Enrollment.find({ course: courseId }).populate(
      "student"
    );

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
// ===============================================================
exports.removeStudentFromCourse = async (req, res) => {
  try {
    const { courseId, enrollmentId } = req.params;

    const enrollment = await Enrollment.findOne({
      _id: enrollmentId,
      course: courseId,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json({ message: "Enrollment not found for this course." });
    }

    await enrollment.deleteOne();

    return res.json({ message: "Student removed from course." });
  } catch (err) {
    console.error("Remove Student Error:", err);
    return res.status(500).json({ message: "Failed to remove student." });
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
      return res.status(404).json({
        message: "Student is not enrolled in this course.",
      });
    }

    const student = enrollment.student;
    if (!student) {
      return res.status(404).json({
        message: "Student account not found.",
      });
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
    return res.status(500).json({
      message: "Failed to export students",
    });
  }
};

