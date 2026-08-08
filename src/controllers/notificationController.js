const UserNotificationPreference = require("../models/UserNotificationPreference");
const UserReminderState = require("../models/UserReminderState");
const { isFirebasePushConfigured, sendPushToUserIds } = require("../utils/firebasePushService");

const DEFAULT_CATEGORIES = {
  tasks: true,
  submissions: true,
  exams: true,
  events: true,
  academicCalendar: true,
};

function normalizeOffsets(value) {
  if (!Array.isArray(value)) return [1440, 180, 60];

  const offsets = [...new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= 10080)
  )]
    .sort((a, b) => b - a)
    .slice(0, 6);

  return offsets.length ? offsets : [1440, 180, 60];
}

function normalizeCategories(value = {}) {
  return Object.keys(DEFAULT_CATEGORIES).reduce((result, key) => {
    result[key] = typeof value[key] === "boolean" ? value[key] : DEFAULT_CATEGORIES[key];
    return result;
  }, {});
}

async function getOrCreatePreferences(userId) {
  let preferences = await UserNotificationPreference.findOne({ user: userId });

  if (!preferences) {
    preferences = await UserNotificationPreference.create({ user: userId });
  }

  return preferences;
}

exports.getNotificationProfile = async (req, res) => {
  try {
    const [preferences, states] = await Promise.all([
      getOrCreatePreferences(req.user.userId),
      UserReminderState.find({ user: req.user.userId })
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean(),
    ]);

    return res.json({
      success: true,
      preferences,
      states,
      serverPushEnabled: isFirebasePushConfigured(),
    });
  } catch (error) {
    console.error("Get notification profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load notification settings.",
      error: error.message,
    });
  }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const enabled = req.body?.enabled !== false;
    const categories = normalizeCategories(req.body?.categories || {});
    const reminderOffsetsMinutes = normalizeOffsets(req.body?.reminderOffsetsMinutes);
    const scheduleWindowDays = Math.min(
      30,
      Math.max(1, Number(req.body?.scheduleWindowDays) || 7)
    );

    const preferences = await UserNotificationPreference.findOneAndUpdate(
      { user: req.user.userId },
      {
        $set: {
          enabled,
          categories,
          reminderOffsetsMinutes,
          scheduleWindowDays,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.json({
      success: true,
      message: "Notification settings updated.",
      preferences,
    });
  } catch (error) {
    console.error("Update notification preferences error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update notification settings.",
      error: error.message,
    });
  }
};

exports.setReminderState = async (req, res) => {
  try {
    const sourceKey = String(req.body?.sourceKey || "").trim();
    const completed = Boolean(req.body?.completed);

    if (!sourceKey || sourceKey.length > 300) {
      return res.status(400).json({
        success: false,
        message: "A valid reminder source key is required.",
      });
    }

    const state = await UserReminderState.findOneAndUpdate(
      { user: req.user.userId, sourceKey },
      {
        $set: {
          completed,
          completedAt: completed ? new Date() : null,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.json({
      success: true,
      message: completed ? "Marked as done." : "Marked as not done.",
      state,
    });
  } catch (error) {
    console.error("Set reminder state error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update reminder state.",
      error: error.message,
    });
  }
};

exports.registerDeviceToken = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const platform = ["android", "ios", "web"].includes(req.body?.platform)
      ? req.body.platform
      : "unknown";

    if (!token || token.length > 4096) {
      return res.status(400).json({ success: false, message: "A valid device token is required." });
    }

    const preferences = await getOrCreatePreferences(req.user.userId);
    const existing = preferences.deviceTokens.find((item) => item.token === token);

    if (existing) {
      existing.platform = platform;
      existing.lastSeenAt = new Date();
    } else {
      preferences.deviceTokens.push({ token, platform, lastSeenAt: new Date() });
      if (preferences.deviceTokens.length > 12) {
        preferences.deviceTokens = preferences.deviceTokens
          .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
          .slice(0, 12);
      }
    }

    await preferences.save();

    return res.json({ success: true, message: "Device registered for notifications." });
  } catch (error) {
    console.error("Register notification device error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to register notification device.",
      error: error.message,
    });
  }
};

exports.unregisterDeviceToken = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({ success: false, message: "Device token is required." });
    }

    await UserNotificationPreference.updateOne(
      { user: req.user.userId },
      { $pull: { deviceTokens: { token } } }
    );

    return res.json({ success: true, message: "Device removed from notifications." });
  } catch (error) {
    console.error("Unregister notification device error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove notification device.",
      error: error.message,
    });
  }
};

exports.sendServerPushTest = async (req, res) => {
  try {
    if (!isFirebasePushConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Server push is not configured yet.",
      });
    }

    const result = await sendPushToUserIds([req.user.userId], {
      title: "BUBT Marks Portal",
      body: "Server push test successful. Web-created and shared calendar notifications can reach this phone.",
      tag: `server-push-test-${req.user.userId}`,
      data: {
        pushKind: "server-test",
        route: "/notifications",
      },
    });

    if (!result.targetCount) {
      return res.status(409).json({
        success: false,
        message: "No registered phone was found for this account. Open the Android app once and allow notifications, then try again.",
        result,
      });
    }

    return res.json({
      success: result.successCount > 0,
      message:
        result.successCount > 0
          ? "Server push test sent successfully."
          : "The server found the phone but FCM could not deliver the test.",
      result,
    });
  } catch (error) {
    console.error("Server push test error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server push test failed.",
    });
  }
};
