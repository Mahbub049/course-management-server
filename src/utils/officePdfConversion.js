const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pathToFileURL } = require("url");
const JSZip = require("jszip");

const execFileAsync = promisify(execFile);

function candidateLibreOfficeBins() {
  return [
    process.env.LIBREOFFICE_BIN,
    "soffice",
    "libreoffice",
    process.platform !== "win32" ? "/usr/bin/soffice" : null,
    process.platform !== "win32" ? "/usr/bin/libreoffice" : null,
    process.platform !== "win32" ? "/usr/lib/libreoffice/program/soffice" : null,
    process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe" : null,
    process.platform === "win32" ? "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe" : null,
  ].filter(Boolean);
}

async function runLibreOffice(args, options = {}) {
  let lastError = null;
  for (const bin of candidateLibreOfficeBins()) {
    try {
      return await execFileAsync(bin, args, {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        ...options,
      });
    } catch (error) {
      lastError = error;
      if (!["ENOENT", "EACCES"].includes(error?.code)) throw error;
    }
  }
  const error = new Error(
    "LibreOffice is required for exact Course File PDF conversion. Install LibreOffice on the server or set LIBREOFFICE_BIN to the soffice executable."
  );
  error.code = "LIBREOFFICE_NOT_AVAILABLE";
  error.cause = lastError;
  throw error;
}

function xmlUnescape(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function prepareWorkbookXml(xml, targetSheetName) {
  const tags = Array.from(xml.matchAll(/<sheet\b[^>]*\/>/g));
  let targetIndex = -1;
  let targetRid = "";
  tags.forEach((match, index) => {
    const tag = match[0];
    const name = xmlUnescape(tag.match(/\bname="([^"]*)"/)?.[1] || "");
    if (name === targetSheetName) {
      targetIndex = index;
      targetRid = tag.match(/\br:id="([^"]+)"/)?.[1] || "";
    }
  });
  if (targetIndex < 0) throw new Error(`Worksheet "${targetSheetName}" was not found in the uploaded OBE workbook.`);

  let updated = xml.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    const name = xmlUnescape(tag.match(/\bname="([^"]*)"/)?.[1] || "");
    let next = tag.replace(/\sstate="[^"]*"/g, "");
    if (name !== targetSheetName) next = next.replace(/\/>$/, ' state="hidden"/>');
    return next;
  });

  if (/activeTab="\d+"/.test(updated)) updated = updated.replace(/activeTab="\d+"/, `activeTab="${targetIndex}"`);
  else updated = updated.replace(/<workbookView\b/, `<workbookView activeTab="${targetIndex}"`);

  return { xml: updated, targetIndex, targetRid };
}

