const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");
const Attendance = require("../models/Attendance");
const { withAttendanceStats } = require("../utils/issueAttendanceStats");
const { categoryAccess, requiredAttendanceSessions, formatIssueSettings } = require("../utils/issueSettings");
const { uploadIssueAttachments, cleanupAttachments, attachSignedIssueFiles } = require("../utils/issueAttachments");

const ALLOWED_STATUS = ["open", "in_review", "resolved", "rejected"];
const dateOnly = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const sessionKey = (ref) => `${ref.date}:${Number(ref.period)}`;
const issueKey = (student, course, ref) => `${student}:${course}:${ref.date}:${Number(ref.period)}`;
const hasValidDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const errorWithStatus = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const getRefs = (issue) => {
  if (issue.attendanceRefs?.length) return issue.attendanceRefs;
  return issue.attendanceRef?.date ? [issue.attendanceRef] : [];
};

function parseRefs(body) {
  let raw = body.attendanceRefs;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw errorWithStatus("Invalid attendance dates format"); }
  }
  if (!Array.isArray(raw)) {
    let ref = body.attendanceRef;
    if (typeof ref === "string") {
      try { ref = JSON.parse(ref); } catch { throw errorWithStatus("Invalid attendance date format"); }
    }
    raw = ref ? [ref] : [];
  }
  if (!raw.length) throw errorWithStatus("Select at least one attendance session");
  if (raw.length > 200) throw errorWithStatus("Too many selected sessions");
  const refs = raw.map((row) => ({ date: row?.date, period: Number(row?.period) }));
  for (const ref of refs) {
    if (!hasValidDate(ref.date) || !Number.isInteger(ref.period) || ref.period < 1 || ref.period > 20) {
      throw errorWithStatus("Each session must have a valid date and period (1–20)");
    }
  }
  if (new Set(refs.map(sessionKey)).size !== refs.length) {
    throw errorWithStatus("Remove duplicate selected attendance sessions");
  }
  return refs;
}

async function attendanceContext(courseId, roll) {
  // Same expansion/counting rule as /attendance/student-sheet, including legacy documents.
  const docs = await Attendance.find({ course: courseId }).select("date period numClasses records").lean();
  const all = new Map();
  let total = 0;
  let present = 0;
  for (const doc of docs) {
    const date = doc.date.toISOString().slice(0, 10);
    const single = Number.isInteger(doc.period) && doc.period >= 1;
    const count = single ? 1 : Math.max(1, Math.trunc(Number(doc.numClasses) || 1));
    const status = !!(doc.records || []).find((r) => String(r.roll) === String(roll))?.present;
    for (let p = 1; p <= count; p += 1) {
      const ref = { date, period: single ? doc.period : p };
      all.set(sessionKey(ref), { status, legacy: !single && count > 1 });
      total += 1;
      if (status) present += 1;
    }
  }
  return { all, total, present };
}

async function findDuplicatedRefs(studentId, courseId, refs) {
  const records = await Complaint.find({
    student: studentId, course: courseId, category: "attendance",
    $or: [
      { "attendanceRefs.date": { $in: refs.map((x) => x.date) } },
      { "attendanceRef.date": { $in: refs.map((x) => x.date) } },
    ],
  }).select("attendanceRef attendanceRefs status").lean();
  const taken = new Set(records.flatMap((item) => getRefs(item).map(sessionKey)));
  return refs.filter((ref) => taken.has(sessionKey(ref)));
}

async function signSingle(doc) {
  return (await attachSignedIssueFiles([doc]))[0];
}

