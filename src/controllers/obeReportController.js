const fs = require("fs");
const path = require("path");

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const CourseObeConfig = require("../models/CourseObeConfig");
const ObeAssessmentBlueprint = require("../models/ObeAssessmentBlueprint");
const ObeStudentMark = require("../models/ObeStudentMark");
const { buildOutputData } = require("../utils/obeCalculation");

const {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require("docx");

const FONT = "Times New Roman";
const BLACK = "000000";
const WHITE = "FFFFFF";
const HEADER_FILL = "D9EAF7";
const LIGHT_FILL = "F2F2F2";
const PAGE_WIDTH_DXA = 10400;

const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: BLACK,
};

const ALL_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: WHITE },
  bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
  left: { style: BorderStyle.NONE, size: 0, color: WHITE },
  right: { style: BorderStyle.NONE, size: 0, color: WHITE },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: WHITE },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: WHITE },
};

const safeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const cleanFileName = (value) =>
  safeText(value, "Course")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const formatNumber = (value) => {
  const n = round2(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const getLevel = (percent) => {
  const p = Number(percent) || 0;
  if (p >= 70) return 4;
  if (p >= 60) return 3;
  if (p >= 50) return 2;
  if (p >= 40) return 1;
  return 0;
};

const getRemark = (percent, type = "CO") => {
  const p = Number(percent) || 0;

  if (p >= 70) return "Excellent";
  if (p >= 60) return "Good, but more practice can improve attainment";
  if (p >= 50) return "Satisfactory, further practice is recommended";
  if (p >= 40) return "Marginally attained; targeted improvement is required";

  return `${type} attainment is below expected level; remedial action is required`;
};

const getOverallResponse = (averagePercent) => {
  const p = Number(averagePercent) || 0;

  if (p >= 70) return "Completely";
  if (p >= 60) return "Mostly";
  if (p >= 40) return "Partially";

  return "None";
};

const optionLine = (options = [], selected = "") =>
  options.map((option) => `${option === selected ? "☑" : "☐"} ${option}`).join("     ");

const average = (rows = [], key = "attainmentPercent") => {
  const values = rows
    .map((row) => Number(row?.[key] || 0))
    .filter((n) => Number.isFinite(n));

  if (!values.length) return 0;

  return round2(values.reduce((sum, n) => sum + n, 0) / values.length);
};

const textRun = (text = "", options = {}) =>
  new TextRun({
    text: safeText(text),
    font: FONT,
    size: options.size || 20,
    bold: !!options.bold,
    italics: !!options.italics,
    color: options.color || BLACK,
  });

const para = (text = "", options = {}) => {
  const lines = safeText(text).split("\n");
  const children = [];

  lines.forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));

    children.push(
      textRun(line, {
        size: options.size,
        bold: options.bold,
        italics: options.italics,
        color: options.color,
      })
    );
  });

  return new Paragraph({
    children,
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 0,
      line: options.line ?? 220,
    },
  });
};

const emptyPara = (height = 120) =>
  new Paragraph({
    children: [textRun("")],
    spacing: { before: height, after: height },
  });

const cell = (content = "", options = {}) => {
  let children;

  if (Array.isArray(content)) {
    children = content.length ? content : [para("")];
  } else if (content instanceof Paragraph || content instanceof Table) {
    children = [content];
  } else {
    children = [
      para(content, {
        bold: options.bold,
        italics: options.italics,
        size: options.size || 20,
        alignment: options.alignment || AlignmentType.LEFT,
      }),
    ];
  }

  return new TableCell({
    children,
    width: options.width
      ? { size: options.width, type: WidthType.DXA }
      : undefined,
    columnSpan: options.columnSpan,
    rowSpan: options.rowSpan,
    verticalAlign: options.verticalAlign || VerticalAlign.CENTER,
    shading: options.fill
      ? {
          type: ShadingType.CLEAR,
          fill: options.fill,
          color: "auto",
        }
      : undefined,
    borders: options.borders || ALL_BORDERS,
    margins: options.margins || {
      top: 80,
      bottom: 80,
      left: 90,
      right: 90,
    },
  });
};

