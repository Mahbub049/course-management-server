// server/src/controllers/complaintController.js

const Complaint = require("../models/Complaint");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");

// helper: basic YYYY-MM-DD check
function isValidYMD(s) {
  if (!s || typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
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

    const teacherCourses = await Course.find({ createdBy: teacherId }).select("_id");
    const teacherCourseIds = teacherCourses.map((c) => c._id);

    // ✅ FIX: include complaints explicitly assigned to this teacher too
    const complaints = await Complaint.find({
      $or: [
        { teacher: teacherId },
        { course: { $in: teacherCourseIds } },
      ],
    })
      .populate("student", "username name roll")
      .populate("course", "code title section year semester")
      .populate("assessment", "name")
      .sort({ createdAt: -1 });

    res.json(complaints);
  } catch (err) {
    console.error("getTeacherComplaints error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------- Teacher: reply ----------
const ALLOWED_STATUS = ["open", "in_review", "resolved"];

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

module.exports = {
  createStudentComplaint,
  getStudentComplaints,
  getTeacherComplaints,
  replyToComplaint,
};
