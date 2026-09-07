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

// Friday is printed on its own time-header row in the official routine. The
// Friday row uses the standard Evening periods, while keeping the saved slot
// IDs unchanged so the builder/validation logic stays consistent.
const FRIDAY_ROUTINE_COLUMNS = [
  { kind: "slot", id: "eve_0800_0915", label: "8:00-9:15" },
  { kind: "slot", id: "eve_0915_1030", label: "9:15-10:30" },
  { kind: "slot", id: "eve_1030_1145", label: "10:30-11:45" },
  { kind: "slot", id: "eve_1145_1300", label: "11:45-1:00" },
  // Friday has a longer prayer/lunch break than the regular day routine.
  // It is display-only: there is intentionally no editable/saved class slot
  // between 1:00 PM and 3:15 PM.
  { kind: "lunch", id: "friday_prayer_lunch", label: "1:00-3:15" },
  { kind: "slot", id: "eve_1515_1630", label: "3:15-4:30" },
  { kind: "slot", id: "eve_1630_1745", label: "4:30-5:45" },
  { kind: "slot", id: "eve_1745_1900", label: "5:45-7:00" },
  { kind: "slot", id: "eve_1900_2015", label: "7:00-8:15" },
  { kind: "slot", id: "eve_2015_2130", label: "8:15-9:30" },
];

function getFridayDisplayColumns(routine, targetBeforeLunchCount) {
  const lunchIndex = FRIDAY_ROUTINE_COLUMNS.findIndex((column) => column.kind === "lunch");
  const beforeLunch = FRIDAY_ROUTINE_COLUMNS.slice(0, lunchIndex);
  const lunch = FRIDAY_ROUTINE_COLUMNS[lunchIndex];
  const afterLunch = FRIDAY_ROUTINE_COLUMNS.slice(lunchIndex + 1);

  const target = Math.max(1, Math.min(beforeLunch.length, Number(targetBeforeLunchCount) || beforeLunch.length));
  if (beforeLunch.length <= target) return FRIDAY_ROUTINE_COLUMNS;

  // The official normal-day routine can hide completely unused columns.
  // Friday has four possible periods before its 1:00-3:15 P&L break, so when
  // the normal routine only displays three pre-lunch columns, omit a BLANK
  // Friday period instead of creating a fourth physical column that pushes
  // P&L to the right. Always keep 8:00-9:15 as the visible Friday starting
  // period and never drop a period containing a class/activity.
  const mustKeep = new Set([beforeLunch[0].id]);
  beforeLunch.forEach((column) => {
    if (routine.entries?.Fri?.[column.id]) mustKeep.add(column.id);
  });

  // If every candidate is occupied, preserving the data is more important
  // than compressing the table. In the usual case there is at least one blank
  // period available and the Friday P&L column remains aligned with above.
  if (mustKeep.size > target) return FRIDAY_ROUTINE_COLUMNS;

  const keepIds = new Set(mustKeep);
  // Prefer blank periods nearest to the occupied late-morning periods. This
  // keeps the 8:00 start while removing an unnecessary gap such as 9:15-10:30.
  for (let index = beforeLunch.length - 1; index >= 0 && keepIds.size < target; index -= 1) {
    keepIds.add(beforeLunch[index].id);
  }

  return [
    ...beforeLunch.filter((column) => keepIds.has(column.id)),
    lunch,
    ...afterLunch,
  ];
}
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

function setCellGridSpan(cellXml, span = 1) {
  const safeSpan = Math.max(1, Math.round(span));
  if (safeSpan <= 1) return cellXml;
  const updated = cellXml.replace(/<w:gridSpan[^>]*\/>/g, "");
  return updated.replace(/<\/w:tcPr>/, `<w:gridSpan w:val="${safeSpan}"/></w:tcPr>`);
}

function setCellVerticalMerge(cellXml, mode) {
  const clean = cellXml
    .replace(/<w:vMerge(?:\s[^>]*)?\/>/g, "")
    .replace(/<w:vMerge(?:\s[^>]*)?>[\s\S]*?<\/w:vMerge>/g, "");
  const merge = mode === "restart" ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
  return clean.replace(/<\/w:tcPr>/, `${merge}</w:tcPr>`);
}

