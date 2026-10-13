const Attendance = require("../models/Attendance");

// Keep the issue-center totals consistent with /attendance/student-sheet:
// each period-based record counts once; legacy multi-class documents count
// once per numClasses. Always read the actual session records, not the
// separately saved AttendanceSummary (which can be out of date).
async function withAttendanceStats(complaints) {
  const plain = complaints.map((complaint) =>
    typeof complaint.toObject === "function" ? complaint.toObject() : complaint
  );

  const attendanceIssues = plain.filter(
    (complaint) => complaint.category === "attendance" && complaint.course
  );
  if (!attendanceIssues.length) return plain;

  const courseIds = [
    ...new Set(attendanceIssues.map((issue) => String(issue.course._id || issue.course))),
  ];
  const docs = await Attendance.find({ course: { $in: courseIds } })
    .select("course period numClasses records")
    .lean();

  const byCourse = new Map(
    courseIds.map((id) => [id, { totalClasses: 0, presentByRoll: new Map() }])
  );

  docs.forEach((doc) => {
    const course = byCourse.get(String(doc.course));
    if (!course) return;

    const period = Number(doc.period);
    const periods = Number.isInteger(period) && period >= 1
      ? 1
      : Math.max(1, Math.trunc(Number(doc.numClasses) || 1));
    course.totalClasses += periods;

    // Match the student attendance sheet's first-record lookup for each roll.
    // A duplicate entry in one session must not count twice.
    const seenRolls = new Set();
    (doc.records || []).forEach((record) => {
      if (record?.roll == null) return;
      const roll = String(record.roll).trim();
      if (seenRolls.has(roll)) return;
      seenRolls.add(roll);
      if (record.present) {
        course.presentByRoll.set(
          roll,
          (course.presentByRoll.get(roll) || 0) + periods
        );
      }
    });
  });

  return plain.map((issue) => {
    if (issue.category !== "attendance" || !issue.course) return issue;

    const course = byCourse.get(String(issue.course._id || issue.course));
    const roll = String(issue.student?.username || issue.student?.roll || "").trim();
    const totalClasses = course?.totalClasses || 0;
    const totalPresent = roll ? (course?.presentByRoll.get(roll) || 0) : 0;

    return {
      ...issue,
      attendanceStats: {
        totalPresent,
        totalClasses,
        percentage: totalClasses > 0
          ? Number(((totalPresent / totalClasses) * 100).toFixed(2))
          : null,
      },
    };
  });
}

module.exports = { withAttendanceStats };