const row = (cells = [], options = {}) =>
  new TableRow({
    children: cells,
    cantSplit: true,
    tableHeader: !!options.tableHeader,
    height: options.height
      ? { value: options.height, rule: HeightRule.ATLEAST }
      : undefined,
  });

const table = (rows = [], options = {}) =>
  new Table({
    rows,
    width: { size: options.width || PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: options.columnWidths,
    layout: TableLayoutType.FIXED,
    borders: options.borders || ALL_BORDERS,
    alignment: options.alignment || AlignmentType.CENTER,
  });

const getLogoBuffer = () => {
  const possiblePaths = [
    path.join(__dirname, "../assets/logo.png"),
    path.join(process.cwd(), "src/assets/logo.png"),
    path.join(process.cwd(), "public/logo.png"),
    path.join(process.cwd(), "../client/public/logo.png"),
  ];

  for (const logoPath of possiblePaths) {
    if (fs.existsSync(logoPath)) return fs.readFileSync(logoPath);
  }

  return null;
};

const buildHeader = () => {
  const logoBuffer = getLogoBuffer();

  const logoCellChildren = logoBuffer
    ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: logoBuffer,
              type: "png",
              transformation: { width: 62, height: 62 },
            }),
          ],
          spacing: { before: 0, after: 0 },
        }),
      ]
    : [para("")];

  return [
    table(
      [
        row([
          cell(logoCellChildren, { width: 1600, borders: NO_BORDERS }),
          cell(
            [
              para("Department of Computer Science and Engineering", {
                bold: true,
                size: 24,
                alignment: AlignmentType.CENTER,
              }),
              para("Bangladesh University of Business and Technology", {
                bold: true,
                size: 22,
                alignment: AlignmentType.CENTER,
              }),
            ],
            { width: 8800, borders: NO_BORDERS }
          ),
        ]),
      ],
      { borders: NO_BORDERS, columnWidths: [1600, 8800] }
    ),

    table(
      [
        row([
          cell("COURSE REVIEW REPORT", {
            width: 10400,
            bold: true,
            size: 24,
            alignment: AlignmentType.CENTER,
          }),
        ]),
      ],
      { columnWidths: [10400] }
    ),

    emptyPara(40),
  ];
};

const getSemesterLabel = (course = {}) => {
  const semester = safeText(course.semester || "").trim();
  const year = safeText(course.year || "").trim();

  return `${semester} ${year}`.trim() || "-";
};

const aggregateGradeDistribution = (output = {}) => {
  const totalStudents = Number(output?.totalStudents || output?.students?.length || 0);

  const gradeCounts = {
    "A+": 0,
    A: 0,
    "A-": 0,
    "B+": 0,
    B: 0,
    "B-": 0,
    "C+": 0,
    C: 0,
    "C-": 0,
    D: 0,
    F: 0,
    W: 0,
    I: 0,
  };

  if (Array.isArray(output?.students) && output.students.length) {
    output.students.forEach((student) => {
      const grade = safeText(student?.grade || "F").trim().toUpperCase();

      if (gradeCounts[grade] !== undefined) gradeCounts[grade] += 1;
      else gradeCounts.F += 1;
    });
  } else if (Array.isArray(output?.gradeDistribution)) {
    output.gradeDistribution.forEach((item) => {
      const grade = safeText(item?.grade || "").trim().toUpperCase();

      if (gradeCounts[grade] !== undefined) {
        gradeCounts[grade] = Number(item?.count || 0);
      }
    });
  }

  const buckets = [
    { label: "A+, A, A-", grades: ["A+", "A", "A-"] },
    { label: "B+, B, B-", grades: ["B+", "B", "B-"] },
    { label: "C+, C, C-", grades: ["C+", "C", "C-"] },
    { label: "D", grades: ["D"] },
    { label: "F", grades: ["F"] },
    { label: "W", grades: ["W"] },
    { label: "I", grades: ["I"] },
  ].map((bucket) => {
    const count = bucket.grades.reduce(
      (sum, grade) => sum + Number(gradeCounts[grade] || 0),
      0
    );

    return {
      ...bucket,
      count,
      percent: totalStudents ? round2((count / totalStudents) * 100) : 0,
    };
  });

  return { buckets, totalStudents };
};

