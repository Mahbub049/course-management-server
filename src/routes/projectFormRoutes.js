const express = require("express");
const router = express.Router();

const {
  getProjectFormConfig,
  updateProjectFormConfig,
} = require("../controllers/projectFormController");

const { teacherOnly } = require("../middleware/authMiddleware");

router.get("/:courseId", ...teacherOnly, getProjectFormConfig);
router.put("/:courseId", ...teacherOnly, updateProjectFormConfig);

module.exports = router;