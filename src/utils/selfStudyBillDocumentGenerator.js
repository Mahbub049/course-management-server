const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "selfstudy",
  "SelfStudyCoursePaymentNoteTemplate.docx"
);

function xmlEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlText(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getBlocks(xml, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g");
  return xml.match(regex) || [];
}

function replaceNthBlock(xml, tag, index, replacement) {
  let current = -1;
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g");
  return xml.replace(regex, (match) => {
    current += 1;
    return current === index ? replacement : match;
  });
}

function setCellTexts(cellXml, values = []) {
  const texts = Array.isArray(values) ? values : [values];
  let index = 0;
  let found = false;
  const updated = cellXml.replace(/<w:t(?=\s|>)([^>]*)>[\s\S]*?<\/w:t>/g, (match, attrs) => {
    found = true;
    const value = texts[index] ?? "";
    index += 1;
    const keepSpace = /^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : "";
    const cleanAttrs = String(attrs || "").replace(/\s+xml:space="[^"]*"/g, "");
    return `<w:t${cleanAttrs}${keepSpace}>${xmlEscape(value)}</w:t>`;
  });
  return found ? updated : cellXml;
}

function setCellVerticalMerge(cellXml, mode) {
  const clean = cellXml
    .replace(/<w:vMerge(?:\s[^>]*)?\/>/g, "")
    .replace(/<w:vMerge(?:\s[^>]*)?>[\s\S]*?<\/w:vMerge>/g, "");
  const merge = mode === "restart" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>";
  return clean.replace(/<\/w:tcPr>/, `${merge}</w:tcPr>`);
}

function setRowCells(rowXml, values, mergeCourseCodeMode = null) {
  const cells = getBlocks(rowXml, "w:tc");
  if (!cells.length) return rowXml;
  let next = rowXml;
  cells.forEach((cell, index) => {
    let updated = setCellTexts(cell, [values[index] ?? ""]);
    if (index === 1 && mergeCourseCodeMode) {
      updated = setCellVerticalMerge(updated, mergeCourseCodeMode);
    }
    next = next.replace(cell, updated);
  });
  return next;
}

function replaceTokens(xml, data) {
  return xml.replace(/<w:t(?=\s|>)([^>]*)>([\s\S]*?)<\/w:t>/g, (match, attrs, rawText) => {
    let text = decodeXmlText(rawText);
    let changed = false;
    Object.entries(data).forEach(([token, value]) => {
      const marker = `{{${token}}}`;
      if (text.includes(marker)) {
        text = text.split(marker).join(String(value ?? ""));
        changed = true;
      }
    });
    if (!changed) return match;
    const keepSpace = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    const cleanAttrs = String(attrs || "").replace(/\s+xml:space="[^"]*"/g, "");
    return `<w:t${cleanAttrs}${keepSpace}>${xmlEscape(text)}</w:t>`;
  });
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function moneyPlain(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const SMALL = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underHundred(n) {
  if (n < 20) return SMALL[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${SMALL[n % 10]}` : ""}`;
}

function underThousand(n) {
  if (n < 100) return underHundred(n);
  const rest = n % 100;
  return `${SMALL[Math.floor(n / 100)]} Hundred${rest ? ` and ${underHundred(rest)}` : ""}`;
}

function amountInWords(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return "Zero Taka";
  let n = Math.floor(numeric);
  const paisa = Math.round((numeric - n) * 100);
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (n) parts.push(underThousand(n));
  const takaWords = parts.length ? parts.join(" ") : "Zero";
  return `${takaWords} Taka${paisa ? ` and ${underHundred(paisa)} Paisa` : ""}`;
}

function dhakaDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function replaceTableRows(tableXml, newRows) {
  const rows = getBlocks(tableXml, "w:tr");
  if (!rows.length) return tableXml;
  const firstStart = tableXml.indexOf(rows[0]);
  const last = rows[rows.length - 1];
  const lastEnd = tableXml.lastIndexOf(last) + last.length;
  return `${tableXml.slice(0, firstStart)}${newRows.join("")}${tableXml.slice(lastEnd)}`;
}

async function generateSelfStudyBillDocument(payload) {
  const {
    faculty = {},
    course = {},
    students = [],
    feeDetails = [],
    totalFacultyPayment = 0,
  } = payload;

  const templateBuffer = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuffer);
  let xml = await zip.file("word/document.xml").async("string");

  const semester = `${course.semester || ""} ${course.year || ""}`.trim();
  xml = replaceTokens(xml, {
    DATE: dhakaDate(),
    FACULTY_NAME: faculty.name || "",
    SHORTCODE: faculty.shortCode || "",
    SEMESTER: semester,
    COURSE_TITLE: course.title || "",
    COURSE_CODE: course.code || "",
    TOTAL: money(totalFacultyPayment),
    TOTAL_WORDS: amountInWords(totalFacultyPayment),
    DESIGNATION: faculty.designation || "Lecturer",
  });

  const tables = getBlocks(xml, "w:tbl");
  if (tables.length < 2) throw new Error("Self-study template tables were not found.");

  // Main student payment table: header + N student rows + total row.
  {
    const table = tables[0];
    const rows = getBlocks(table, "w:tr");
    if (rows.length < 4) throw new Error("Self-study student table template is invalid.");
    const header = rows[0];
    const firstStudentTemplate = rows[1];
    const continuationTemplate = rows[2];
    const totalTemplate = rows[rows.length - 1];
    const studentRows = students.map((student, index) => {
      const template = index === 0 ? firstStudentTemplate : continuationTemplate;
      return setRowCells(
        template,
        [
          index + 1,
          index === 0 ? course.code || "" : "",
          student.roll || "",
          student.name || "",
          student.intake || "",
          course.shift || "Day",
          `${moneyPlain(student.studentPaid)}/-`,
          `${moneyPlain(student.facultyPayment)}/-`,
        ],
        index === 0 ? "restart" : "continue"
      );
    });
    const totalCells = getBlocks(totalTemplate, "w:tc");
    let totalRow = totalTemplate;
    if (totalCells.length) {
      // Keep the template's merged Total label and replace the final amount only.
      totalRow = totalRow.replace(totalCells[totalCells.length - 1], setCellTexts(totalCells[totalCells.length - 1], [`${money(totalFacultyPayment)}/-`]));
    }
    const rebuilt = replaceTableRows(table, [header, ...studentRows, totalRow]);
    xml = replaceNthBlock(xml, "w:tbl", 0, rebuilt);
  }

  // Credit-wise fee details: header + one row per distinct intake/fee.
  {
    const currentTables = getBlocks(xml, "w:tbl");
    const table = currentTables[1];
    const rows = getBlocks(table, "w:tr");
    if (rows.length < 2) throw new Error("Self-study fee-detail table template is invalid.");
    const header = rows[0];
    const firstTemplate = rows[1];
    const continuationTemplate = rows[2] || rows[1];
    const detailRows = feeDetails.map((detail, index) => {
      const template = index === 0 ? firstTemplate : continuationTemplate;
      let row = setRowCells(template, [
        index === 0 ? detail.program || course.department || "" : "",
        index === 0 ? "Theory" : "",
        detail.intake || "",
        `${moneyPlain(detail.tuitionFeePerCredit)} × ${course.creditHours} = ${moneyPlain(detail.studentPaid)}/-`,
        `${moneyPlain(detail.facultyPayment)}/-`,
      ]);
      const cells = getBlocks(row, "w:tc");
      if (cells[0]) row = row.replace(cells[0], setCellVerticalMerge(cells[0], index === 0 ? "restart" : "continue"));
      const refreshed = getBlocks(row, "w:tc");
      if (refreshed[1]) row = row.replace(refreshed[1], setCellVerticalMerge(refreshed[1], index === 0 ? "restart" : "continue"));
      return row;
    });
    const rebuilt = replaceTableRows(table, [header, ...detailRows]);
    xml = replaceNthBlock(xml, "w:tbl", 1, rebuilt);
  }

  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { generateSelfStudyBillDocument, amountInWords };