const gradePointMap = {
  "A+": 4.0,
  A: 3.75,
  "A-": 3.5,
  "B+": 3.25,
  B: 3.0,
  "B-": 2.75,
  "C+": 2.5,
  C: 2.25,
  "C-": 2.0,
  D: 2.0,
  F: 0,
  I: 0,
  W: 0,
};

const nearestGradeFromPoint = (point) => {
  if (!Number.isFinite(point)) return "-";

  const entries = Object.entries(gradePointMap).filter(
    ([grade]) => !["I", "W"].includes(grade)
  );

  let best = entries[0];

  for (const entry of entries) {
    if (Math.abs(entry[1] - point) < Math.abs(best[1] - point)) {
      best = entry;
    }
  }

  return best?.[0] || "-";
};

const getAverageGrade = (output = {}) => {
  const students = Array.isArray(output?.students) ? output.students : [];
  if (!students.length) return "-";

  let count = 0;
  let total = 0;

  for (const student of students) {
    const grade = safeText(student?.grade || "F").trim().toUpperCase();

    if (gradePointMap[grade] === undefined) continue;

    total += gradePointMap[grade];
    count += 1;
  }

  if (!count) return "-";

  const avg = round2(total / count);

  return `${nearestGradeFromPoint(avg)} (${avg.toFixed(2)})`;
};

