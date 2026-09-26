const multer = require("multer");
const path = require("path");

const MAX_MB = Math.max(1, Number(process.env.COURSE_FILE_UPLOAD_LIMIT_MB || 30));
const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".com", ".msi", ".scr"]);

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error("Invalid file type. Please upload a document, spreadsheet, PDF, image, or archive."));
  }
  cb(null, true);
}

const courseFileUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 40 },
});

module.exports = { courseFileUpload, MAX_COURSE_FILE_UPLOAD_MB: MAX_MB };
