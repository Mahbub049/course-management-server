const FacultyCalendarEvent = require("../models/FacultyCalendarEvent");
const FacultyEventPushDelivery = require("../models/FacultyEventPushDelivery");
const User = require("../models/User");
const UserNotificationPreference = require("../models/UserNotificationPreference");
const {
  isFirebasePushConfigured,
  sendPushToPreferences,
  sendPushToUserIds,
} = require("./firebasePushService");

const BD_UTC_OFFSET_HOURS = 6;
const MAX_REMINDER_OFFSET_MINUTES = 10080; // 7 days
const REMINDER_GRACE_MS = 5 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 30 * 1000;

let schedulerTimer = null;
let schedulerRunning = false;

function categoryForFacultyType(type = "") {
  if (type === "Exam") return "exams";
  if (type === "Task") return "tasks";
  return "events";
}

function dueDateForEvent(event) {
  const date = new Date(event?.date);
  if (Number.isNaN(date.getTime())) return null;

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(event?.startTime || ""));
  const hour = timeMatch ? Number(timeMatch[1]) : 8;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour - BD_UTC_OFFSET_HOURS,
      minute,
      0,
      0
    )
  );
}

function formatDhakaClock(event) {
  const value = String(event?.startTime || "");
  if (!/^\d{2}:\d{2}$/.test(value)) return "8:00 AM";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatDhakaDate(event) {
  const date = new Date(event?.date);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function reminderLabel(offsetMinutes) {
  if (offsetMinutes === 1440) return "tomorrow";
  if (offsetMinutes % 1440 === 0) {
    const days = offsetMinutes / 1440;
    return `in ${days} days`;
  }
  if (offsetMinutes % 60 === 0) {
    const hours = offsetMinutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${offsetMinutes} minutes`;
}

async function teacherIdsForEvent(event, { previousVisibility = "" } = {}) {
  const shouldBroadcast =
    event?.visibility === "university" || previousVisibility === "university";

  if (!shouldBroadcast) return [String(event.faculty?._id || event.faculty)];

  const teachers = await User.find({ role: "teacher" }).select("_id").lean();
  return teachers.map((teacher) => String(teacher._id));
}

function eventPushData(event, extra = {}) {
  return {
    pushKind: extra.pushKind || "calendar-change",
    route: "/academic-calendar",
    eventId: String(event._id),
    sourceKey: `faculty:${event._id}`,
    eventType: String(event.type || "Event"),
    visibility: String(event.visibility || "personal"),
    eventDate: formatDhakaDate(event),
    startTime: String(event.startTime || ""),
    canMarkDone: String(event.type === "Task"),
    ...extra,
  };
}

async function notifyFacultyEventChange(event, action, options = {}) {
  if (!event || !isFirebasePushConfigured()) return { configured: false };

  const userIds = await teacherIdsForEvent(event, options);
  const creator = event.faculty?.name || "A teacher";
  const isShared = event.visibility === "university";
  const category = categoryForFacultyType(event.type);

  let title = event.title || "Calendar item";
  let body = "Calendar item updated.";

  if (action === "created") {
    title = isShared ? `New shared ${String(event.type || "event").toLowerCase()}` : "New calendar item";
    body = `${event.title} · ${formatDhakaDate(event)} · ${formatDhakaClock(event)}`;
    if (isShared) body += ` · by ${creator}`;
  } else if (action === "updated") {
    title = isShared ? "Shared calendar item updated" : "Calendar item updated";
    body = `${event.title} · ${formatDhakaDate(event)} · ${formatDhakaClock(event)}`;
  } else if (action === "deleted") {
    title = isShared || options.previousVisibility === "university"
      ? "Shared calendar item removed"
      : "Calendar item removed";
    body = event.title || "A calendar item was removed.";
  }

  return sendPushToUserIds(userIds, {
    category,
    title,
    body,
    tag: `faculty-event-${event._id}`,
    data: eventPushData(event, {
      pushKind: `calendar-${action}`,
      action,
    }),
  });
}

async function reserveDelivery(deliveryKey, event, userId, offsetMinutes, eventVersion) {
  try {
    return await FacultyEventPushDelivery.create({
      deliveryKey,
      event: event._id,
      user: userId,
      offsetMinutes,
      eventVersion,
      status: "pending",
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function processFacultyCalendarReminders() {
  if (schedulerRunning || !isFirebasePushConfigured()) return;
  schedulerRunning = true;

  try {
    const now = new Date();
    const todayDhaka = new Date(now.getTime() + BD_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    const start = new Date(Date.UTC(
      todayDhaka.getUTCFullYear(),
      todayDhaka.getUTCMonth(),
      todayDhaka.getUTCDate() - 1,
      0,
      0,
      0,
      0
    ));
    const end = new Date(start.getTime() + 9 * 24 * 60 * 60 * 1000);

    const events = await FacultyCalendarEvent.find({
      date: { $gte: start, $lte: end },
    })
      .populate("faculty", "name shortCode")
      .lean();

    if (!events.length) return;

    const allTeacherIds = await User.find({ role: "teacher" }).select("_id").lean();
    const teacherIds = allTeacherIds.map((teacher) => String(teacher._id));

    for (const event of events) {
      const dueAt = dueDateForEvent(event);
      if (!dueAt) continue;

      const recipientIds =
        event.visibility === "university"
          ? teacherIds
          : [String(event.faculty?._id || event.faculty)];

      const preferences = await UserNotificationPreference.find({
        user: { $in: recipientIds },
        enabled: { $ne: false },
        "deviceTokens.0": { $exists: true },
      }).lean();

      const category = categoryForFacultyType(event.type);
      const eventVersion = new Date(event.updatedAt || event.createdAt || 0).toISOString();

      for (const preference of preferences) {
        if (preference.categories?.[category] === false) continue;

        const offsets = Array.isArray(preference.reminderOffsetsMinutes)
          ? preference.reminderOffsetsMinutes
          : [1440, 180, 60];

        for (const rawOffset of offsets) {
          const offsetMinutes = Number(rawOffset);
          if (
            !Number.isInteger(offsetMinutes) ||
            offsetMinutes < 1 ||
            offsetMinutes > MAX_REMINDER_OFFSET_MINUTES
          ) {
            continue;
          }

          const triggerAt = new Date(dueAt.getTime() - offsetMinutes * 60 * 1000);
          const lateness = now.getTime() - triggerAt.getTime();
          if (lateness < 0 || lateness > REMINDER_GRACE_MS) continue;

          const userId = String(preference.user);
          const deliveryKey = `${event._id}:${userId}:${offsetMinutes}:${eventVersion}`;
          const delivery = await reserveDelivery(
            deliveryKey,
            event,
            userId,
            offsetMinutes,
            eventVersion
          );
          if (!delivery) continue;

          try {
            const result = await sendPushToPreferences([preference], {
              category,
              title: `${event.title} ${reminderLabel(offsetMinutes)}`,
              body: `${event.type || "Event"} · ${formatDhakaDate(event)} · ${formatDhakaClock(event)}`,
              tag: `faculty-reminder-${event._id}-${offsetMinutes}`,
              data: eventPushData(event, {
                pushKind: "calendar-reminder",
                reminderOffsetMinutes: String(offsetMinutes),
              }),
            });

            delivery.status = result.successCount > 0 ? "sent" : "no-device";
            delivery.sentAt = result.successCount > 0 ? new Date() : null;
            delivery.error = result.failureCount > 0 ? `${result.failureCount} FCM delivery failure(s)` : "";
            await delivery.save();
          } catch (error) {
            delivery.status = "failed";
            delivery.error = String(error?.message || error).slice(0, 1000);
            await delivery.save();
            console.error("Faculty calendar reminder push failed:", error);
          }
        }
      }
    }
  } catch (error) {
    console.error("Faculty calendar push scheduler error:", error);
  } finally {
    schedulerRunning = false;
  }
}

function startFacultyCalendarPushScheduler() {
  if (schedulerTimer) return schedulerTimer;

  if (!isFirebasePushConfigured()) {
    console.warn("Faculty calendar push scheduler is disabled until Firebase Admin env vars are configured.");
    return null;
  }

  const run = () => processFacultyCalendarReminders().catch((error) => {
    console.error("Faculty calendar push scheduler run failed:", error);
  });

  setTimeout(run, 5000);
  schedulerTimer = setInterval(run, SCHEDULER_INTERVAL_MS);
  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();
  console.log("Faculty calendar FCM reminder scheduler started.");
  return schedulerTimer;
}

module.exports = {
  categoryForFacultyType,
  notifyFacultyEventChange,
  processFacultyCalendarReminders,
  startFacultyCalendarPushScheduler,
};
