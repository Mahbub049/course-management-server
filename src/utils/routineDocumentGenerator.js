const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const {
  OFFICIAL_DAYS,
  OFFICIAL_TIME_SLOTS,
  PRAYER_LUNCH,
  ACTIVITY_REQUIREMENTS,
  getVisibleSlotIds,
} = require("./routineRules");

const TEMPLATE_DIR = path.join(__dirname, "..", "templates", "routine");
const ROUTINE_TEMPLATE = path.join(TEMPLATE_DIR, "ClassRoutineTemplate.docx");
const NAMEPLATE_TEMPLATE = path.join(TEMPLATE_DIR, "FacultyNameplateTemplate.docx");

const DAY_LABELS = Object.fromEntries(OFFICIAL_DAYS.map((item) => [item.id, item.label]));
const SLOT_MAP = Object.fromEntries(OFFICIAL_TIME_SLOTS.map((item) => [item.id, item]));
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3vV0VQAAAABJRU5ErkJggg==",
  "base64"
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

function getCellWidth(cellXml) {
  const match = cellXml.match(/<w:tcW[^>]*w:w="(\d+)"/);
  return match ? Number(match[1]) : 1000;
}

function setCellWidth(cellXml, width) {
  return cellXml.replace(/(<w:tcW[^>]*w:w=")\d+("[^>]*>)/, `$1${Math.max(1, Math.round(width))}$2`);
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

  if (found) return updated;

  const paragraph = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${xmlEscape(texts[0] || "")}</w:t></w:r></w:p>`;
  return updated.replace(/<\/w:tc>$/, `${paragraph}</w:tc>`);
}

function setCellFill(cellXml, fill) {
  if (/<w:shd\b/.test(cellXml)) {
    return cellXml.replace(/<w:shd[^>]*>/, `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
  }
  return cellXml.replace(/<\/w:tcPr>/, `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>`);
}

function setTableGrid(tableXml, widths) {
  const grid = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`).join("")}</w:tblGrid>`;
  if (/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.test(tableXml)) {
    return tableXml.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, grid);
  }
  return tableXml.replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, (match) => `${match}${grid}`);
}

function replaceTextNodes(xml, replacements = []) {
  return xml.replace(/<w:t(?=\s|>)([^>]*)>([\s\S]*?)<\/w:t>/g, (match, attrs, rawText) => {
    let text = decodeXmlText(rawText);
    let changed = false;
    replacements.forEach(([from, to]) => {
      if (text.includes(from)) {
        text = text.split(from).join(to);
        changed = true;
      }
    });
    if (!changed) return match;
    const keepSpace = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    const cleanAttrs = String(attrs || "").replace(/\s+xml:space="[^"]*"/g, "");
    return `<w:t${cleanAttrs}${keepSpace}>${xmlEscape(text)}</w:t>`;
  });
}

function entryTexts(entry) {
  if (!entry) return [];
  if (entry.type !== "CLASS") return [entry.label || entry.type];
  return [
    entry.courseCode || "",
    entry.room || "",
    [entry.intake, entry.section].filter(Boolean).join("/"),
  ];
}

