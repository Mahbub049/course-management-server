const path = require("path");
const supabase = require("../config/supabase");

const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "lab-submissions";

function sanitizeFileName(fileName = "file") {
  const ext = path.extname(fileName || "").toLowerCase();
  const base = path
    .basename(fileName || "file", ext)
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 100);
  return `${base || "file"}${ext}`;
}

function buildCourseFileStoragePath({ courseId, itemKey, originalFileName }) {
  const safe = sanitizeFileName(originalFileName);
  return `courses/${courseId}/course-file/${String(itemKey || "misc").replace(/[^a-zA-Z0-9-_]/g, "_")}/${Date.now()}_${safe}`;
}

async function uploadCourseFileBuffer({ buffer, storagePath, mimeType }) {
  const { error } = await supabase.storage.from(bucketName).upload(storagePath, buffer, {
    contentType: mimeType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { bucketName, storagePath };
}

async function deleteCourseFileObject(storagePath) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(bucketName).remove([storagePath]);
  if (error) throw error;
}

async function createCourseFileSignedUrl(storagePath, expiresIn = 60 * 60) {
  if (!storagePath) return "";
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl || "";
}

async function downloadCourseFileBuffer(storagePath) {
  const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  bucketName,
  buildCourseFileStoragePath,
  uploadCourseFileBuffer,
  deleteCourseFileObject,
  createCourseFileSignedUrl,
  downloadCourseFileBuffer,
};
