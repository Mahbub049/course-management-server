const express = require("express");
const router = express.Router();

const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");
const {
  createNotebookNote,
  deleteNotebookNote,
  getNotebookNoteById,
  getNotebookNotes,
  updateNotebookNote,
  refreshNotebookStudents,
  getNotebookMarkSync,
  saveNotebookMarkSync,
  syncNotebookMarks,
} = require("../controllers/notebookController");

router.use(authMiddleware, requireTeacher);

router.get("/", getNotebookNotes);
router.post("/", createNotebookNote);
router.get("/:noteId/mark-sync", getNotebookMarkSync);
router.put("/:noteId/mark-sync", saveNotebookMarkSync);
router.post("/:noteId/sync-marks", syncNotebookMarks);
router.get("/:noteId", getNotebookNoteById);
router.post("/:noteId/refresh-students", refreshNotebookStudents);
router.patch("/:noteId", updateNotebookNote);
router.delete("/:noteId", deleteNotebookNote);

module.exports = router;