function buildDynamicTable(templateTable, routine, variant) {
  const rows = getBlocks(templateTable, "w:tr");
  const rowCells = rows.map((row) => getBlocks(row, "w:tc"));
  if (!rows.length || !rowCells[0]?.length) return templateTable;

  const isNameplate = variant === "nameplate";
  const visibleSlotIds = getVisibleSlotIds(routine.entries || {}, routine.workingDays || []);
  const visibleDaySlots = visibleSlotIds.filter((id) => SLOT_MAP[id]?.shift === "Day");
  const visibleEveningSlots = visibleSlotIds.filter((id) => SLOT_MAP[id]?.shift === "Evening");
  const beforeLunch = visibleDaySlots.filter((id) => (SLOT_MAP[id]?.sequenceOrder || 0) <= 3);
  const afterLunch = visibleDaySlots.filter((id) => (SLOT_MAP[id]?.sequenceOrder || 0) >= 4);
  const orderedColumns = [
    ...beforeLunch.map((id) => ({ kind: "slot", id })),
    ...(visibleDaySlots.length ? [{ kind: "lunch", id: PRAYER_LUNCH.id }] : []),
    ...afterLunch.map((id) => ({ kind: "slot", id })),
    ...visibleEveningSlots.map((id) => ({ kind: "slot", id })),
  ];

  const originalGrid = (templateTable.match(/<w:gridCol[^>]*w:w="(\d+)"[^>]*\/>/g) || [])
    .map((item) => Number(item.match(/w:w="(\d+)"/)?.[1] || 0));
  const totalWidth = originalGrid.reduce((sum, width) => sum + width, 0) || (isNameplate ? 11000 : 14800);
  const dayWidth = originalGrid[0] || (isNameplate ? 933 : 1325);
  const lunchOriginalIndex = 4;
  const lunchWidth = originalGrid[lunchOriginalIndex] || (isNameplate ? 518 : 813);
  const slotCount = Math.max(1, orderedColumns.filter((item) => item.kind === "slot").length);
  const hasLunch = orderedColumns.some((item) => item.kind === "lunch");
  const regularWidth = Math.floor((totalWidth - dayWidth - (hasLunch ? lunchWidth : 0)) / slotCount);
  const widths = [dayWidth, ...orderedColumns.map((column) => (column.kind === "lunch" ? lunchWidth : regularWidth))];

  const headerCells = rowCells[0];
  const dayHeaderPrototype = headerCells[0];
  const slotHeaderPrototype = headerCells[1];
  const lunchHeaderPrototype = headerCells[4];
  const normalDayPrototype = rowCells[isNameplate ? 1 : Math.min(2, rowCells.length - 1)][0];
  const normalBlankPrototype = rowCells[isNameplate ? 1 : Math.min(2, rowCells.length - 1)][1];
  const activityPrototype = rowCells[isNameplate ? 1 : Math.min(2, rowCells.length - 1)][2] || normalBlankPrototype;
  const classPrototype = rowCells[isNameplate ? 4 : Math.min(3, rowCells.length - 1)][1] || normalBlankPrototype;
  const offPrototype = rowCells[1]?.[1] || normalBlankPrototype;
  const lunchRestartPrototype = isNameplate ? lunchHeaderPrototype : rowCells[1]?.[4];
  const lunchContinuePrototype = rowCells[Math.min(2, rowCells.length - 1)]?.[4] || lunchRestartPrototype;

  const dayHeader = setCellWidth(setCellTexts(dayHeaderPrototype, isNameplate ? ["Day/Time"] : ["Time", "Day"]), dayWidth);
  const headerDynamicCells = orderedColumns.map((column) => {
    if (column.kind === "lunch") {
      return setCellWidth(
        setCellTexts(lunchHeaderPrototype, isNameplate ? ["P&L"] : [""]),
        lunchWidth
      );
    }
    const slot = SLOT_MAP[column.id];
    return setCellWidth(
      setCellTexts(slotHeaderPrototype, isNameplate ? [slot.start, "", "", slot.end, "", ""] : [`${slot.start.replace(/^0/, "").replace(/\s?(AM|PM)$/i, "")}-${slot.end.replace(/^0/, "").replace(/\s?(AM|PM)$/i, "")}`]),
      regularWidth
    );
  });
  let headerRow = rows[0].replace(getBlocks(rows[0], "w:tc").join(""), `${dayHeader}${headerDynamicCells.join("")}`);

  const requestedDays = new Set(Array.isArray(routine.days) && routine.days.length
    ? routine.days
    : OFFICIAL_DAYS.map((item) => item.id));
  const days = OFFICIAL_DAYS.map((item) => item.id).filter((day) => requestedDays.has(day));
  const workingSet = new Set(routine.workingDays || []);
  const bodyRows = days.map((day, dayIndex) => {
    const rowPrototype = rows[Math.min(dayIndex + 1, rows.length - 1)];
    const dayText = isNameplate ? DAY_LABELS[day] : day.toUpperCase();
    const dayCell = setCellWidth(setCellTexts(normalDayPrototype, [dayText]), dayWidth);
    const cells = orderedColumns.map((column) => {
      if (column.kind === "lunch") {
        if (isNameplate) {
          return setCellWidth(setCellTexts(lunchContinuePrototype, [""]), lunchWidth);
        }
        const prototype = dayIndex === 0 ? lunchRestartPrototype : lunchContinuePrototype;
        return setCellWidth(setCellTexts(prototype, dayIndex === 0 ? ["P&L"] : [""]), lunchWidth);
      }

      if (!workingSet.has(day)) {
        return setCellWidth(setCellTexts(setCellFill(offPrototype, isNameplate ? "D9E4F2" : "D3D3D3"), ["OFF"]), regularWidth);
      }

      const entry = routine.entries?.[day]?.[column.id] || null;
      if (!entry) return setCellWidth(setCellTexts(normalBlankPrototype, [""]), regularWidth);
      if (entry.type === "CLASS") return setCellWidth(setCellTexts(classPrototype, entryTexts(entry)), regularWidth);
      return setCellWidth(setCellTexts(activityPrototype, [entry.label || entry.type]), regularWidth);
    });

    const oldCells = getBlocks(rowPrototype, "w:tc");
    return rowPrototype.replace(oldCells.join(""), `${dayCell}${cells.join("")}`);
  });

  let result = templateTable.replace(rows.join(""), `${headerRow}${bodyRows.join("")}`);
  result = setTableGrid(result, widths);

  // The converted class-routine template stores its timetable as a floating
  // table. Once unused time columns are removed, Word/LibreOffice may allow
  // the faculty-information text boxes to overlap that floating table. Keep
  // the same visual position and formatting, but make the generated table
  // inline so every element below it remains anchored in the correct place.
  if (!isNameplate) {
    result = result.replace(/<w:tblpPr\b[^>]*\/>/, "");
  }

  return result;
}

