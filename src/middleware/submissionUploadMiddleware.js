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
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = { uploadLabSubmission };