const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  getNotificationProfile,
  updateNotificationPreferences,
  setReminderState,
  registerDeviceToken,
  unregisterDeviceToken,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(authMiddleware);
router.get("/profile", getNotificationProfile);
router.put("/preferences", updateNotificationPreferences);
router.put("/state", setReminderState);
router.post("/device-token", registerDeviceToken);
router.delete("/device-token", unregisterDeviceToken);

module.exports = router;