function semesterText(routine, withTri = false) {
  const text = [routine.semester, routine.year].filter(Boolean).join(" ");
  return withTri ? `${text} (Tri)` : text;
}

function departmentHeader(routine) {
  const value = String(routine.department || "").trim();
  if (!value) return "Department of Computer Science and Engineering";
  if (/^(dept\.?\s*of\s*)?cse$/i.test(value) || /computer science and engineering/i.test(value)) {
    return "Department of Computer Science and Engineering";
  }
  if (/^department of /i.test(value)) return value;
  return `Department of ${value}`;
}

function designationText(routine) {
  const designation = routine.designation || "Lecturer";
  const department = routine.department || "Dept. of CSE";
  return department.toLowerCase().startsWith("dept") ? `${designation}, ${department}` : `${designation}, Dept. of ${department}`;
}

async function resolveProfileImage(source) {
  if (!source) return { bytes: TRANSPARENT_PNG, extension: "png", contentType: "image/png" };
  try {
    if (/^data:image\//i.test(source)) {
      const match = source.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);
      if (!match) throw new Error("Unsupported image data URL");
      const extension = match[1].toLowerCase().includes("png") ? "png" : "jpeg";
      return { bytes: Buffer.from(match[2], "base64"), extension, contentType: match[1].toLowerCase() };
    }

    const response = await fetch(source);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("png") && !contentType.includes("jpeg") && !contentType.includes("jpg")) {
      throw new Error("Unsupported profile image type");
    }
    const extension = contentType.includes("png") ? "png" : "jpeg";
    return { bytes: Buffer.from(await response.arrayBuffer()), extension, contentType: extension === "png" ? "image/png" : "image/jpeg" };
  } catch (error) {
    console.warn("Could not embed routine profile image:", error.message);
    return { bytes: TRANSPARENT_PNG, extension: "png", contentType: "image/png" };
  }
}