function worksheetPathFromRelationships(relsXml, targetRid) {
  const relation = Array.from(relsXml.matchAll(/<Relationship\b[^>]*\/>/g)).find((match) => {
    return (match[0].match(/\bId="([^"]+)"/)?.[1] || "") === targetRid;
  })?.[0];
  if (!relation) return "";
  let target = relation.match(/\bTarget="([^"]+)"/)?.[1] || "";
  target = target.replace(/^\//, "").replace(/^\.\//, "");
  if (target.startsWith("../")) target = target.replace(/^\.\.\//, "");
  return target.startsWith("xl/") ? target : `xl/${target}`;
}

function setGradeSheetPrintArea(workbookXml, localSheetId, mode = "improved") {
  // Improved mode keeps Result Summary/Chart together as its own print range.
  // Stable mode is the previous known-good layout and is used automatically
  // if a particular LibreOffice build rejects the improved workbook.
  const area = mode === "stable"
    ? `'GradeSheet'!$A$1:$X$119,'GradeSheet'!$Z$26:$BE$103`
    : `'GradeSheet'!$A$1:$X$101,'GradeSheet'!$A$102:$X$119,'GradeSheet'!$Z$26:$BE$103`;
  const defined = `<definedName name="_xlnm.Print_Area" localSheetId="${localSheetId}">${area}</definedName>`;
  if (/<definedNames>/.test(workbookXml)) {
    let body = workbookXml.match(/<definedNames>([\s\S]*?)<\/definedNames>/)?.[1] || "";
    body = body.replace(new RegExp(`<definedName\\b(?=[^>]*name="_xlnm\\.Print_Area")(?=[^>]*localSheetId="${localSheetId}")[^>]*>[\\s\\S]*?<\\/definedName>`, "g"), "");
    return workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${body}${defined}</definedNames>`);
  }
  return workbookXml.replace(/<\/workbook>\s*$/, `<definedNames>${defined}</definedNames></workbook>`);
}

function setSingleSheetPrintArea(workbookXml, localSheetId, sheetName, area) {
  const escapedName = String(sheetName || "").replace(/'/g, "''");
  const defined = `<definedName name="_xlnm.Print_Area" localSheetId="${localSheetId}">'${escapedName}'!${area}</definedName>`;
  if (/<definedNames>/.test(workbookXml)) {
    let body = workbookXml.match(/<definedNames>([\s\S]*?)<\/definedNames>/)?.[1] || "";
    body = body.replace(
      new RegExp(`<definedName\\b(?=[^>]*name="_xlnm\\.Print_Area")(?=[^>]*localSheetId="${localSheetId}")[^>]*>[\\s\\S]*?<\\/definedName>`, "g"),
      ""
    );
    return workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${body}${defined}</definedNames>`);
  }
  return workbookXml.replace(/<\/workbook>\s*$/, `<definedNames>${defined}</definedNames></workbook>`);
}

function setWorksheetPrintCentering(sheetXml, { horizontal = true, vertical = false } = {}) {
  const attrs = ` horizontalCentered="${horizontal ? 1 : 0}" verticalCentered="${vertical ? 1 : 0}"`;
  if (/<printOptions\b[^>]*\/>/.test(sheetXml)) {
    return sheetXml.replace(/<printOptions\b([^>]*)\/>/, (_match, rawAttrs) => {
      const cleaned = String(rawAttrs || "")
        .replace(/\shorizontalCentered="[^"]*"/g, "")
        .replace(/\sverticalCentered="[^"]*"/g, "");
      return `<printOptions${cleaned}${attrs}/>`;
    });
  }
  if (/<pageMargins\b/.test(sheetXml)) return sheetXml.replace(/<pageMargins\b/, `<printOptions${attrs}/><pageMargins`);
  if (/<pageSetup\b/.test(sheetXml)) return sheetXml.replace(/<pageSetup\b/, `<printOptions${attrs}/><pageSetup`);
  return sheetXml.replace(/<\/worksheet>\s*$/, `<printOptions${attrs}/></worksheet>`);
}

function firstBlankStudentRow(sheetXml) {
  for (let row = 30; row <= 100; row += 1) {
    const opening = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="A${row}"[^>]*?(\\/?)>`));
    if (!opening || opening[1] === "/") return row;
    const whole = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="A${row}"[^>]*>[\\s\\S]*?<\\/c>`));
    const cell = whole?.[0] || "";
    if (!/<(?:v|t)>[^<]+<\/(?:v|t)>/.test(cell)) return row;
  }
  return 101;
}

function hideUnusedStudentRows(sheetXml) {
  const firstBlank = firstBlankStudentRow(sheetXml);
  if (firstBlank > 100) return sheetXml;
  return sheetXml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>/g, (tag, rawRow) => {
    const row = Number(rawRow);
    if (row < firstBlank || row > 100) return tag;
    if (/\shidden="[^"]*"/.test(tag)) return tag.replace(/\shidden="[^"]*"/, ' hidden="1"');
    return tag.replace(/>$/, ' hidden="1">');
  });
}

function firstBlankRowInColumn(sheetXml, column = "C", startRow = 8, endRow = 300) {
  for (let row = startRow; row <= endRow; row += 1) {
    const opening = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="${column}${row}"[^>]*?(\\/?)>`));
    if (!opening || opening[1] === "/") return row;
    const whole = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="${column}${row}"[^>]*>[\\s\\S]*?<\\/c>`));
    const cell = whole?.[0] || "";
    if (!/<(?:v|t)>[^<]+<\/(?:v|t)>/.test(cell)) return row;
  }
  return endRow + 1;
}

