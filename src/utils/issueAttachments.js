const { randomUUID } = require("crypto");
const path = require("path");
const {
  uploadCourseFileBuffer,
  deleteCourseFileObject,
  createCourseFileSignedUrl,
} = require("./courseFileStorage");

function safeName(name) {
  return path.basename(String(name || "attachment").replace(/[\\/]/g, "_")).slice(0, 180);
}

async function uploadIssueAttachments(files, studentId, courseId) {
  const uploaded = [];
  try {
    for (const file of files) {
      const name = safeName(file.originalname);
      const storagePath = `issues/${courseId}/${studentId}/${randomUUID()}${path.extname(name).toLowerCase()}`;
      await uploadCourseFileBuffer({
        storagePath, buffer: file.buffer,
        mimeType: file.mimetype || "application/octet-stream",
      });
      uploaded.push({ name, mimeType: file.mimetype || "application/octet-stream", size: file.size, storagePath });
    }
    return uploaded;
  } catch (err) {
    await Promise.allSettled(uploaded.map((file) => deleteCourseFileObject(file.storagePath)));
    throw err;
  }
}

async function cleanupAttachments(files) {
  await Promise.allSettled((files || []).map((file) => deleteCourseFileObject(file.storagePath)));
}

async function attachSignedIssueFiles(complaints) {
  return Promise.all(complaints.map(async (doc) => {
    const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
    const attachments = await Promise.all((plain.attachments || []).map(async (file) => {
      const { storagePath, ...publicData } = file;
      let url = "";
      if (storagePath) {
        try { url = await createCourseFileSignedUrl(storagePath, 60 * 20); }
        catch (err) { console.error("Issue attachment signing failed:", err.message); }
      }
      return { ...publicData, url };
    }));
    const { attendanceDedupKeys, attendanceDedupKey, ...safe } = plain;
    return { ...safe, attachments };
  }));
}

module.exports = { uploadIssueAttachments, cleanupAttachments, attachSignedIssueFiles };
