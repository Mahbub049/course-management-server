const multer = require('multer');
const path = require('path');

const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9_+-]{0,15}$/i;
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
]);

const storage = multer.memoryStorage();
const MAX_SUBMISSION_UPLOAD_MB = Math.max(
  1,
  Number(process.env.LAB_SUBMISSION_UPLOAD_LIMIT_MB || 50)
);

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (!SAFE_EXTENSION_PATTERN.test(ext) || BLOCKED_EXTENSIONS.has(ext)) {
    return cb(
      new Error(
        'Invalid file type. Please upload a file type allowed by the teacher.'
      )
    );
  }

  cb(null, true);
}

const uploadLabSubmission = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SUBMISSION_UPLOAD_MB * 1024 * 1024,
  },
});

module.exports = { uploadLabSubmission, MAX_SUBMISSION_UPLOAD_MB };