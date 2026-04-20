const multer = require('multer');
const path = require('path');

const allowedExts = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.zip',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
]);

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (!allowedExts.has(ext)) {
    return cb(
      new Error(
        'Only pdf, doc, docx, zip, xls, xlsx, ppt, pptx and txt files are allowed.'
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