async function createStudentComplaint(req, res) {
  let uploaded = [];
  try {
    const studentId = req.user?.userId;
    if (!studentId) throw errorWithStatus("Unauthorized", 401);
    const { courseId, assessmentId, category = "marks" } = req.body;
    const message = String(req.body.message || "").trim();
    if (!mongoose.isValidObjectId(courseId) || !message) {
      throw errorWithStatus("Course and written application are required");
    }
    if (!["marks", "attendance", "general"].includes(category)) {
      throw errorWithStatus("Invalid issue category");
    }

    const course = await Course.findById(courseId).select("createdBy archived complaintSettings");
    if (!course || course.archived) throw errorWithStatus("Course not found", 404);
    const access = categoryAccess(course.complaintSettings, category);
    if (!access.allowed) throw errorWithStatus(access.message, 403);
    if (!await Enrollment.exists({ course: courseId, student: studentId })) {
      throw errorWithStatus("You are not enrolled in this course", 403);
    }
    if (assessmentId) {
      if (!mongoose.isValidObjectId(assessmentId) ||
          !await Assessment.exists({ _id: assessmentId, course: courseId })) {
        throw errorWithStatus("Invalid assessment for this course");
      }
    }
    if (category === "marks" && !assessmentId) {
      throw errorWithStatus("Select an assessment for a marks issue");
    }
    if (category !== "marks" && assessmentId) {
      throw errorWithStatus("Assessments are only supported for marks issues");
    }
    if (category === "marks" && (req.files || []).length) {
      throw errorWithStatus("Attachments are supported for general and attendance issues");
    }

    let refs = [];
    if (category === "attendance") {
      refs = parseRefs(req.body);
      const user = await require("../models/User").findById(studentId).select("username").lean();
      const roll = String(user?.username || "").trim();
      if (!roll) throw errorWithStatus("Student roll not found");
      const context = await attendanceContext(courseId, roll);
      if (!context.total) throw errorWithStatus("No recorded attendance sessions for this course");
      const target = formatIssueSettings(course.complaintSettings).attendanceTargetPercentage;
      const needed = requiredAttendanceSessions(context.present, context.total, target);
      if (needed === 0) {
        throw errorWithStatus(`You already meet the ${target}% attendance requirement`, 403);
      }
      const pendingIssues = await Complaint.find({ student: studentId, course: courseId,
        category: "attendance", status: { $in: ["open", "in_review"] } })
        .select("attendanceRef attendanceRefs").lean();
      const pendingAbsent = new Set(pendingIssues.flatMap(getRefs).filter((ref) =>
        context.all.has(sessionKey(ref)) && !context.all.get(sessionKey(ref)).status).map(sessionKey));
      const remaining = Math.max(0, needed - pendingAbsent.size);
      if (!remaining) {
        throw errorWithStatus("Your pending attendance applications already cover the remaining requirement", 409);
      }
      if (refs.length > remaining) {
        throw errorWithStatus(`You may select at most ${remaining} more session${remaining === 1 ? "" : "s"} to reach ${target}% attendance`);
      }
      for (const ref of refs) {
        const session = context.all.get(sessionKey(ref));
        if (!session) throw errorWithStatus(`${ref.date} (P${ref.period}) is not a recorded class`);
        if (session.status) throw errorWithStatus(`${ref.date} (P${ref.period}) is already marked present`);
        if (session.legacy) {
          // Legacy documents represent all periods by a single status; never silently
          // change multiple classes when a student selected only one period.
          const sameDate = [...context.all.entries()].filter(([key, row]) =>
            key.startsWith(`${ref.date}:`) && row.legacy).map(([key]) => key);
          if (sameDate.some((key) => !refs.some((r) => sessionKey(r) === key))) {
            throw errorWithStatus(`All periods on ${ref.date} share one legacy record; please select all periods on that date`);
          }
        }
      }
      const duplicates = await findDuplicatedRefs(studentId, courseId, refs);
      if (duplicates.length) {
        throw errorWithStatus(`Already reported: ${duplicates.map((r) => `${r.date} (P${r.period})`).join(", ")}`, 409, "DUPLICATE_ATTENDANCE_COMPLAINT");
      }
    }

    const teacherEnrollment = await Enrollment.findOne({ course: courseId, teacher: { $ne: null } })
      .select("teacher").lean();
    const teacher = course.createdBy || teacherEnrollment?.teacher;
    if (!teacher) throw errorWithStatus("No teacher assigned to this course");
    uploaded = await uploadIssueAttachments(req.files || [], studentId, courseId);

    const payload = {
      student: studentId, teacher, course: courseId,
      assessment: category === "marks" ? assessmentId : null,
      category, message, status: "open", attachments: uploaded,
    };
    if (category === "attendance") {
      payload.attendanceRefs = refs;
      payload.attendanceRef = refs.length === 1 ? refs[0] : null;
      payload.attendanceDedupKeys = refs.map((ref) => issueKey(studentId, courseId, ref));
      // Single-date reports also participate in the historical unique index.
      if (refs.length === 1) payload.attendanceDedupKey = payload.attendanceDedupKeys[0];
    }
    const created = await Complaint.create(payload);
    uploaded = [];
    const populated = await Complaint.findById(created._id)
      .select("+attachments.storagePath")
      .populate("course", "code title section intake year semester")
      .populate("assessment", "name")
      .populate("student", "name roll username");
    res.status(201).json(await signSingle(populated));
  } catch (err) {
    if (uploaded.length) await cleanupAttachments(uploaded);
    console.error("createStudentComplaint error:", err);
    if (err.code === 11000) {
      return res.status(409).json({ code: "DUPLICATE_ATTENDANCE_COMPLAINT", message: "One or more selected attendance sessions have already been reported" });
    }
    return res.status(err.status || 500).json({ code: err.code, message: err.status ? err.message : "Unable to submit issue. Please try again." });
  }
}