function hideUnusedRowsByColumn(sheetXml, { column = "C", startRow = 8, endRow = 300 } = {}) {
  const firstBlank = firstBlankRowInColumn(sheetXml, column, startRow, endRow);
  if (firstBlank > endRow) return sheetXml;
  return sheetXml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>/g, (tag, rawRow) => {
    const row = Number(rawRow);
    if (row < firstBlank || row > endRow) return tag;
    if (/\shidden="[^"]*"/.test(tag)) return tag.replace(/\shidden="[^"]*"/, ' hidden="1"');
    return tag.replace(/>$/, ' hidden="1">');
  });
}

function setWorksheetFitToSinglePage(sheetXml, { paperSize = 9, orientation = "portrait" } = {}) {
  let next = sheetXml;

  if (/<sheetPr\b[^>]*>/.test(next)) {
    if (/<pageSetUpPr\b[^>]*\/>/.test(next)) {
      next = next.replace(/<pageSetUpPr([^>]*)\/>/, (_match, rawAttrs) => {
        const attrs = String(rawAttrs || "").replace(/\sfitToPage="[^"]*"/g, "");
        return `<pageSetUpPr${attrs} fitToPage="1"/>`;
      });
    } else {
      next = next.replace(/<\/sheetPr>/, '<pageSetUpPr fitToPage="1"/></sheetPr>');
    }
  } else {
    next = next.replace(/<dimension\b/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
  }

  const pageSetup = `<pageSetup paperSize="${paperSize}" orientation="${orientation}" fitToWidth="1" fitToHeight="1"/>`;
  if (/<pageSetup\b[^>]*\/>/.test(next)) {
    next = next.replace(/<pageSetup\b[^>]*\/>/, pageSetup);
  } else if (/<pageMargins\b[^>]*\/>/.test(next)) {
    // OOXML worksheet order is printOptions -> pageMargins -> pageSetup.
    // Keeping that order makes LibreOffice consistently honor the print area,
    // centering, margins and one-page fit settings for the CLP sheet.
    next = next.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetup}`);
  } else {
    next = next.replace(/<\/worksheet>\s*$/, `${pageSetup}</worksheet>`);
  }

  return setWorksheetMargins(next, { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2 });
}


function setWorksheetPaper(sheetXml, { paperSize = 9, orientation = "" } = {}) {
  const match = sheetXml.match(/<pageSetup([^>]*)\/>/);
  if (!match) return sheetXml;
  let attrs = match[1];
  attrs = attrs.replace(/\spaperSize="[^"]*"/g, "");
  attrs = attrs.replace(/\sorientation="[^"]*"/g, "");
  const orientationAttr = orientation ? ` orientation="${orientation}"` : "";
  return sheetXml.replace(match[0], `<pageSetup${attrs} paperSize="${paperSize}"${orientationAttr}/>`);
}

function setWorksheetMargins(sheetXml, { left = 0.15, right = 0.15, top = 0.2, bottom = 0.2 } = {}) {
  const replacement = `<pageMargins left="${left}" right="${right}" top="${top}" bottom="${bottom}" header="0" footer="0"/>`;
  if (/<pageMargins[^>]*\/>/.test(sheetXml)) return sheetXml.replace(/<pageMargins[^>]*\/>/, replacement);
  return sheetXml.replace(/<pageSetup\b/, `${replacement}<pageSetup`);
}

function setWorksheetScale(sheetXml, scale = 45) {
  const match = sheetXml.match(/<pageSetup([^>]*)\/>/);
  if (!match) return sheetXml;
  let attrs = match[1];
  ["scale", "fitToWidth", "fitToHeight"].forEach((name) => {
    attrs = attrs.replace(new RegExp(`\\s${name}="[^"]*"`, "g"), "");
  });
  const replacement = `<pageSetup${attrs} scale="${scale}"/>`;
  return sheetXml.replace(match[0], replacement);
}


function hideEveryWorkbookSheet(workbookXml) {
  return workbookXml.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    let next = tag.replace(/\sstate="[^"]*"/g, "");
    return next.replace(/\/>$/, ' state="hidden"/>');
  });
}