function setCellLayout(cellXml, width, span = 1) {
  return setCellGridSpan(setCellWidth(cellXml, width), span);
}

function buildSharedGrid(layouts = []) {
  const normalized = layouts
    .filter((widths) => Array.isArray(widths) && widths.length)
    .map((widths) => widths.map((width) => Math.max(1, Math.round(width))));
  if (!normalized.length) return { widths: [], spans: [] };

  const total = normalized[0].reduce((sum, width) => sum + width, 0);
  const boundarySet = new Set([0, total]);
  normalized.forEach((widths) => {
    let cursor = 0;
    widths.forEach((width, index) => {
      cursor += width;
      if (index === widths.length - 1) cursor = total;
      boundarySet.add(cursor);
    });
  });

  const boundaries = [...boundarySet].sort((a, b) => a - b);
  const gridWidths = boundaries.slice(1).map((value, index) => value - boundaries[index]);
  const spans = normalized.map((widths) => {
    let cursor = 0;
    return widths.map((width, index) => {
      const start = cursor;
      cursor += width;
      if (index === widths.length - 1) cursor = total;
      const startIndex = boundaries.indexOf(start);
      const endIndex = boundaries.indexOf(cursor);
      return Math.max(1, endIndex - startIndex);
    });
  });

  return { widths: gridWidths, spans };
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
  const requestedDays = new Set(Array.isArray(routine.days) && routine.days.length
    ? routine.days
    : OFFICIAL_DAYS.map((item) => item.id));
  const days = OFFICIAL_DAYS.map((item) => item.id).filter((day) => requestedDays.has(day));
  const workingSet = new Set(routine.workingDays || []);

  // In the official class-routine document, Friday has its own time header and
  // row (matching the university's printed routine format). Exclude Friday
  // from the normal column calculation so its extended slots do not appear as
  // extra columns on the right side of the Monday-Thursday/Saturday table.
  // Both official downloads use the university's separate Friday timetable.
  // Excluding Friday from the normal column calculation prevents Friday-only
  // Evening periods from creating a long strip of extra columns in the
  // Faculty Nameplate document as well.
  const useSpecialFriday = days.includes("Fri") && workingSet.has("Fri");
  const mainDays = useSpecialFriday ? days.filter((day) => day !== "Fri") : days;
  const mainWorkingDays = (routine.workingDays || []).filter((day) => mainDays.includes(day));

  const visibleSlotIds = getVisibleSlotIds(routine.entries || {}, mainWorkingDays);
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
  const fridayRoutineColumns = useSpecialFriday
    ? getFridayDisplayColumns(routine, beforeLunch.length)
    : FRIDAY_ROUTINE_COLUMNS;

  const originalGrid = (templateTable.match(/<w:gridCol[^>]*w:w="(\d+)"[^>]*\/>/g) || [])
    .map((item) => Number(item.match(/w:w="(\d+)"/)?.[1] || 0));
  const totalWidth = originalGrid.reduce((sum, width) => sum + width, 0) || (isNameplate ? 11000 : 14800);
  const dayWidth = originalGrid[0] || (isNameplate ? 933 : 1325);
  const lunchOriginalIndex = 4;
  const lunchWidth = originalGrid[lunchOriginalIndex] || (isNameplate ? 518 : 813);
  const slotCount = Math.max(1, orderedColumns.filter((item) => item.kind === "slot").length);
  const hasLunch = orderedColumns.some((item) => item.kind === "lunch");

  // Preserve the current Monday-Thursday geometry when the normal routine has
  // the same nine teaching/activity positions that Friday used before the
  // dedicated 1:00-3:15 P&L column was introduced. Friday itself now has ten
  // cells (9 periods + P&L), so it gets its own boundaries without changing
  // the normal-day columns above it.
  const fridayTeachingSlotCount = fridayRoutineColumns.filter((column) => column.kind === "slot").length;
  const keepMainUniformForFriday = useSpecialFriday && orderedColumns.length === fridayTeachingSlotCount;
  const regularWidth = keepMainUniformForFriday
    ? Math.floor((totalWidth - dayWidth) / orderedColumns.length)
    : Math.floor((totalWidth - dayWidth - (hasLunch ? lunchWidth : 0)) / slotCount);
  const widths = [
    dayWidth,
    ...orderedColumns.map((column) =>
      keepMainUniformForFriday ? regularWidth : (column.kind === "lunch" ? lunchWidth : regularWidth)
    ),
  ];
  const widthRemainder = totalWidth - widths.reduce((sum, width) => sum + width, 0);
  if (widths.length > 1 && widthRemainder) widths[widths.length - 1] += widthRemainder;

  let fridayWidths = null;
  if (useSpecialFriday) {
    if (fridayRoutineColumns.length === orderedColumns.length) {
      // The preferred layout: Friday uses the exact same physical column
      // boundaries as the normal rows. Only the labels/times differ. This
      // keeps the 1:00-3:15 Friday P&L directly under the normal P&L column.
      fridayWidths = [...widths];
    } else {
      // Fallback only when all four Friday pre-lunch periods are occupied (or
      // another unusual layout makes compression impossible). Never discard
      // an occupied period merely to force alignment.
      const available = totalWidth - dayWidth;
      const fridayRegularWidth = Math.floor(available / fridayRoutineColumns.length);
      fridayWidths = [dayWidth, ...fridayRoutineColumns.map(() => fridayRegularWidth)];
      const fridayRemainder = totalWidth - fridayWidths.reduce((sum, width) => sum + width, 0);
      if (fridayRemainder) fridayWidths[fridayWidths.length - 1] += fridayRemainder;
    }
  }

  const sharedGrid = useSpecialFriday
    ? buildSharedGrid([widths, fridayWidths])
    : { widths, spans: [widths.map(() => 1)] };
  const mainSpans = sharedGrid.spans[0] || widths.map(() => 1);
  const fridaySpans = sharedGrid.spans[1] || (fridayWidths || []).map(() => 1);

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

  const dayHeader = setCellLayout(
    setCellTexts(dayHeaderPrototype, isNameplate ? ["Day/Time"] : ["Time", "Day"]),
    dayWidth,
    mainSpans[0]
  );
  const headerDynamicCells = orderedColumns.map((column, columnIndex) => {
    const width = column.kind === "lunch" ? lunchWidth : regularWidth;
    const span = mainSpans[columnIndex + 1];
    if (column.kind === "lunch") {
      return setCellLayout(
        setCellTexts(lunchHeaderPrototype, isNameplate ? ["P&L"] : [""]),
        width,
        span
      );
    }
    const slot = SLOT_MAP[column.id];
    return setCellLayout(
      setCellTexts(slotHeaderPrototype, isNameplate
        ? [slot.start, "", "", slot.end, "", ""]
        : [`${slot.start.replace(/^0/, "").replace(/\s?(AM|PM)$/i, "")}-${slot.end.replace(/^0/, "").replace(/\s?(AM|PM)$/i, "")}`]),
      width,
      span
    );
  });
  const headerRow = rows[0].replace(getBlocks(rows[0], "w:tc").join(""), `${dayHeader}${headerDynamicCells.join("")}`);

  const bodyRows = mainDays.map((day, dayIndex) => {
    const rowPrototype = rows[Math.min(dayIndex + 1, rows.length - 1)];
    const dayText = isNameplate ? DAY_LABELS[day] : day.toUpperCase();
    const dayCell = setCellLayout(setCellTexts(normalDayPrototype, [dayText]), dayWidth, mainSpans[0]);
    const cells = orderedColumns.map((column, columnIndex) => {
      const width = column.kind === "lunch" ? lunchWidth : regularWidth;
      const span = mainSpans[columnIndex + 1];
      if (column.kind === "lunch") {
        if (isNameplate) {
          return setCellLayout(setCellTexts(lunchContinuePrototype, [""]), width, span);
        }
        const prototype = dayIndex === 0 ? lunchRestartPrototype : lunchContinuePrototype;
        return setCellLayout(setCellTexts(prototype, dayIndex === 0 ? ["P&L"] : [""]), width, span);
      }

      if (!workingSet.has(day)) {
        return setCellLayout(
          setCellTexts(setCellFill(offPrototype, isNameplate ? "D9E4F2" : "D3D3D3"), ["OFF"]),
          width,
          span
        );
      }

      const entry = routine.entries?.[day]?.[column.id] || null;
      if (!entry) return setCellLayout(setCellTexts(normalBlankPrototype, [""]), width, span);
      if (entry.type === "CLASS") return setCellLayout(setCellTexts(classPrototype, entryTexts(entry)), width, span);
      return setCellLayout(setCellTexts(activityPrototype, [entry.label || entry.type]), width, span);
    });

    const oldCells = getBlocks(rowPrototype, "w:tc");
    return rowPrototype.replace(oldCells.join(""), `${dayCell}${cells.join("")}`);
  });

  if (useSpecialFriday) {
    const fridayHeaderPrototype = rows[0];
    const fridayRowPrototype = rows[rows.length - 1] || rows[Math.max(1, rows.length - 2)];

    // Keep each document's own visual language: the official routine uses its
    // gray Friday band, while the Faculty Nameplate keeps the existing BUBT
    // blue header + light-blue body styling. The structure is identical in
    // both: merged Friday cell, one time row, one class/activity row.
    const fridayDayFill = isNameplate ? "D0DEEE" : "B7B5B5";
    const fridayTimeFill = isNameplate ? "5B9BD4" : "B7B5B5";
    const fridayBodyFill = isNameplate ? "D0DEEE" : "B7B5B5";
    const fridayDayText = isNameplate ? (DAY_LABELS.Fri || "Friday") : "FRI";

    const fridayHeaderCells = [
      setCellVerticalMerge(
        setCellLayout(
          setCellTexts(setCellFill(isNameplate ? normalDayPrototype : dayHeaderPrototype, fridayDayFill), [fridayDayText]),
          fridayWidths[0],
          fridaySpans[0]
        ),
        "restart"
      ),
      ...fridayRoutineColumns.map((column, index) =>
        setCellLayout(
          setCellTexts(setCellFill(slotHeaderPrototype, fridayTimeFill), [column.label]),
          fridayWidths[index + 1],
          fridaySpans[index + 1]
        )
      ),
    ];
    const fridayHeaderRow = fridayHeaderPrototype.replace(
      getBlocks(fridayHeaderPrototype, "w:tc").join(""),
      fridayHeaderCells.join("")
    );

    const fridayBodyCells = [
      setCellVerticalMerge(
        setCellLayout(
          setCellTexts(setCellFill(normalDayPrototype, fridayDayFill), [""]),
          fridayWidths[0],
          fridaySpans[0]
        ),
        "continue"
      ),
      ...fridayRoutineColumns.map((column, index) => {
        const width = fridayWidths[index + 1];
        const span = fridaySpans[index + 1];

        // Friday 1:00-3:15 is always the official Prayer & Lunch period. It is
        // display-only and can never contain a class or weekly activity.
        if (column.kind === "lunch") {
          return setCellLayout(
            setCellTexts(setCellFill(activityPrototype, fridayBodyFill), ["P&L"]),
            width,
            span
          );
        }

        const entry = routine.entries?.Fri?.[column.id] || null;
        if (!entry) {
          return setCellLayout(
            setCellTexts(setCellFill(normalBlankPrototype, fridayBodyFill), [""]),
            width,
            span
          );
        }
        if (entry.type === "CLASS") {
          return setCellLayout(
            setCellTexts(setCellFill(classPrototype, fridayBodyFill), entryTexts(entry)),
            width,
            span
          );
        }
        return setCellLayout(
          setCellTexts(setCellFill(activityPrototype, fridayBodyFill), [entry.label || entry.type]),
          width,
          span
        );
      }),
    ];
    const fridayRow = fridayRowPrototype.replace(
      getBlocks(fridayRowPrototype, "w:tc").join(""),
      fridayBodyCells.join("")
    );

    bodyRows.push(fridayHeaderRow, fridayRow);
  }

  let result = templateTable.replace(rows.join(""), `${headerRow}${bodyRows.join("")}`);
  result = setTableGrid(result, sharedGrid.widths);

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
