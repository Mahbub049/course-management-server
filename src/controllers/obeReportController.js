const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const CourseObeConfig = require("../models/CourseObeConfig");
const ObeAssessmentBlueprint = require("../models/ObeAssessmentBlueprint");
const ObeStudentMark = require("../models/ObeStudentMark");
const { buildOutputData } = require("../utils/obeCalculation");

const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TextRun,
  HeadingLevel,
} = require("docx");

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const safeText = (value, fallback = "") => {
  return String(value ?? fallback);
};

const makeCell = (text, width = 20, bold = false) =>
  new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: safeText(text), bold })],
      }),
    ],
  });

const makeRow = (values, widths = [], header = false) =>
  new TableRow({
    children: values.map((value, index) =>
      makeCell(value, widths[index] || Math.floor(100 / values.length), header)
    ),
  });

const getObeExportPayload = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const [setup, blueprints, enrollments, marks, output] = await Promise.all([
      CourseObeConfig.findOne({ course: courseId }).lean(),
      ObeAssessmentBlueprint.find({ course: courseId }).sort({ order: 1, createdAt: 1 }).lean(),
      Enrollment.find({ course: courseId }).populate("student", "name username email").lean(),
      ObeStudentMark.find({ course: courseId }).lean(),
      buildOutputData(courseId),
    ]);

    const students = enrollments.map((row) => ({
      studentId: String(row.student?._id || ""),
      roll: row.student?.username || "",
      name: row.student?.name || "",
      email: row.student?.email || "",
    }));

    return res.json({
      course,
      setup: setup || null,
      blueprints,
      students,
      marks,
      output,
    });
  } catch (error) {
    console.error("getObeExportPayload error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const downloadCourseReviewReport = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const [setup, output, enrollments] = await Promise.all([
      CourseObeConfig.findOne({ course: courseId }).lean(),
      buildOutputData(courseId),
      Enrollment.find({ course: courseId }).lean(),
    ]);

    if (!setup) {
      return res.status(400).json({ message: "OBE setup not found for this course." });
    }

    const noOfStudents = enrollments.length;
    const threshold = setup?.thresholdPercent ?? 40;

    const courseInfoTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeRow(["Field", "Value"], [30, 70], true),
        makeRow(["Course Code", course.code], [30, 70]),
        makeRow(["Course Title", course.title], [30, 70]),
        makeRow(["Section", course.section || "-"], [30, 70]),
        makeRow(["Semester", `${course.semester || "-"} ${course.year || ""}`.trim()], [30, 70]),
        makeRow(["No of students", noOfStudents], [30, 70]),
        makeRow(["CO attainment threshold", `${threshold}%`], [30, 70]),
      ],
    });

    const coRows = [
      makeRow(["CO", "Statement", "Attainment %", "Level"], [15, 55, 15, 15], true),
      ...((output?.coSummary || []).map((row) =>
        makeRow(
          [
            row.code,
            row.statement || "",
            Number(row.attainmentPercent || 0).toFixed(2),
            row.attainmentLevel ?? "",
          ],
          [15, 55, 15, 15]
        )
      )),
    ];

    const poRows = [
      makeRow(["PO/PSO", "Statement", "Attainment %", "Level"], [15, 55, 15, 15], true),
      ...((output?.poSummary || []).map((row) =>
        makeRow(
          [
            row.code,
            row.statement || "",
            Number(row.attainmentPercent || 0).toFixed(2),
            row.attainmentLevel ?? "",
          ],
          [15, 55, 15, 15]
        )
      )),
    ];

    const gradeRows = [
      makeRow(["Grade", "Count"], [60, 40], true),
      ...Object.entries(output?.gradeDistribution || {}).map(([grade, count]) =>
        makeRow([grade, count], [60, 40])
      ),
    ];

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "COURSE REVIEW REPORT",
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              text: `${course.code} — ${course.title}`,
            }),
            new Paragraph({ text: "" }),

            new Paragraph({
              text: "Course and Instructor Information",
              heading: HeadingLevel.HEADING_1,
            }),
            courseInfoTable,

            new Paragraph({ text: "" }),
            new Paragraph({
              text: "CO Attainment",
              heading: HeadingLevel.HEADING_1,
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: coRows,
            }),

            new Paragraph({ text: "" }),
            new Paragraph({
              text: "PO / PSO Attainment",
              heading: HeadingLevel.HEADING_1,
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: poRows,
            }),

            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Grade Distribution",
              heading: HeadingLevel.HEADING_1,
            }),
            new Table({
              width: { size: 50, type: WidthType.PERCENTAGE },
              rows: gradeRows,
            }),

            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Remarks for CQI",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              text:
                output?.coSummary?.some((row) => Number(row.attainmentPercent || 0) < threshold)
                  ? "Some COs are below the attainment threshold. More practice-oriented assessment, problem solving, and targeted support are recommended."
                  : "Overall CO attainment is satisfactory. Continue with balanced assessment and reinforce analytical and practical problem-solving tasks.",
            }),

            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Action Plan",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              text:
                "Increase question-wise CO alignment, include more analytical assignments, and review weaker CO areas in the next semester.",
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `CRR_${course.code}_${course.semester || "Semester"}_${course.year || "Year"}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("downloadCourseReviewReport error", error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getObeExportPayload,
  downloadCourseReviewReport,
};