async function getStudentComplaints(req, res) {
  try {
    const student = req.user?.userId;
    if (!student) return res.status(401).json({ message: "Unauthorized" });
    const results = await Complaint.find({ student })
      .select("+attachments.storagePath")
      .populate("course", "code title section intake year semester")
      .populate("assessment", "name").sort({ createdAt: -1 });
    res.json(await attachSignedIssueFiles(results));
  } catch (err) {
    console.error("getStudentComplaints error", err);
    res.status(500).json({ message: "Could not load issues" });
  }
}

async function getTeacherComplaints(req, res) {
  try {
    const teacher = req.user.userId;
    const owned = await Course.find({ createdBy: teacher, archived: { $ne: true } }).select("_id");
    const results = await Complaint.find({
      $or: [{ teacher }, { course: { $in: owned.map((c) => c._id) } }],
    }).select("+attachments.storagePath")
      .populate({
        path: "course", select: "code title section intake year semester archived createdBy",
        match: { archived: { $ne: true } },
      })
      .populate("student", "username name roll")
      .populate("assessment", "name").sort({ createdAt: -1 });
    const visible = results.filter((c) => c.course);
    res.json(await attachSignedIssueFiles(await withAttendanceStats(visible)));
  } catch (err) {
    console.error("getTeacherComplaints error", err);
    res.status(500).json({ message: "Could not load issues" });
  }
}

function isTeacherAuthorized(issue, teacher) {
  return String(issue.teacher || "") === String(teacher) ||
    String(issue.course?.createdBy || "") === String(teacher);
}

async function populatedIssue(id) {
  const doc = await Complaint.findById(id).select("+attachments.storagePath")
    .populate("student", "name roll username")
    .populate("course", "code title section intake year semester createdBy")
    .populate("assessment", "name");
  return (await attachSignedIssueFiles(await withAttendanceStats([doc])))[0];
}

async function replyToComplaint(req, res) {
  try {
    const issue = await Complaint.findById(req.params.id).populate("course", "createdBy");
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    if (!isTeacherAuthorized(issue, req.user.userId)) return res.status(403).json({ message: "Not allowed to update this issue" });
    const { reply, status } = req.body;
    if (reply !== undefined) issue.reply = String(reply).trim();
    if (status !== undefined) {
      if (!ALLOWED_STATUS.includes(status)) return res.status(400).json({ message: "Invalid status" });
      // Attendance resolution needs the attendance records updated as well.
      if (issue.category === "attendance" && status === "resolved") {
        return res.status(400).json({ message: "Use Resolve & Update Attendance for attendance issues" });
      }
      issue.status = status;
    }
    await issue.save();
    res.json(await populatedIssue(issue._id));
  } catch (err) {
    console.error("replyToComplaint error", err);
    res.status(500).json({ message: "Could not update issue" });
  }
}

