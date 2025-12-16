// server/src/controllers/complaintController.js

const Complaint = require('../models/Complaint');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Assessment = require('../models/Assessment');

// ---------- Student: create complaint ----------
const createStudentComplaint = async (req, res) => {
  try {
    // ✅ SAFETY CHECK (prevents 500 error)
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const studentId = req.user.userId;
    const { courseId, assessmentId, message } = req.body;

    if (!courseId || !message || !message.trim()) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // ✅ Validate assessment belongs to course (if provided)
    if (assessmentId) {
      const assessment = await Assessment.findById(assessmentId);
      if (!assessment || assessment.course.toString() !== courseId) {
        return res.status(400).json({ message: 'Invalid assessment' });
      }
    }

    // ✅ Find teacher for this course (Enrollment -> fallback Course.createdBy)
    let teacherId = null;

    // 1) Try Enrollment.teacher (if your Enrollment stores teacher)
    const teacherEnrollment = await Enrollment.findOne({
      course: courseId,
      teacher: { $ne: null },
    }).populate('teacher');

    if (teacherEnrollment?.teacher?._id) {
      teacherId = teacherEnrollment.teacher._id;
    }

    // 2) Fallback: use Course.createdBy (your app uses this for teacher courses)
    if (!teacherId) {
      const courseDoc = await Course.findById(courseId).select('createdBy');
      if (courseDoc?.createdBy) teacherId = courseDoc.createdBy;
    }

    if (!teacherId) {
      return res.status(400).json({ message: 'No teacher assigned to this course' });
    }



    const complaint = new Complaint({
      student: studentId,
      teacher: teacherId,
      course: courseId,
      assessment: assessmentId || null,
      message,
      status: 'open',
    });


    await complaint.save();

    res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint,
    });
  } catch (err) {
    console.error('createStudentComplaint error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ---------- Student: get own complaints ----------
const getStudentComplaints = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const complaints = await Complaint.find({
      student: req.user.userId,
    })
      .populate('course', 'code title')
      .populate('assessment', 'name')
      .sort({ createdAt: -1 });

    res.json(complaints);
  } catch (err) {
    console.error('getStudentComplaints error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ---------- Teacher: get complaints ----------
const getTeacherComplaints = async (req, res) => {
  try {
    const teacherId = req.user.userId;

    const teacherCourses = await Course.find({
      createdBy: teacherId,
    }).select('_id');

    const complaints = await Complaint.find({
      course: { $in: teacherCourses.map(c => c._id) },
    })
      .populate('student', 'username name')
      .populate('course', 'code title')
      .populate('assessment', 'name')
      .sort({ createdAt: -1 });

    res.json(complaints);
  } catch (err) {
    console.error('getTeacherComplaints error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ---------- Teacher: reply ----------
const ALLOWED_STATUS = ['open', 'in_review', 'resolved'];

const replyToComplaint = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { id } = req.params;
    const { reply, status } = req.body;

    // 1) Load complaint + course (so we can check ownership)
    const complaint = await Complaint.findById(id).populate('course', 'createdBy code title');

    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    // 2) Authorization: either complaint.teacher matches OR teacher owns the course
    const complaintTeacherMatch =
      complaint.teacher && complaint.teacher.toString() === teacherId;

    const courseOwnerMatch =
      complaint.course &&
      complaint.course.createdBy &&
      complaint.course.createdBy.toString() === teacherId;

    if (!complaintTeacherMatch && !courseOwnerMatch) {
      return res.status(403).json({ message: 'Not allowed to update this complaint' });
    }

    // 3) Apply updates
    if (reply !== undefined) complaint.reply = reply;

    if (status !== undefined) {
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      complaint.status = status;
    }

    await complaint.save();

    // 4) Return populated doc for frontend UI
    const populated = await Complaint.findById(complaint._id)
      .populate('student', 'name roll username')
      .populate('course', 'code title')
      .populate('assessment', 'name');

    res.json(populated);
  } catch (err) {
    console.error('replyToComplaint error', err);
    res.status(500).json({ message: 'Server error' });
  }
};


module.exports = {
  createStudentComplaint,
  getStudentComplaints,
  getTeacherComplaints,
  replyToComplaint,
};