async function replaceNameplateProfileImage(zip, source) {
  const image = await resolveProfileImage(source);
  const oldTarget = "media/image1.jpeg";
  const newFileName = `profile.${image.extension}`;
  const newTarget = `media/${newFileName}`;
  zip.remove("word/media/image1.jpeg");
  zip.file(`word/media/${newFileName}`, image.bytes);

  const relPath = "word/_rels/document.xml.rels";
  let rels = await zip.file(relPath).async("string");
  rels = rels.replace(oldTarget, newTarget);
  zip.file(relPath, rels);

  const contentPath = "[Content_Types].xml";
  let contentTypes = await zip.file(contentPath).async("string");
  const extension = image.extension === "jpeg" ? "jpeg" : "png";
  if (!new RegExp(`<Default[^>]*Extension="${extension}"`, "i").test(contentTypes)) {
    contentTypes = contentTypes.replace(
      "</Types>",
      `<Default Extension="${extension}" ContentType="${image.contentType}"/></Types>`
    );
  }
  zip.file(contentPath, contentTypes);
}

async function generateRoutineDocument(routine) {
  const zip = await JSZip.loadAsync(fs.readFileSync(ROUTINE_TEMPLATE));
  const documentPath = "word/document.xml";
  let xml = await zip.file(documentPath).async("string");
  const tables = getBlocks(xml, "w:tbl");
  if (tables[0]) xml = replaceNthBlock(xml, "w:tbl", 0, buildDynamicTable(tables[0], routine, "routine"));

  xml = replaceTextNodes(xml, [
    ["Bangladesh University of Business and Technology (BUBT)", routine.universityName || "Bangladesh University of Business and Technology (BUBT)"],
    ["Department of Computer Science and Engineering", departmentHeader(routine)],
    ["Summer 2026 (Tri)", semesterText(routine, true)],
    ["Muhammad Mahbub Sarwar Shafi", routine.facultyName || ""],
    ["MMSS ", `${routine.facultyCode || ""} `],
    ["Lecturer, Dept. of CSE", designationText(routine)],
    ["mahbubsarwar@bubt.edu.bd", routine.facultyEmail || ""],
    ["+8801341883668", routine.facultyPhone || ""],
    ["(2)", "(3)"],
  ]);

  // The converted source template carries a signature line a few pixels onto a
  // second page. Slightly reducing the vertical margins keeps the official
  // one-page landscape layout intact without changing the visible design.
  xml = xml.replace(/<w:pgMar([^>]*?)w:top="720"([^>]*?)w:bottom="720"([^>]*?)\/>/, '<w:pgMar$1w:top="360"$2w:bottom="360"$3/>');

  zip.file(documentPath, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function generateNameplateDocument(routine) {
  const zip = await JSZip.loadAsync(fs.readFileSync(NAMEPLATE_TEMPLATE));
  const documentPath = "word/document.xml";
  let xml = await zip.file(documentPath).async("string");
  const tables = getBlocks(xml, "w:tbl");
  if (tables[0]) xml = replaceNthBlock(xml, "w:tbl", 0, buildDynamicTable(tables[0], routine, "nameplate"));

  const fullName = routine.facultyName || "";
  xml = replaceTextNodes(xml, [
    ["Muhammad Mahbub Sarwar ", fullName],
    ["Shafi", ""],
    [" MMSS", ` ${routine.facultyCode || ""}`],
    ["Summer 2026", semesterText(routine, false)],
    ["     Lecturer", `     ${routine.designation || "Lecturer"}`],
    [" mahbubsarwar@bubt.edu.bd", ` ${routine.facultyEmail || ""}`],
    [" +01341883668", ` ${routine.facultyPhone || ""}`],
  ]);

  zip.file(documentPath, xml);
  await replaceNameplateProfileImage(zip, routine.facultyProfileImage);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function safeFilenamePart(value = "") {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Faculty";
}

function buildDownloadFilename(routine, kind) {
  const code = safeFilenamePart(routine.facultyCode || routine.facultyName || "Faculty");
  const semester = safeFilenamePart([routine.semester, routine.year].filter(Boolean).join("_"));
  return kind === "nameplate"
    ? `${code}_Faculty_Nameplate_${semester}.docx`
    : `${code}_Class_Routine_${semester}.docx`;
}

module.exports = {
  generateRoutineDocument,
  generateNameplateDocument,
  buildDownloadFilename,
};
