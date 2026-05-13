const express = require("express");
const router = express.Router();

const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");
const { getMyRoutine, saveMyRoutine } = require("../controllers/routineController");

router.use(authMiddleware, requireTeacher);

router.get("/my", getMyRoutine);
router.put("/my", saveMyRoutine);

module.exports = router;