const buildInfoAndAttainmentTable = ({ course, setup, output, teacherName }) => {
  const { buckets, totalStudents } = aggregateGradeDistribution(output);
  const averageGrade = getAverageGrade(output);

  const coRows = Array.isArray(output?.coAttainment) ? output.coAttainment : [];
  const poRows = Array.isArray(output?.poAttainment) ? output.poAttainment : [];
  const mappings = Array.isArray(setup?.mappings) ? setup.mappings : [];

  const tableRows = [];

  tableRows.push(
    row(
      [
        cell("Course and Instructor’s Information", {
          columnSpan: 24,
          bold: true,
          size: 21,
          alignment: AlignmentType.CENTER,
          fill: HEADER_FILL,
        }),
      ],
      { tableHeader: true }
    )
  );

  tableRows.push(
    row([
      cell("Course Code", { columnSpan: 3, bold: true, fill: LIGHT_FILL }),
      cell(course.code || "-", { columnSpan: 3 }),
      cell("Course Title", { columnSpan: 5, bold: true, fill: LIGHT_FILL }),
      cell(course.title || "-", { columnSpan: 7 }),
      cell("Section", { columnSpan: 3, bold: true, fill: LIGHT_FILL }),
      cell(course.section || "-", {
        columnSpan: 3,
        alignment: AlignmentType.CENTER,
      }),
    ])
  );

  tableRows.push(
    row([
      cell("Semester", { columnSpan: 3, bold: true, fill: LIGHT_FILL }),
      cell(getSemesterLabel(course), { columnSpan: 3 }),
      cell("Instructor", { columnSpan: 5, bold: true, fill: LIGHT_FILL }),
      cell(teacherName || "-", { columnSpan: 7 }),
      cell("No of students", { columnSpan: 3, bold: true, fill: LIGHT_FILL }),
      cell(totalStudents, { columnSpan: 3, alignment: AlignmentType.CENTER }),
    ])
  );

  tableRows.push(
    row([
      cell("*Any changes of COs from previous semester?", {
        columnSpan: 24,
        bold: true,
      }),
    ])
  );

  tableRows.push(
    row([
      cell("☑ NO", { columnSpan: 2, alignment: AlignmentType.CENTER }),
      cell("☐ YES", { columnSpan: 2, alignment: AlignmentType.CENTER }),
      cell("Tick appropriate(s), if yes", {
        columnSpan: 6,
        alignment: AlignmentType.CENTER,
      }),
      ...["CO1", "CO2", "CO3", "CO4", "CO5"].map((co) =>
        cell(co, {
          columnSpan: co === "CO5" ? 4 : 3,
          alignment: AlignmentType.CENTER,
        })
      ),
    ])
  );

  tableRows.push(
    row(
      [
        cell("*Provide explanation if ‘Yes’: ", {
          columnSpan: 24,
          verticalAlign: VerticalAlign.TOP,
        }),
      ],
      { height: 480 }
    )
  );

  tableRows.push(
    row([
      cell("Grade Distribution", {
        columnSpan: 24,
        bold: true,
        alignment: AlignmentType.CENTER,
        fill: HEADER_FILL,
      }),
    ])
  );

  tableRows.push(
    row([
      cell("Letter Grade", { columnSpan: 5, bold: true, fill: LIGHT_FILL }),
      ...buckets.map((bucket) =>
        cell(bucket.label, {
          columnSpan: 2,
          bold: true,
          alignment: AlignmentType.CENTER,
        })
      ),
      cell("Total", {
        columnSpan: 5,
        bold: true,
        alignment: AlignmentType.CENTER,
      }),
    ])
  );

  tableRows.push(
    row([
      cell("Number of Students", {
        columnSpan: 5,
        bold: true,
        fill: LIGHT_FILL,
      }),
      ...buckets.map((bucket) =>
        cell(bucket.count, {
          columnSpan: 2,
          alignment: AlignmentType.CENTER,
        })
      ),
      cell(totalStudents, { columnSpan: 5, alignment: AlignmentType.CENTER }),
    ])
  );

  tableRows.push(
    row([
      cell("Percentage (%)", { columnSpan: 5, bold: true, fill: LIGHT_FILL }),
      ...buckets.map((bucket) =>
        cell(formatNumber(bucket.percent), {
          columnSpan: 2,
          alignment: AlignmentType.CENTER,
        })
      ),
      cell(totalStudents ? "100" : "0", {
        columnSpan: 5,
        alignment: AlignmentType.CENTER,
      }),
    ])
  );

  tableRows.push(
    row([
      cell("Average Grade", { columnSpan: 5, bold: true, fill: LIGHT_FILL }),
      cell(averageGrade, { columnSpan: 19, alignment: AlignmentType.CENTER }),
    ])
  );

  tableRows.push(
    row([
      cell(`CO Attainment ( >= ${setup?.thresholdPercent ?? 40}% )`, {
        columnSpan: 24,
        bold: true,
        alignment: AlignmentType.CENTER,
        fill: HEADER_FILL,
      }),
    ])
  );

  tableRows.push(
    row(
      [
        cell("COs", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("CO Statement", {
          columnSpan: 12,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Attainment [%]", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Attainment [Level]*", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Remarks for CQI", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
      ],
      { tableHeader: true }
    )
  );

  const effectiveCoRows = coRows.length
    ? coRows
    : [{ code: "", statement: "", attainmentPercent: 0, level: "" }];

  effectiveCoRows.forEach((co) => {
    const relatedTargets = mappings
      .filter((mapping) => mapping.coCode === co.code)
      .map((mapping) => mapping.targetCode)
      .filter(Boolean);

    const statement = `${co.statement || ""}${
      relatedTargets.length ? ` [${[...new Set(relatedTargets)].join(", ")}]` : ""
    }`;

    const percent = Number(co.attainmentPercent || 0);

    tableRows.push(
      row([
        cell(co.code || "-", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell(statement || "-", { columnSpan: 12 }),
        cell(formatNumber(percent), {
          columnSpan: 3,
          alignment: AlignmentType.CENTER,
        }),
        cell(co.level ?? getLevel(percent), {
          columnSpan: 3,
          alignment: AlignmentType.CENTER,
        }),
        cell(getRemark(percent, "CO"), { columnSpan: 3 }),
      ])
    );
  });

  tableRows.push(
    row([
      cell(
        "* 70% – 100% = 4,               60% – 69% = 3,              50% – 59% = 2,             40% – 49% = 1,            < 40% = 0",
        {
          columnSpan: 24,
          italics: true,
          size: 18,
        }
      ),
    ])
  );

  tableRows.push(
    row([
      cell(`PO Attainment ( >= ${setup?.thresholdPercent ?? 40}% )`, {
        columnSpan: 24,
        bold: true,
        alignment: AlignmentType.CENTER,
        fill: HEADER_FILL,
      }),
    ])
  );

  tableRows.push(
    row(
      [
        cell("POs", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("PO Statement", {
          columnSpan: 12,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Attainment [%]", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Attainment [Level]*", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
        cell("Remarks for CQI", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: LIGHT_FILL,
        }),
      ],
      { tableHeader: true }
    )
  );

  const effectivePoRows = poRows.length
    ? poRows
    : [{ code: "", statement: "", attainmentPercent: 0, level: "" }];

  effectivePoRows.forEach((po) => {
    const percent = Number(po.attainmentPercent || 0);

    tableRows.push(
      row([
        cell(po.code || "-", {
          columnSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell(po.statement || "-", { columnSpan: 12 }),
        cell(formatNumber(percent), {
          columnSpan: 3,
          alignment: AlignmentType.CENTER,
        }),
        cell(po.level ?? getLevel(percent), {
          columnSpan: 3,
          alignment: AlignmentType.CENTER,
        }),
        cell(getRemark(percent, "PO"), { columnSpan: 3 }),
      ])
    );
  });

  tableRows.push(
    row([
      cell(
        "* 70% – 100% = 4,               60% – 69% = 3,              50% – 59% = 2,             40% – 49% = 1,            < 40% = 0",
        {
          columnSpan: 24,
          italics: true,
          size: 18,
        }
      ),
    ])
  );

  return table(tableRows, {
    columnWidths: Array.from({ length: 24 }, () =>
      Math.floor(PAGE_WIDTH_DXA / 24)
    ),
  });
};

const buildFeedbackTable = ({ setup, output }) => {
  const coAverage = average(output?.coAttainment || []);
  const poAverage = average(output?.poAttainment || []);

  const threshold = Number(setup?.thresholdPercent ?? 40);

  const hasWeakCo = (output?.coAttainment || []).some(
    (row) => Number(row.attainmentPercent || 0) < threshold
  );

  const hasWeakPo = (output?.poAttainment || []).some(
    (row) => Number(row.attainmentPercent || 0) < threshold
  );

  const blueprints = Array.isArray(output?.blueprints) ? output.blueprints : [];

  const hasAssignment = blueprints.some(
    (bp) => bp.assessmentType === "assignment"
  );

  const hasTest = blueprints.some((bp) =>
    ["ct", "mid", "final"].includes(bp.assessmentType)
  );

  const hasProject = blueprints.some((bp) =>
    /project/i.test(bp.assessmentName || "")
  );

  const assessmentTools = [
    `${hasAssignment ? "☑" : "☐"} Assignment`,
    `${hasTest ? "☑" : "☐"} Test`,
    `${hasProject ? "☑" : "☐"} Project`,
    "☐ Specify, if others",
  ].join("     ");

  const cqiRemark =
    hasWeakCo || hasWeakPo
      ? "More analytical problems, guided practice, and targeted revision should be included to improve student attainment and learning quality."
      : "Students have achieved satisfactory attainment. More analytical problems should still be solved to maintain effective student learning quality.";

  return table(
    [
      row(
        [
          cell("Feedback on Curriculum, Teaching-Learning and Assessment", {
            columnSpan: 3,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: HEADER_FILL,
          }),
        ],
        { tableHeader: true }
      ),

      row(
        [
          cell("Items", {
            width: 1800,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: LIGHT_FILL,
          }),
          cell("Queries", {
            width: 4600,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: LIGHT_FILL,
          }),
          cell("Responses", {
            width: 4000,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: LIGHT_FILL,
          }),
        ],
        { tableHeader: true }
      ),

      row([
        cell("Curriculum", {
          rowSpan: 4,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell("Have the students met the expected COs?"),
        cell(
          optionLine(
            ["Completely", "Mostly", "Partially", "None"],
            getOverallResponse(coAverage)
          )
        ),
      ]),

      row([
        cell("Have the students met the expected POs?"),
        cell(
          optionLine(
            ["Completely", "Mostly", "Partially", "None"],
            getOverallResponse(poAverage)
          )
        ),
      ]),

      row([
        cell("Any modification needed for curriculum?"),
        cell(
          optionLine(["NO", "YES"], hasWeakCo || hasWeakPo ? "YES" : "NO") +
            "     Specify, if yes"
        ),
      ]),

      row([
        cell("Remarks on curriculum modification, if any"),
        cell(
          hasWeakCo || hasWeakPo
            ? "Review weaker CO/PO areas and include more outcome-aligned practice tasks."
            : "No major modification is required at this stage."
        ),
      ]),

      row([
        cell("Teaching- Learning", {
          rowSpan: 2,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell(
          "Any changes on Teaching-Learning delivery methods specified in the course outline?"
        ),
        cell(
          optionLine(["NO", "YES"], hasWeakCo ? "YES" : "NO") +
            "     Specify, if yes"
        ),
      ]),

      row([
        cell("Suggested teaching-learning improvement"),
        cell(
          hasWeakCo
            ? "More problem-solving sessions, class activities, and revision practice are recommended."
            : "Existing teaching-learning delivery is satisfactory."
        ),
      ]),

      row([
        cell("Assessment", {
          rowSpan: 3,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell("Any changes on assessment tools specified in the course outline?"),
        cell(
          optionLine(["NO", "YES"], hasWeakCo || hasWeakPo ? "YES" : "NO") +
            "     Specify, if yes"
        ),
      ]),

      row([
        cell("Please state the best assessment tools that reflect students’ achievement."),
        cell(assessmentTools),
      ]),

      row([
        cell("Remarks on curriculum, teaching-learning and assessment for CQI."),
        cell(cqiRemark),
      ]),
    ],
    { columnWidths: [1800, 4600, 4000] }
  );
};

const twoColumnAttributeParagraphs = (leftItems = [], rightItems = []) => {
  const maxLength = Math.max(leftItems.length, rightItems.length);
  const rows = [];

  for (let i = 0; i < maxLength; i += 1) {
    rows.push(
      new TableRow({
        children: [
          cell(leftItems[i] || "", {
            width: 2500,
            borders: NO_BORDERS,
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
          }),
          cell(rightItems[i] || "", {
            width: 2500,
            borders: NO_BORDERS,
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
          }),
        ],
      })
    );
  }

  return table(rows, {
    borders: NO_BORDERS,
    columnWidths: [2500, 2500],
    width: 5000,
  });
};

const buildKnowledgeProfileTable = ({ output, setup }) => {
  const threshold = Number(setup?.thresholdPercent ?? 40);

  const hasWeak = [
    ...(output?.coAttainment || []),
    ...(output?.poAttainment || []),
  ].some((row) => Number(row.attainmentPercent || 0) < threshold);

  return table(
    [
      row(
        [
          cell("Feedback on Knowledge Profile, Engineering Problems and Engineering Activities", {
            columnSpan: 3,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: HEADER_FILL,
          }),
        ],
        { tableHeader: true }
      ),

      row([
        cell("Knowledge Profile, K", {
          width: 2500,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell("What knowledge profile attributes have been addressed?", {
          width: 3000,
        }),
        cell(
          [
            twoColumnAttributeParagraphs(
              [
                "K1 (Natural Sciences)",
                "K2 (Mathematics)",
                "K3 (Engineering Fundamentals)",
                "K4 (Specialist Knowledge)",
              ],
              [
                "K5 (Engineering Design)",
                "K6 (Engineering Practice)",
                "K7 (Comprehension)",
                "K8 (Research Literature)",
              ]
            ),
          ],
          { width: 4900 }
        ),
      ]),

      row([
        cell("Complex Engineering Problems, P", {
          width: 2500,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell("What complex engineering problem attributes have been addressed?", {
          width: 3000,
        }),
        cell(
          [
            twoColumnAttributeParagraphs(
              [
                "P1 (Depth of knowledge)",
                "P2 (Range of conflicting requirements)",
                "P3 (Depth of analysis)",
                "P4 (Familiarity of issues)",
              ],
              [
                "P5 (Extent of applicable codes)",
                "P6 (Extent of stakeholder involvement and conflicting requirements)",
                "P7 (Interdependence)",
              ]
            ),
          ],
          { width: 4900 }
        ),
      ]),

      row([
        cell("Engineering Activities, A", {
          width: 2500,
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        cell("What complex engineering activities have been addressed?", {
          width: 3000,
        }),
        cell(
          [
            twoColumnAttributeParagraphs(
              [
                "A1 (Range of resources)",
                "A2 (Level of interactions)",
                "A3 (Innovation)",
              ],
              [
                "A4 (Consequences to society and the environment)",
                "A5 (Range of resources)",
              ]
            ),
          ],
          { width: 4900 }
        ),
      ]),

      row([
        cell("Remarks on knowledge profile, complex engineering problem and activities for CQI.", {
          columnSpan: 2,
          bold: true,
        }),
        cell(
          hasWeak
            ? "Students addressed relevant knowledge profile attributes; more open-ended and analytical tasks should be included to strengthen complex problem-solving and engineering activity attributes."
            : "Students addressed relevant knowledge profile attributes through the course activities. More open-ended tasks may be included in future offerings for stronger problem-solving practice."
        ),
      ]),
    ],
    { columnWidths: [2500, 3000, 4900] }
  );
};

const buildReflectionTable = ({ output, setup }) => {
  const threshold = Number(setup?.thresholdPercent ?? 40);

  const weakCos = (output?.coAttainment || []).filter(
    (row) => Number(row.attainmentPercent || 0) < threshold
  );

  const weakPos = (output?.poAttainment || []).filter(
    (row) => Number(row.attainmentPercent || 0) < threshold
  );

  const weakLabels = [
    ...weakCos.map((row) => row.code),
    ...weakPos.map((row) => row.code),
  ].filter(Boolean);

  const nextAction = weakLabels.length
    ? `Special attention should be given to ${weakLabels.join(
        ", "
      )}. More class practice, open-ended questions, and outcome-aligned assignments should be provided.`
    : "Open-ended questions, analytical problems, and practical examples may be provided for home assignments to maintain and improve attainment.";

  const improvement = weakLabels.length
    ? "Course-level improvement should focus on weaker outcome areas through additional tutorials, formative assessment, and revision of assessment difficulty."
    : "Group assignment based on real-life scenarios should be included to improve problem-solving skills. Current trends related to this field should also be considered in the curriculum.";

  return table(
    [
      row(
        [
          cell("Reflections", {
            columnSpan: 2,
            bold: true,
            alignment: AlignmentType.CENTER,
            fill: HEADER_FILL,
          }),
        ],
        { tableHeader: true }
      ),

      row([
        cell("Have your last semester recommendation(s) been implemented?", {
          width: 5200,
        }),
        cell(optionLine(["YES", "NO", "Planning", "Not Applicable"], "Not Applicable"), {
          width: 5200,
        }),
      ]),

      row([
        cell("Please state action plan that should be taken for the next Instructor to teach this course."),
        cell(nextAction),
      ]),

      row([
        cell("Please include areas of improvement and action plan to be taken at course or program level."),
        cell(improvement),
      ]),
    ],
    { columnWidths: [5200, 5200] }
  );
};

const buildSignatureTable = () =>
  table(
    [
      row(
        [
          cell("Signature of Instructor", { width: 2600, bold: true }),
          cell("", { width: 3400 }),
          cell("Date", { width: 1600, bold: true }),
          cell("", { width: 2800 }),
        ],
        { height: 600 }
      ),
    ],
    { columnWidths: [2600, 3400, 1600, 2800] }
  );

const buildCommitteeTable = () =>
  table(
    [
      row([
        cell("This part to be filled by the Course Review Committee", {
          columnSpan: 4,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: HEADER_FILL,
        }),
      ]),

      row([
        cell("Comments of Convener of Course Review Committee", {
          columnSpan: 4,
          bold: true,
        }),
      ]),

      row(
        [cell("", { columnSpan: 4, verticalAlign: VerticalAlign.TOP })],
        { height: 900 }
      ),

      row([
        cell("Convener of Course Review Committee", {
          width: 3000,
          bold: true,
        }),
        cell("", { width: 3000 }),
        cell("Designation", { width: 1600, bold: true }),
        cell("", { width: 2800 }),
      ]),

      row([
        cell("Signature", { width: 3000, bold: true }),
        cell("", { width: 3000 }),
        cell("Date", { width: 1600, bold: true }),
        cell("", { width: 2800 }),
      ]),
    ],
    { columnWidths: [3000, 3000, 1600, 2800] }
  );

const buildChairTable = () => {
  const chairName = process.env.CSE_CHAIR_NAME || "";
  const chairDesignation = process.env.CSE_CHAIR_DESIGNATION || "";

  return table(
    [
      row([
        cell("This part to be filled by the Chairperson of the Dept. of CSE", {
          columnSpan: 4,
          bold: true,
          alignment: AlignmentType.CENTER,
          fill: HEADER_FILL,
        }),
      ]),

      row([
        cell("Comments of the Chairperson of the Department", {
          columnSpan: 4,
          bold: true,
        }),
      ]),

      row(
        [
          cell(
            "Findings and recommendations will be reviewed in the Course Review meeting and necessary actions will be taken to implement the suggestions.",
            {
              columnSpan: 4,
              verticalAlign: VerticalAlign.TOP,
            }
          ),
        ],
        { height: 700 }
      ),

      row([
        cell("Chairperson of Dept.", { width: 3000, bold: true }),
        cell(chairName, { width: 3000 }),
        cell("Designation", { width: 1600, bold: true }),
        cell(chairDesignation, { width: 2800 }),
      ]),

      row([
        cell("Signature", { width: 3000, bold: true }),
        cell("", { width: 3000 }),
        cell("Date", { width: 1600, bold: true }),
        cell("", { width: 2800 }),
      ]),
    ],
    { columnWidths: [3000, 3000, 1600, 2800] }
  );
};

const findTeacherCourse = async (courseId, teacherId) => {
  return Course.findOne({ _id: courseId, createdBy: teacherId }).populate(
    "createdBy",
    "name username email department designation"
  );
};

const getObeExportPayload = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await findTeacherCourse(courseId, req.user.userId);

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const [setup, blueprints, enrollments, marks, output] = await Promise.all([
      CourseObeConfig.findOne({ course: courseId }).lean(),
      ObeAssessmentBlueprint.find({ course: courseId })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      Enrollment.find({ course: courseId })
        .populate("student", "name username email")
        .lean(),
      ObeStudentMark.find({ course: courseId }).lean(),
      buildOutputData(courseId),
    ]);

    const students = enrollments
      .filter((record) => record.student?._id)
      .map((record) => ({
        studentId: String(record.student._id),
        roll: record.student.username || "",
        name: record.student.name || "",
        email: record.student.email || "",
      }));

    const enrolledStudentIds = new Set(
      students.map((student) => String(student.studentId))
    );
    const activeMarks = marks.filter((mark) =>
      enrolledStudentIds.has(String(mark.student))
    );

    return res.json({
      course,
      setup: setup || null,
      blueprints,
      students,
      marks: activeMarks,
      continuousAssessment: output?.continuousAssessment || null,
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

    const courseDoc = await findTeacherCourse(courseId, req.user.userId);

    if (!courseDoc) {
      return res.status(404).json({ message: "Course not found" });
    }

    const [setup, output] = await Promise.all([
      CourseObeConfig.findOne({ course: courseId }).lean(),
      buildOutputData(courseId),
    ]);

    if (!setup) {
      return res.status(400).json({
        message: "OBE setup not found for this course.",
      });
    }

    const course = courseDoc.toObject ? courseDoc.toObject() : courseDoc;
    const teacherName = course?.createdBy?.name || "-";

    const doc = new Document({
      creator: "BUBT Marks Portal",
      title: `Course Review Report - ${course.code || "Course"}`,

      styles: {
        default: {
          document: {
            run: {
              font: FONT,
              size: 20,
            },
            paragraph: {
              spacing: { after: 0, line: 220 },
            },
          },
        },
      },

      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 300,
                right: 720,
                bottom: 500,
                left: 720,
              },
            },
          },

          children: [
            ...buildHeader(),

            buildInfoAndAttainmentTable({
              course,
              setup,
              output,
              teacherName,
            }),

            emptyPara(100),

            buildFeedbackTable({
              setup,
              output,
            }),

            emptyPara(100),

            buildKnowledgeProfileTable({
              setup,
              output,
            }),

            emptyPara(100),

            buildReflectionTable({
              setup,
              output,
            }),

            emptyPara(160),

            buildSignatureTable(),

            emptyPara(220),

            buildCommitteeTable(),

            emptyPara(220),

            buildChairTable(),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const fileName = cleanFileName(
      `CRR_${course.code || "Course"}_${course.semester || "Semester"}_${
        course.year || "Year"
      }.docx`
    );

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