const express = require("express");
const router = express.Router();

const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");
const {
  createNotebookNote,
  deleteNotebookNote,
  getNotebookNoteById,
  getNotebookNotes,
  updateNotebookNote,
} = require("../controllers/notebookController");

router.use(authMiddleware, requireTeacher);

router.get("/", getNotebookNotes);
router.post("/", createNotebookNote);
router.get("/:noteId", getNotebookNoteById);
router.patch("/:noteId", updateNotebookNote);
router.delete("/:noteId", deleteNotebookNote);

module.exports = router;
