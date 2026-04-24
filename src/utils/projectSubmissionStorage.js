const path = require("path");
const supabase = require("../config/supabase");

const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "lab-submissions";

function sanitizeFileName(fileName = "file") {
  const ext = path.extname(fileName || "").toLowerCase();
  const base = path
    .basename(fileName || "file", ext)
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 80);

  return {
    ext,
    safeName: `${base || "file"}${ext}`,
  };
}

function buildProjectSubmissionStoragePath({
  courseId,
  phaseId,
  studentId,
  originalFileName,
}) {
  const { safeName } = sanitizeFileName(originalFileName);
  return `courses/${courseId}/project-phases/${phaseId}/students/${studentId}/${Date.now()}_${safeName}`;
}

async function uploadProjectSubmissionBuffer({ buffer, storagePath, mimeType }) {
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (error) throw error;
  return { bucketName, storagePath };
}

async function deleteProjectSubmissionObject(storagePath) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(bucketName).remove([storagePath]);
  if (error) throw error;
}

async function createProjectSubmissionSignedUrl(storagePath, expiresIn = 60 * 60) {
  if (!storagePath) return "";
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data?.signedUrl || "";
}

async function downloadProjectSubmissionObject(storagePath) {
  if (!storagePath) {
    return {
      buffer: null,
      mimeType: "",
    };
  }

  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(storagePath);

  if (error) throw error;

  const arrayBuffer = await data.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: data.type || "application/octet-stream",
  };
}

module.exports = {
  buildProjectSubmissionStoragePath,
  uploadProjectSubmissionBuffer,
  deleteProjectSubmissionObject,
  createProjectSubmissionSignedUrl,
  downloadProjectSubmissionObject,
  sanitizeFileName,
};