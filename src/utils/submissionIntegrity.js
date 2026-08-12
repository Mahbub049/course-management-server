const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');

const TEXT_EXTENSIONS = new Set([
  'txt','csv','json','md','xml','c','cpp','h','hpp','java','sql','py','js','jsx','ts','tsx','html','css','php','sh'
]);
const ZIP_OFFICE_EXTENSIONS = new Set(['xlsx', 'xlsm', 'docx', 'pptx']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getExtension(fileName = '') {
  return path.extname(String(fileName || '')).toLowerCase().replace(/^\./, '');
}

function normalizeText(text = '') {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trim())
    .filter((line, index, rows) => line || (index > 0 && rows[index - 1]))
    .join('\n')
    .trim();
}

function normalizeXml(xml = '') {
  return String(xml || '')
    .replace(/<dcterms:(created|modified)[^>]*>.*?<\/dcterms:\1>/gis, '')
    .replace(/<cp:lastModifiedBy>.*?<\/cp:lastModifiedBy>/gis, '')
    .replace(/\s+calcId="[^"]*"/gi, '')
    .replace(/\s+fullCalcOnLoad="[^"]*"/gi, '')
    .replace(/\s+forceFullCalc="[^"]*"/gi, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

function relevantOfficeEntry(ext, name) {
  const lower = String(name || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') {
    return (
      /^xl\/worksheets\/.*\.xml$/i.test(name) ||
      lower === 'xl/sharedstrings.xml' ||
      lower === 'xl/workbook.xml' ||
      lower === 'xl/vbaproject.bin'
    );
  }

  if (ext === 'docx') {
    return (
      lower === 'word/document.xml' ||
      /^word\/(header|footer)\d+\.xml$/i.test(name)
    );
  }

  if (ext === 'pptx') {
    return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
  }

  return false;
}

async function buildOfficeContentHash(buffer, ext) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files)
      .filter((entry) => !entry.dir && relevantOfficeEntry(ext, entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!entries.length) return '';

    const parts = [];
    for (const entry of entries) {
      if (/\.bin$/i.test(entry.name)) {
        const data = await entry.async('nodebuffer');
        parts.push(`${entry.name}\n${sha256(data)}`);
      } else {
        const xml = await entry.async('string');
        parts.push(`${entry.name}\n${normalizeXml(xml)}`);
      }
    }

    const normalized = parts.join('\n---ENTRY---\n');
    return normalized ? sha256(normalized) : '';
  } catch (err) {
    console.error('Office content fingerprint failed:', err.message);
    return '';
  }
}

async function buildSubmissionIntegrity(buffer, fileName = '') {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const ext = getExtension(fileName);
  const fileSha256 = sha256(safeBuffer);

  let contentSha256 = '';
  let contentFingerprintType = '';

  if (TEXT_EXTENSIONS.has(ext) && safeBuffer.length <= 25 * 1024 * 1024) {
    const text = safeBuffer.toString('utf8');
    // Avoid treating obviously binary content as text.
    if (!text.includes('\u0000')) {
      const normalized = normalizeText(text);
      if (normalized) {
        contentSha256 = sha256(normalized);
        contentFingerprintType = 'normalized-text';
      }
    }
  } else if (ZIP_OFFICE_EXTENSIONS.has(ext)) {
    contentSha256 = await buildOfficeContentHash(safeBuffer, ext);
    if (contentSha256) contentFingerprintType = 'office-content';
  }

  return {
    fileSha256,
    contentSha256,
    contentFingerprintType,
  };
}

module.exports = {
  buildSubmissionIntegrity,
};
