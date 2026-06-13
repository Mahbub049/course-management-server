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

  if (ALLOWED_EVENT_CATEGORIES.includes(value)) {
    return value;
  }

  return detectCategory(title);
}

function safeSummaryType(type) {
  const value = String(type || "").trim();

  if (ALLOWED_SUMMARY_TYPES.includes(value)) {
    return value;
  }

  return "Other";
}

exports.getLatestAcademicCalendar = async (req, res) => {
  try {
    const calendar = await AcademicCalendar.findOne({ published: true }).sort({
      updatedAt: -1,
    });

    return res.json({
      success: true,
      calendar,
    });
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

    return res.json({
      success: true,
      category: detectCategory(title),
    });
  } catch (error) {
    console.error("Detect academic calendar category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to detect category.",
      error: error.message,
    });
  }
};

const ALLOWED_FACULTY_EVENT_TYPES = [
  "Class",
  "Exam",
  "Meeting",
  "Task",
  "Reminder",
  "Deadline",
  "Payment",
  "Registration",
  "Holiday",
  "Event",
  "Other",
];

const ALLOWED_PRIORITIES = ["Low", "Normal", "High"];

function safeFacultyEventType(type) {
  const value = String(type || "").trim();
  return ALLOWED_FACULTY_EVENT_TYPES.includes(value) ? value : "Task";
}

function safePriority(priority) {
  const value = String(priority || "").trim();
  return ALLOWED_PRIORITIES.includes(value) ? value : "Normal";
}

function parseDateOnly(value) {
  const text = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function endOfDateOnly(value) {
  const date = parseDateOnly(value);

  if (!date) return null;

  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function cleanFacultyEventPayload(body = {}) {
  const title = String(body.title || "").trim();
  const date = parseDateOnly(body.date);

  return {
    title,
    type: safeFacultyEventType(body.type),
    date,
    startTime: String(body.startTime || "").trim(),
    endTime: String(body.endTime || "").trim(),
    details: String(body.details || "").trim(),
    priority: safePriority(body.priority),
    completed: Boolean(body.completed),
  };
}

exports.getFacultyCalendarEvents = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const query = {
      faculty: req.user.userId,
    };

    const start = parseDateOnly(startDate);
    const end = endOfDateOnly(endDate);

    if (start || end) {
      query.date = {};
      if (start) query.date.$gte = start;
      if (end) query.date.$lte = end;
    }

    const events = await FacultyCalendarEvent.find(query).sort({
      date: 1,
      startTime: 1,
      createdAt: 1,
    });

    return res.json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("Get faculty calendar events error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your calendar events.",
      error: error.message,
    });
  }
};

exports.createFacultyCalendarEvent = async (req, res) => {
  try {
    const payload = cleanFacultyEventPayload(req.body);

    if (!payload.title) {
      return res.status(400).json({
        success: false,
        message: "Event title is required.",
      });
    }

    if (!payload.date) {
      return res.status(400).json({
        success: false,
        message: "A valid event date is required.",
      });
    }

    const event = await FacultyCalendarEvent.create({
      ...payload,
      faculty: req.user.userId,
    });

    return res.status(201).json({
      success: true,
      message: "Calendar item created successfully.",
      event,
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

    if (!payload.title) {
      return res.status(400).json({
        success: false,
        message: "Event title is required.",
      });
    }

    if (!payload.date) {
      return res.status(400).json({
        success: false,
        message: "A valid event date is required.",
      });
    }

    const event = await FacultyCalendarEvent.findOneAndUpdate(
      {
        _id: req.params.eventId,
        faculty: req.user.userId,
      },
      payload,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar item not found.",
      });
    }

    return res.json({
      success: true,
      message: "Calendar item updated successfully.",
      event,
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

exports.deleteFacultyCalendarEvent = async (req, res) => {
  try {
    const event = await FacultyCalendarEvent.findOneAndDelete({
      _id: req.params.eventId,
      faculty: req.user.userId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar item not found.",
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