function setWorkbookActiveTab(workbookXml, index) {
  if (/activeTab="\d+"/.test(workbookXml)) return workbookXml.replace(/activeTab="\d+"/, `activeTab="${index}"`);
  return workbookXml.replace(/<workbookView\b/, `<workbookView activeTab="${index}"`);
}

function removeWorkbookPrintAreas(workbookXml) {
  if (!/<definedNames>/.test(workbookXml)) return workbookXml;
  const match = workbookXml.match(/<definedNames>([\s\S]*?)<\/definedNames>/);
  if (!match) return workbookXml;
  const body = (match[1] || "").replace(
    /<definedName\b(?=[^>]*name="_xlnm\.Print_Area")[^>]*>[\s\S]*?<\/definedName>/g,
    ""
  );
  if (body.trim()) return workbookXml.replace(match[0], `<definedNames>${body}</definedNames>`);
  return workbookXml.replace(match[0], "");
}

function appendWorkbookDefinedNames(workbookXml, definitions = []) {
  if (!definitions.length) return workbookXml;
  const joined = definitions.join("");
  if (/<definedNames>/.test(workbookXml)) {
    return workbookXml.replace(/<\/definedNames>/, `${joined}</definedNames>`);
  }
  return workbookXml.replace(/<\/workbook>\s*$/, `<definedNames>${joined}</definedNames></workbook>`);
}

function nextNumericIds(xml, pattern, count) {
  const used = Array.from(xml.matchAll(pattern)).map((match) => Number(match[1])).filter(Number.isFinite);
  let next = used.length ? Math.max(...used) + 1 : 1;
  return Array.from({ length: count }, () => next++);
}

function nextWorksheetFileNumbers(zip, count) {
  const used = Object.keys(zip.files)
    .map((name) => name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1])
    .filter(Boolean)
    .map(Number);
  let next = used.length ? Math.max(...used) + 1 : 1;
  return Array.from({ length: count }, () => next++);
}

function worksheetRelsPath(worksheetPath) {
  const fileName = path.posix.basename(worksheetPath);
  return `xl/worksheets/_rels/${fileName}.rels`;
}

