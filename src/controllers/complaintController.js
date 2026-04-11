// server/src/controllers/complaintController.js

const Complaint = require("../models/Complaint");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");
const Attendance = require("../models/Attendance");

// helper: basic YYYY-MM-DD check
function isValidYMD(s) {
  if (!s || typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYMD(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return { y, m, d };
}

function dateOnly(dateStr) {
  const { y, m, d } = parseYMD(dateStr);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

// ---------- Student: create complaint ----------
const createStudentComplaint = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const studentId = req.user.userId;

    const {
      courseId,
      assessmentId,
      message,
      category = "marks",
      attendanceRef, // { date:"YYYY-MM-DD", period:2 }
    } = req.body;

    if (!courseId || !message || !message.trim()) {
      return res.status(400).json({ message: "courseId and message are required" });
    }

    const allowedCategories = ["marks", "attendance", "general"];
    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ message: "Invalid category" });
    }

    // ✅ Validate assessment belongs to course (only if provided)
    if (assessmentId) {
      const assessment = await Assessment.findById(assessmentId);
      if (!assessment || assessment.course.toString() !== courseId) {
        return res.status(400).json({ message: "Invalid assessment" });
      }
    }

    // ✅ Attendance validation (only for attendance category)
    let cleanedAttendanceRef = null;
    if (category === "attendance") {
      const d = attendanceRef?.date;
      const p = Number(attendanceRef?.period);

      if (!isValidYMD(d) || !p || p < 1) {
        return res.status(400).json({
          message:
            "attendanceRef.date (YYYY-MM-DD) and attendanceRef.period (>=1) are required for attendance complaints",
        });
      }

      cleanedAttendanceRef = { date: d, period: p };
    }

    // ✅ Find teacher for this course (Enrollment -> fallback Course.createdBy)
    let teacherId = null;

    // 1) Try Enrollment.teacher (if you store teacher in Enrollment)
    const teacherEnrollment = await Enrollment.findOne({
      course: courseId,
      teacher: { $ne: null },
    }).populate("teacher");

    if (teacherEnrollment?.teacher?._id) {
      teacherId = teacherEnrollment.teacher._id;
    }

    // 2) Fallback: use Course.createdBy
    if (!teacherId) {
      const courseDoc = await Course.findById(courseId).select("createdBy");
      if (courseDoc?.createdBy) teacherId = courseDoc.createdBy;
    }

    if (!teacherId) {
      return res.status(400).json({ message: "No teacher assigned to this course" });
    }

    const complaint = new Complaint({
      student: studentId,
      teacher: teacherId,
      course: courseId,

      // marks complaints can include assessment, other categories usually don't
      assessment: assessmentId || null,

      category,
      attendanceRef: cleanedAttendanceRef, // null unless attendance category
      message: message.trim(),
      status: "open",
    });

    await complaint.save();

    // return populated response (nice for frontend immediate UI)
    const populated = await Complaint.findById(complaint._id)
      .populate("course", "code title section year semester")
      .populate("assessment", "name")
      .populate("student", "name roll username");

    res.status(201).json(populated);
  } catch (err) {
    console.error("createStudentComplaint error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------- Student: get own complaints ----------
const getStudentComplaints = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const complaints = await Complaint.find({ student: req.user.userId })
      .populate("course", "code title section year semester")
      .populate("assessment", "name")
      .sort({ createdAt: -1 });

    res.json(complaints);
  } catch (err) {
    console.error("getStudentComplaints error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------- Teacher: get complaints ----------
const getTeacherComplaints = async (req, res) => {
  try {
    const teacherId = req.user.userId;

    // Match same "current course" logic used in courseController
    const ownedCourses = await Course.find({
      createdBy: teacherId,
      $or: [
        { archived: false },
        { archived: { $exists: false } },
      ],
    }).select("_id");

    const ownedCourseIds = ownedCourses.map((c) => c._id);

    const complaints = await Complaint.find({
      $or: [
        { teacher: teacherId },
        { course: { $in: ownedCourseIds } },
      ],
    })
      .populate({
        path: "course",
        select: "code title section year semester archived createdBy",
        match: {
          $or: [
            { archived: false },
            { archived: { $exists: false } },
          ],
        },
      })
      .populate("student", "username name roll")
      .populate("assessment", "name")
      .sort({ createdAt: -1 });

    const filteredComplaints = complaints.filter((c) => c.course);

    res.json(filteredComplaints);
  } catch (err) {
    console.error("getTeacherComplaints error", err);
    res.status(500).json({ message: "Server error" });
  }
};
// ---------- Teacher: reply ----------
const ALLOWED_STATUS = ["open", "in_review", "resolved", "rejected"];

const replyToComplaint = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { id } = req.params;
    const { reply, status } = req.body;

    const complaint = await Complaint.findById(id).populate("course", "createdBy code title");
    if (!complaint) return res.status(404).json({ message: "Complaint not found" });

    // Authorization: either complaint.teacher matches OR teacher owns the course
    const complaintTeacherMatch =
      complaint.teacher && complaint.teacher.toString() === teacherId;

    const courseOwnerMatch =
      complaint.course &&
      complaint.course.createdBy &&
      complaint.course.createdBy.toString() === teacherId;

    if (!complaintTeacherMatch && !courseOwnerMatch) {
      return res.status(403).json({ message: "Not allowed to update this complaint" });
    }

    if (reply !== undefined) complaint.reply = reply;

    if (status !== undefined) {
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      complaint.status = status;
    }

    await complaint.save();

    const populated = await Complaint.findById(complaint._id)
      .populate("student", "name roll username")
      .populate("course", "code title section year semester")
      .populate("assessment", "name");

    res.json(populated);
  } catch (err) {
    console.error("replyToComplaint error", err);
    res.status(500).json({ message: "Server error" });
  }
};

const resolveAttendanceComplaint = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { id } = req.params;
    const { reply } = req.body || {};

    const complaint = await Complaint.findById(id)
      .populate("student", "username name")
      .populate("course", "createdBy code title");

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    const complaintTeacherMatch =
      complaint.teacher && complaint.teacher.toString() === teacherId;

    const courseOwnerMatch =
      complaint.course &&
      complaint.course.createdBy &&
      complaint.course.createdBy.toString() === teacherId;

    if (!complaintTeacherMatch && !courseOwnerMatch) {
      return res.status(403).json({ message: "Not allowed to update this complaint" });
    }

    if (complaint.category !== "attendance") {
      return res.status(400).json({ message: "This complaint is not an attendance complaint" });
    }

    if (!complaint.attendanceRef?.date || !complaint.attendanceRef?.period) {
      return res.status(400).json({ message: "Attendance date/period missing in complaint" });
    }

    const roll = String(complaint.student?.username || "").trim();
    if (!roll) {
      return res.status(400).json({ message: "Student roll not found" });
    }

    const attendanceDoc = await Attendance.findOne({
      teacher: teacherId,
      course: complaint.course._id,
      date: dateOnly(complaint.attendanceRef.date),
      period: Number(complaint.attendanceRef.period),
    });

    if (!attendanceDoc) {
      return res.status(404).json({
        message: "Attendance record not found for that course, date and period",
      });
    }

    const existingIndex = attendanceDoc.records.findIndex(
      (r) => String(r.roll) === roll
    );

    if (existingIndex >= 0) {
      attendanceDoc.records[existingIndex].present = true;
    } else {
      attendanceDoc.records.push({
        roll,
        present: true,
      });
    }

    await attendanceDoc.save();

    complaint.reply =
      reply?.trim() ||
      `Attendance updated for ${complaint.attendanceRef.date} (P${complaint.attendanceRef.period}).`;
    complaint.status = "resolved";

    await complaint.save();

    const populated = await Complaint.findById(complaint._id)
      .populate("student", "name username")
      .populate("course", "code title section year semester")
      .populate("assessment", "name");

    res.json({
      message: "Attendance updated and complaint resolved successfully",
      complaint: populated,
    });
  } catch (err) {
    console.error("resolveAttendanceComplaint error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  createStudentComplaint,
  getStudentComplaints,
  getTeacherComplaints,
  replyToComplaint,
  resolveAttendanceComplaint,
};
