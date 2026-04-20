const path = require('path');
const supabase = require('../config/supabase');

const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'lab-submissions';

function sanitizeFileName(fileName = 'file') {
  const ext = path.extname(fileName || '').toLowerCase();
  const base = path
    .basename(fileName || 'file', ext)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 80);

  return {
    ext,
    safeName: `${base || 'file'}${ext}`,
  };
}

function buildSubmissionStoragePath({
  courseId,
  assessmentId,
  studentId,
  originalFileName,
}) {
  const { safeName } = sanitizeFileName(originalFileName);
  const uniqueName = `${Date.now()}_${safeName}`;

  return `courses/${courseId}/assessments/${assessmentId}/students/${studentId}/${uniqueName}`;
}

async function uploadSubmissionBuffer({
  buffer,
  storagePath,
  mimeType,
}) {
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return {
    bucketName,
    storagePath,
  };
}

async function deleteSubmissionObject(storagePath) {
  if (!storagePath) return;

  const { error } = await supabase.storage
    .from(bucketName)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}

async function createSubmissionSignedUrl(storagePath, expiresIn = 60 * 60) {
  if (!storagePath) return '';

  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    throw error;
  }

  return data?.signedUrl || '';
}

async function downloadSubmissionBuffer(storagePath) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(storagePath);

  if (error) {
    throw error;
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  bucketName,
  buildSubmissionStoragePath,
  uploadSubmissionBuffer,
  deleteSubmissionObject,
  createSubmissionSignedUrl,
  downloadSubmissionBuffer,
};