async function resolveAttendanceComplaint(req, res) {
  try {
    const teacher = req.user.userId;
    const selected = await Complaint.findById(req.params.id)
      .populate("student", "username name")
      .populate("course", "createdBy code title");
    if (!selected) throw errorWithStatus("Issue not found", 404);
    if (!isTeacherAuthorized(selected, teacher)) throw errorWithStatus("Not allowed to update this issue", 403);
    if (selected.category !== "attendance") throw errorWithStatus("This is not an attendance issue");
    if (!["open", "in_review"].includes(selected.status)) {
      throw errorWithStatus("Only pending attendance issues can be approved", 409);
    }
    const roll = String(selected.student?.username || "").trim();
    if (!roll) throw errorWithStatus("Student roll not found");
    const includeOthers = req.body?.includePendingForStudent === true;
    const pending = includeOthers
      ? await Complaint.find({ student: selected.student._id, course: selected.course._id,
        category: "attendance", status: { $in: ["open", "in_review"] } })
      : [selected];
    const distinctRefs = [...new Map(pending.flatMap(getRefs).map((ref) => [sessionKey(ref), ref])).values()];
    if (!distinctRefs.length) throw errorWithStatus("No dates selected for the attendance issue");

    // Validate every record before writing anything. Retry after a transient error
    // is safe: already-present records are simply kept present.
    const docs = await Attendance.find({ course: selected.course._id,
      date: { $in: [...new Set(distinctRefs.map((ref) => ref.date))].map(dateOnly) } });
    const matched = new Map();
    for (const ref of distinctRefs) {
      const doc = docs.find((item) =>
        item.date.toISOString().slice(0, 10) === ref.date &&
        (Number(item.period) === ref.period ||
          (item.period == null && ref.period <= Number(item.numClasses || 1))));
      if (!doc) throw errorWithStatus(`Attendance record not found: ${ref.date} (P${ref.period})`, 409);
      matched.set(sessionKey(ref), doc);
    }
    // For legacy multi-period documents all periods have a shared status.
    for (const ref of distinctRefs) {
      const doc = matched.get(sessionKey(ref));
      if (doc.period == null && Number(doc.numClasses || 1) > 1) {
        const allPeriods = Array.from({ length: Number(doc.numClasses) }, (_, i) => i + 1);
        if (allPeriods.some((p) => !matched.has(`${ref.date}:${p}`))) {
          throw errorWithStatus(`Cannot partially update the legacy multi-period attendance record on ${ref.date}. Include all its periods.`, 409);
        }
      }
    }

    const uniqueDocs = [...new Map([...matched.values()].map((doc) => [String(doc._id), doc])).values()];
    for (const doc of uniqueDocs) {
      // Explicit read-modify-write preserves legacy attendance record structure.
      const index = doc.records.findIndex((entry) => String(entry.roll) === roll);
      if (index < 0) doc.records.push({ roll, present: true });
      else doc.records[index].present = true;
      await doc.save();
    }
    const reply = String(req.body?.reply || "").trim();
    const message = reply || `Attendance updated for ${distinctRefs.length} selected class${distinctRefs.length === 1 ? "" : "es"}.`;
    const ids = pending.map((issue) => issue._id);
    await Complaint.updateMany({ _id: { $in: ids }, status: { $in: ["open", "in_review"] } },
      { $set: { status: "resolved", reply: message } });
    const populated = await Complaint.find({ _id: { $in: ids } })
      .select("+attachments.storagePath")
      .populate("student", "username name roll")
      .populate("course", "code title section intake year semester createdBy")
      .populate("assessment", "name");
    const safe = await attachSignedIssueFiles(await withAttendanceStats(populated));
    res.json({ message: "Attendance updated and issues resolved", resolvedCount: safe.length,
      updatedSessions: distinctRefs.length, complaints: safe,
      complaint: safe.find((x) => String(x._id) === String(selected._id)) });
  } catch (err) {
    console.error("resolveAttendanceComplaint error:", err);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Unable to update attendance" });
  }
}

module.exports = {
  createStudentComplaint, getStudentComplaints, getTeacherComplaints,
  replyToComplaint, resolveAttendanceComplaint,
};