function addWorksheetContentTypeOverrides(contentTypesXml, worksheetPaths) {
  if (!contentTypesXml || !worksheetPaths.length) return contentTypesXml;
  const entries = worksheetPaths
    .filter((worksheetPath) => !contentTypesXml.includes(`PartName="/${worksheetPath}"`))
    .map(
      (worksheetPath) =>
        `<Override PartName="/${worksheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");
  if (!entries) return contentTypesXml;
  return contentTypesXml.replace(/<\/Types>\s*$/, `${entries}</Types>`);
}

function gradeSheetScaleForStudentRows(lastStudentRow, maximum, referenceMaximum) {
  const referenceLastRow = 61; // 32 students in rows 30-61 fits at the tested maximum scale.
  const effectiveLastRow = Math.max(referenceLastRow, Number(lastStudentRow) || referenceLastRow);
  return Math.max(referenceMaximum, Math.min(maximum, Math.floor((maximum * referenceLastRow) / effectiveLastRow)));
}

async function prepareGradeSheetPagedWorkbook(zip, workbookXml, relsXml, targetWorksheetPath) {
  const sourceSheetFile = zip.file(targetWorksheetPath);
  if (!sourceSheetFile) throw new Error("The GradeSheet worksheet file could not be read from the OBE workbook.");
  const sourceSheetXml = await sourceSheetFile.async("text");
  const firstBlank = firstBlankStudentRow(sourceSheetXml);
  const lastStudentRow = Math.max(30, Math.min(100, firstBlank - 1));

  const originalSheetTags = Array.from(workbookXml.matchAll(/<sheet\b[^>]*\/>/g));
  const cloneStartIndex = originalSheetTags.length;
  const sheetIds = nextNumericIds(workbookXml, /\bsheetId="(\d+)"/g, 3);
  const relationshipIds = nextNumericIds(relsXml, /\bId="rId(\d+)"/g, 3).map((value) => `rId${value}`);
  const worksheetNumbers = nextWorksheetFileNumbers(zip, 3);
  const worksheetPaths = worksheetNumbers.map((number) => `xl/worksheets/sheet${number}.xml`);
  const cloneNames = ["GradeSheet Print 1", "GradeSheet Print 2", "GradeSheet Print 3"];

  // Keep the original GradeSheet (and every other original worksheet) in the
  // temporary workbook, but hide them. The cloned print sheets can therefore
  // keep all formulas/charts that refer to the original GradeSheet unchanged.
  workbookXml = hideEveryWorkbookSheet(workbookXml);
  const cloneTags = cloneNames
    .map((name, index) => `<sheet name="${name}" sheetId="${sheetIds[index]}" r:id="${relationshipIds[index]}"/>`)
    .join("");
  workbookXml = workbookXml.replace(/<\/sheets>/, `${cloneTags}</sheets>`);
  workbookXml = setWorkbookActiveTab(workbookXml, cloneStartIndex);
  workbookXml = removeWorkbookPrintAreas(workbookXml);

  const page1Scale = gradeSheetScaleForStudentRows(lastStudentRow, 62, 38);
  const page3Scale = gradeSheetScaleForStudentRows(lastStudentRow, 47, 30);
  const printAreas = [
    `$A$1:$X$${lastStudentRow}`,
    "$B$102:$X$119",
    "$Z$26:$BE$103",
  ];
  workbookXml = appendWorkbookDefinedNames(
    workbookXml,
    printAreas.map(
      (area, index) =>
        `<definedName name="_xlnm.Print_Area" localSheetId="${cloneStartIndex + index}">'${cloneNames[index]}'!${area}</definedName>`
    )
  );

  const relationshipEntries = worksheetPaths
    .map(
      (worksheetPath, index) =>
        `<Relationship Id="${relationshipIds[index]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${path.posix.basename(worksheetPath)}"/>`
    )
    .join("");
  relsXml = relsXml.replace(/<\/Relationships>\s*$/, `${relationshipEntries}</Relationships>`);

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (contentTypesFile) {
    const contentTypesXml = await contentTypesFile.async("text");
    zip.file("[Content_Types].xml", addWorksheetContentTypeOverrides(contentTypesXml, worksheetPaths));
  }

  const sourceRelsPath = worksheetRelsPath(targetWorksheetPath);
  const sourceRelsFile = zip.file(sourceRelsPath);
  const sourceRelsXml = sourceRelsFile ? await sourceRelsFile.async("text") : "";

  let page1Xml = setWorksheetScale(sourceSheetXml, page1Scale);
  page1Xml = setWorksheetMargins(page1Xml, { left: 0.03, right: 0.03, top: 0.03, bottom: 0.03 });
  page1Xml = setWorksheetPaper(page1Xml, { paperSize: 9, orientation: "landscape" });

  let page2Xml = setWorksheetScale(sourceSheetXml, 90);
  page2Xml = setWorksheetMargins(page2Xml, { left: 0.03, right: 0.03, top: 0.03, bottom: 0.03 });
  page2Xml = setWorksheetPaper(page2Xml, { paperSize: 9, orientation: "landscape" });

  let page3Xml = hideUnusedStudentRows(sourceSheetXml);
  page3Xml = setWorksheetScale(page3Xml, page3Scale);
  page3Xml = setWorksheetMargins(page3Xml, { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2 });
  page3Xml = setWorksheetPaper(page3Xml, { paperSize: 9, orientation: "landscape" });

  [page1Xml, page2Xml, page3Xml].forEach((xml, index) => {
    zip.file(worksheetPaths[index], xml);
    if (sourceRelsXml) zip.file(worksheetRelsPath(worksheetPaths[index]), sourceRelsXml);
  });

  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", relsXml);
  return { buffer: Buffer.from(await zip.generateAsync({ type: "nodebuffer" })), exportFilter: "pdf:calc_pdf_Export" };
}

async function isolateSpreadsheetSheet(buffer, originalName, targetSheetName, layoutMode = "improved") {
  const ext = path.extname(originalName || "").toLowerCase();
  // PDF uploads are sometimes perfectly valid for a browser/PDF viewer but
  // contain structures that pdf.js cannot rasterize reliably. LibreOffice Draw
  // can normalize them into a fresh PDF without changing the physical page size.
  // This path is used only as a fallback for Combined Course File generation.
  if (!targetSheetName && ext === ".pdf") return { buffer, exportFilter: "pdf:draw_pdf_Export" };
  if (!targetSheetName) return { buffer, exportFilter: "pdf" };
  if (![".xlsx", ".xlsm"].includes(ext)) {
    throw new Error("Exact worksheet-only PDF export supports .xlsx and .xlsm files. Please upload the original OBE .xlsm/.xlsx workbook.");
  }

  const zip = await JSZip.loadAsync(buffer);
  const workbookFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relsFile) throw new Error("The uploaded workbook is missing its workbook metadata.");

  let workbookXml = await workbookFile.async("text");
  const relsXml = await relsFile.async("text");
  const prepared = prepareWorkbookXml(workbookXml, targetSheetName);
  const targetWorksheetPath = worksheetPathFromRelationships(relsXml, prepared.targetRid);

  if (targetSheetName === "GradeSheet" && layoutMode === "improved") {
    return prepareGradeSheetPagedWorkbook(zip, workbookXml, relsXml, targetWorksheetPath);
  }

  workbookXml = prepared.xml;
  const sheetFile = zip.file(targetWorksheetPath);
  if (sheetFile) {
    let sheetXml = await sheetFile.async("text");
    if (targetSheetName === "GradeSheet") {
      workbookXml = setGradeSheetPrintArea(workbookXml, prepared.targetIndex, layoutMode);
      sheetXml = hideUnusedStudentRows(sheetXml);
      if (layoutMode === "stable") {
        sheetXml = setWorksheetScale(sheetXml, 45);
      } else {
        // Larger and tighter than the original export while preserving the Excel design.
        sheetXml = setWorksheetScale(sheetXml, 47);
        sheetXml = setWorksheetMargins(sheetXml);
      }
      sheetXml = setWorksheetPaper(sheetXml, { paperSize: 9, orientation: "landscape" });
    } else if (targetSheetName === "Course Report") {
      sheetXml = setWorksheetPaper(sheetXml, { paperSize: 9, orientation: "portrait" });
    } else if (targetSheetName === "CLP") {
      // The official CLP table starts at C4. Printing the worksheet's whole used
      // grid (including the intentionally blank A:B columns) pushed the table
      // to the right and left a large empty margin. Limit the print area to the
      // actual CLP table, then center that table inside a normal A4 portrait page.
      const firstBlank = firstBlankRowInColumn(sheetXml, "C", 8, 300);
      const lastStudentRow = Math.max(7, Math.min(300, firstBlank - 1));
      workbookXml = setSingleSheetPrintArea(
        workbookXml,
        prepared.targetIndex,
        "CLP",
        `$C$4:$J$${lastStudentRow}`
      );
      sheetXml = hideUnusedRowsByColumn(sheetXml, { column: "C", startRow: 8, endRow: 300 });
      sheetXml = setWorksheetFitToSinglePage(sheetXml, { paperSize: 9, orientation: "portrait" });
      sheetXml = setWorksheetMargins(sheetXml, { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3 });
      sheetXml = setWorksheetPrintCentering(sheetXml, { horizontal: true, vertical: false });
    }
    zip.file(targetWorksheetPath, sheetXml);
  } else if (targetSheetName === "GradeSheet") {
    workbookXml = setGradeSheetPrintArea(workbookXml, prepared.targetIndex, layoutMode);
  }

  zip.file("xl/workbook.xml", workbookXml);
  const exportFilter = targetSheetName === "Course Report"
    ? 'pdf:calc_pdf_Export:{"PageRange":{"type":"string","value":"1-2"}}'
    : "pdf:calc_pdf_Export";
  return { buffer: Buffer.from(await zip.generateAsync({ type: "nodebuffer" })), exportFilter };
}

async function convertPreparedBufferToPdf({ buffer, originalName, sheetName = "", layoutMode = "improved" }) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "course-file-office-"));
  try {
    const ext = path.extname(originalName || "") || ".bin";
    const safeBase = path.basename(originalName || `document${ext}`, ext).replace(/[^A-Za-z0-9._-]+/g, "_") || "document";
    const inputName = `${safeBase}${ext}`;
    const inputPath = path.join(workDir, inputName);
    const isolated = await isolateSpreadsheetSheet(buffer, originalName, sheetName, layoutMode);
    await fs.writeFile(inputPath, isolated.buffer);

    // Keep output separate from the input file. This is essential for PDF -> PDF
    // normalization because LibreOffice cannot export a PDF on top of the same
    // source path/name. It is also safer for Office conversions in general.
    const outputDir = path.join(workDir, "output");
    await fs.mkdir(outputDir, { recursive: true });

    const profileDir = path.join(workDir, "libreoffice-profile");
    await fs.mkdir(profileDir, { recursive: true });
    // Use a standards-compliant file URI on Windows (file:///C:/...) instead of
    // manually concatenating file:// with a drive-letter path. Some LibreOffice
    // builds reject the latter and exit with code 1 before conversion starts.
    const profileUri = pathToFileURL(profileDir).href;

    const exactArgs = [
      `-env:UserInstallation=${profileUri}`,
      "--headless",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--norestore",
      "--convert-to",
      isolated.exportFilter,
      "--outdir",
      outputDir,
      inputPath,
    ];
    // Compatibility retry: this is intentionally the same minimal invocation
    // that worked in the earlier Course File build. It avoids the temporary
    // profile flags on LibreOffice/Windows installations that do not accept them.
    const compatibilityArgs = [
      "--headless",
      "--convert-to",
      isolated.exportFilter,
      "--outdir",
      outputDir,
      inputPath,
    ];

    let result;
    let firstError = null;
    try {
      result = await runLibreOffice(exactArgs, { cwd: workDir });
    } catch (error) {
      firstError = error;
      // Remove a partial/stale PDF before retrying.
      const expectedPdf = path.join(outputDir, `${safeBase}.pdf`);
      await fs.rm(expectedPdf, { force: true }).catch(() => {});
      try {
        result = await runLibreOffice(compatibilityArgs, { cwd: workDir });
      } catch (retryError) {
        const stderr = String(retryError?.stderr || firstError?.stderr || "").trim();
        const stdout = String(retryError?.stdout || firstError?.stdout || "").trim();
        const detail = stderr || stdout;
        if (detail) retryError.message = `${retryError.message}\n${detail}`;
        throw retryError;
      }
    }

    const expected = path.join(outputDir, `${safeBase}.pdf`);
    let pdfPath = expected;
    try {
      await fs.access(pdfPath);
    } catch {
      const files = await fs.readdir(outputDir);
      const pdfName = files.find((name) => name.toLowerCase().endsWith(".pdf"));
      if (!pdfName) {
        const detail = String(result?.stderr || result?.stdout || "").trim();
        throw new Error(detail ? `LibreOffice did not produce a PDF file. ${detail}` : "LibreOffice did not produce a PDF file.");
      }
      pdfPath = path.join(outputDir, pdfName);
    }
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function convertOfficeBufferToPdf({ buffer, originalName, sheetName = "" }) {
  try {
    return await convertPreparedBufferToPdf({ buffer, originalName, sheetName, layoutMode: "improved" });
  } catch (error) {
    // GradeSheet layout tuning should never make the whole Course File feature unusable.
    // Retry with the previous stable print settings if improved pagination is not accepted
    // by the user's local LibreOffice version/workbook.
    if (sheetName === "GradeSheet" && error?.code !== "LIBREOFFICE_NOT_AVAILABLE") {
      console.warn("Improved GradeSheet conversion failed; retrying stable layout:", error?.message || error);
      return convertPreparedBufferToPdf({ buffer, originalName, sheetName, layoutMode: "stable" });
    }
    throw error;
  }
}

module.exports = { convertOfficeBufferToPdf };
