const multer = require("multer");
const path = require("path");

const MAX_FILES = 5;
const MAX_MB = 10;
const ALLOWED = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".zip", ".heic",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_MB * 1024 * 1024, fields: 12 },
  fileFilter(_req, file, next) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED.has(ext)) {
      return next(new Error(`Unsupported attachment type: ${ext || "unknown"}`));
    }
    next(null, true);
  },
}).array("attachments", MAX_FILES);

function issueAttachmentUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      message: err.code === "LIMIT_FILE_SIZE"
        ? `Each attachment must be ${MAX_MB} MB or smaller.` : err.message,
    });
  });
}

module.exports = { issueAttachmentUpload };
