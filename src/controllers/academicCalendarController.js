const mongoose = require("mongoose");
const AcademicCalendar = require("../models/AcademicCalendar");
const FacultyCalendarEvent = require("../models/FacultyCalendarEvent");

const ALLOWED_EVENT_CATEGORIES = [
  "Holiday",
  "Exam",
  "Payment",
  "Registration",
  "Class",
  "Result",
  "Event",
  "Attendance",
  "Other",
];

const ALLOWED_SUMMARY_TYPES = ["Exam", "Payment", "Class", "Other"];

function detectCategory(text = "") {
  const lower = String(text || "").toLowerCase();

  if (/(attendance|student attendance report)/i.test(lower)) return "Attendance";
  if (/(holiday|eid|ashura|janmashtami|miladunnabi|closed|semester break)/i.test(lower)) return "Holiday";
  if (/(exam|examination|midterm|final|supplementary|preparatory leave)/i.test(lower)) return "Exam";
  if (/(payment|tuition|installment|fee|dues|balance)/i.test(lower)) return "Payment";
  if (/(registration|pre-registration|add\/drop|withdrawal)/i.test(lower)) return "Registration";
  if (/(class|classes|orientation|commencement)/i.test(lower)) return "Class";
  if (/(result|grade|publication)/i.test(lower)) return "Result";
  if (/(parents day|census day|research showcase|club|evaluation|award|r u ok)/i.test(lower)) return "Event";

  return "Other";
}

function safeCategory(category, title = "") {
  const value = String(category || "").trim();
  return ALLOWED_EVENT_CATEGORIES.includes(value) ? value : detectCategory(title);
}

function safeSummaryType(type) {
  const value = String(type || "").trim();
  return ALLOWED_SUMMARY_TYPES.includes(value) ? value : "Other";
}

exports.getLatestAcademicCalendar = async (req, res) => {
  try {
    const calendar = await AcademicCalendar.findOne({ published: true }).sort({
      updatedAt: -1,
    });

    return res.json({ success: true, calendar });
  } catch (error) {
    console.error("Get academic calendar error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load academic calendar.",
      error: error.message,
    });
  }
};

exports.saveAcademicCalendar = async (req, res) => {
  try {
    const {
      title,
      semester,
      academicYear,
      sourceFileName,
      events = [],
      summaries = [],
      published = true,
    } = req.body;

    if (!Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        message: "Events must be an array.",
      });
    }

    const cleanedEvents = events
      .map((event, index) => {
        const eventTitle = String(event?.title || "").trim();

        return {
          dateText: String(event?.dateText || "").trim(),
          dayText: String(event?.dayText || "").trim(),
          category: safeCategory(event?.category, eventTitle),
          title: eventTitle,
          note: String(event?.note || "").trim(),
          isHighlighted: Boolean(event?.isHighlighted),
          sortOrder: Number(event?.sortOrder ?? index),
        };
      })
      .filter((event) => event.dateText && event.title);

    const cleanedSummaries = Array.isArray(summaries)
      ? summaries
          .map((item) => ({
            type: safeSummaryType(item?.type),
            title: String(item?.title || "").trim(),
            dateText: String(item?.dateText || "").trim(),
          }))
          .filter((item) => item.title || item.dateText)
      : [];

    if (cleanedEvents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid calendar event is required.",
      });
    }

    const calendar = await AcademicCalendar.findOneAndUpdate(
      { published: true },
      {
        title: title || "Academic Calendar",
        semester: semester || "",
        academicYear: academicYear || "",
        sourceFileName: sourceFileName || "",
        events: cleanedEvents,
        summaries: cleanedSummaries,
        published,
        updatedBy: req.user?.userId || null,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    return res.json({
      success: true,
      message: "Academic calendar saved successfully.",
      calendar,
    });
  } catch (error) {
    console.error("Save academic calendar error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to save academic calendar.",
      error: error.message,
    });
  }
};

exports.detectAcademicCalendarCategory = async (req, res) => {
  try {
    const { title = "" } = req.body;
    return res.json({ success: true, category: detectCategory(title) });
  } catch (error) {
    console.error("Detect academic calendar category error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to detect category.",
      error: error.message,
    });
  }
};

const CURRENT_FACULTY_EVENT_TYPES = ["Task", "Exam", "Event"];
const ALLOWED_VISIBILITY = ["personal", "university"];
const TIME_PATTERN = /^$|^([01]\d|2[0-3]):[0-5]\d$/;

function safeFacultyEventType(type) {
  const value = String(type || "").trim();
  if (CURRENT_FACULTY_EVENT_TYPES.includes(value)) return value;

  if (["Class", "Meeting", "Holiday"].includes(value)) return "Event";
  return "Task";
}

