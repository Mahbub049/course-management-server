const express = require("express");
const router = express.Router();
const { authMiddleware, requireTeacher } = require("../middleware/authMiddleware");
const {
  getCalculationBootstrap,
  listDutyCalculations,
  getDutyCalculation,
  createDutyCalculation,
  updateDutyCalculation,
  updateReceivedStatus,
  updateCalculationSettings,
} = require("../controllers/calculationController");

router.use(authMiddleware, requireTeacher);

router.get("/bootstrap", getCalculationBootstrap);
router.get("/duties", listDutyCalculations);
router.get("/duties/:id", getDutyCalculation);
router.post("/duties", createDutyCalculation);
router.put("/duties/:id", updateDutyCalculation);
router.patch("/duties/:id/received", updateReceivedStatus);
router.put("/settings", updateCalculationSettings);

module.exports = router;