function safeVisibility(value) {
  const visibility = String(value || "").trim();
  return ALLOWED_VISIBILITY.includes(visibility) ? visibility : "personal";
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDateOnly(value) {
  const date = parseDateOnly(value);
  if (!date) return null;
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function cleanTime(value) {
  const time = String(value || "").trim();
  return TIME_PATTERN.test(time) ? time : "";
}

function cleanFacultyEventPayload(body = {}) {
  const date = parseDateOnly(body.date);
  const endDate = parseDateOnly(body.endDate) || date;

  return {
    title: String(body.title || "").trim(),
    type: safeFacultyEventType(body.type),
    date,
    endDate,
    startTime: cleanTime(body.startTime),
    endTime: cleanTime(body.endTime),
    details: String(body.details || "").trim(),
    visibility: safeVisibility(body.visibility),
    priority: "Normal",
    completed: false,
  };
}

function validateFacultyEventPayload(payload) {
  if (!payload.title) return "Event title is required.";
  if (!payload.date || !payload.endDate) return "A valid start and end date are required.";
  if (payload.endDate < payload.date) return "The end date cannot be before the start date.";
  if (
    payload.date.getTime() === payload.endDate.getTime() &&
    payload.startTime &&
    payload.endTime &&
    payload.endTime < payload.startTime
  ) {
    return "The end time cannot be before the start time.";
  }
  return "";
}

function eventResponse(event, userId) {
  const plain = typeof event.toObject === "function" ? event.toObject() : event;
  const facultyId = plain.faculty?._id || plain.faculty;

  return {
    ...plain,
    creatorName: plain.faculty?.name || "",
    creatorShortCode: plain.faculty?.shortCode || "",
    canEdit: String(facultyId) === String(userId),
  };
}

exports.getFacultyCalendarEvents = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = parseDateOnly(startDate);
    const end = endOfDateOnly(endDate);

    const filters = [
      {
        $or: [
          { faculty: req.user.userId },
          { visibility: "university" },
        ],
      },
    ];

    // Return items that overlap the requested date range, including multi-day events.
    if (end) filters.push({ date: { $lte: end } });
    if (start) {
      filters.push({
        $or: [
          { endDate: { $gte: start } },
          { endDate: null, date: { $gte: start } },
          { endDate: { $exists: false }, date: { $gte: start } },
        ],
      });
    }

    const events = await FacultyCalendarEvent.find({ $and: filters })
      .populate("faculty", "name shortCode")
      .sort({ date: 1, sortOrder: 1, createdAt: -1, startTime: 1 });

    return res.json({
      success: true,
      events: events.map((event) => eventResponse(event, req.user.userId)),
    });
  } catch (error) {
    console.error("Get faculty calendar events error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load calendar events.",
      error: error.message,
    });
  }
};

exports.createFacultyCalendarEvent = async (req, res) => {
  try {
    const payload = cleanFacultyEventPayload(req.body);
    const validationMessage = validateFacultyEventPayload(payload);

    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    const created = await FacultyCalendarEvent.create({
      ...payload,
      faculty: req.user.userId,
      // New teacher-created items are placed before older and official items.
      sortOrder: -Date.now(),
    });

    const event = await FacultyCalendarEvent.findById(created._id).populate(
      "faculty",
      "name shortCode"
    );


    return res.status(201).json({
      success: true,
      message:
        payload.visibility === "university"
          ? "University calendar item created successfully."
          : "Calendar item created successfully.",
      event: eventResponse(event, req.user.userId),
    });
  } catch (error) {
    console.error("Create faculty calendar event error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create calendar item.",
      error: error.message,
    });
  }
};

exports.updateFacultyCalendarEvent = async (req, res) => {
  try {
    const payload = cleanFacultyEventPayload(req.body);
    const validationMessage = validateFacultyEventPayload(payload);

    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    const existing = await FacultyCalendarEvent.findOne({
      _id: req.params.eventId,
      faculty: req.user.userId,
    }).lean();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Calendar item not found or you do not have permission to edit it.",
      });
    }

    const updated = await FacultyCalendarEvent.findOneAndUpdate(
      {
        _id: req.params.eventId,
        faculty: req.user.userId,
      },
      payload,
      { new: true, runValidators: true }
    ).populate("faculty", "name shortCode");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Calendar item not found or you do not have permission to edit it.",
      });
    }


    return res.json({
      success: true,
      message: "Calendar item updated successfully.",
      event: eventResponse(updated, req.user.userId),
    });
  } catch (error) {
    console.error("Update faculty calendar event error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update calendar item.",
      error: error.message,
    });
  }
};

exports.reorderFacultyCalendarEvents = async (req, res) => {
  try {
    const orderedEventIds = Array.isArray(req.body?.orderedEventIds)
      ? [...new Set(req.body.orderedEventIds.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];

    if (
      orderedEventIds.length < 2 ||
      orderedEventIds.length > 200 ||
      orderedEventIds.some((eventId) => !mongoose.Types.ObjectId.isValid(eventId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide between 2 and 200 valid calendar item IDs to reorder.",
      });
    }

    const ownedEvents = await FacultyCalendarEvent.find({
      _id: { $in: orderedEventIds },
      faculty: req.user.userId,
    }).select("_id");

    if (ownedEvents.length !== orderedEventIds.length) {
      return res.status(403).json({
        success: false,
        message: "You can reorder only calendar items created by you.",
      });
    }

    await FacultyCalendarEvent.bulkWrite(
      orderedEventIds.map((eventId, index) => ({
        updateOne: {
          filter: { _id: eventId, faculty: req.user.userId },
          update: { $set: { sortOrder: index } },
        },
      }))
    );

    return res.json({
      success: true,
      message: "Calendar order updated successfully.",
    });
  } catch (error) {
    console.error("Reorder faculty calendar events error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to reorder calendar items.",
      error: error.message,
    });
  }
};

exports.deleteFacultyCalendarEvent = async (req, res) => {
  try {
    const event = await FacultyCalendarEvent.findOneAndDelete({
      _id: req.params.eventId,
      faculty: req.user.userId,
    }).populate("faculty", "name shortCode");

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar item not found or you do not have permission to delete it.",
      });
    }


    return res.json({
      success: true,
      message: "Calendar item deleted successfully.",
    });
  } catch (error) {
    console.error("Delete faculty calendar event error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete calendar item.",
      error: error.message,
    });
  }
};
