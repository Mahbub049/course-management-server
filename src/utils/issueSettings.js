const CATEGORY_KEYS = ["marks", "attendance", "general"];
const DEFAULT_CLOSED_MESSAGE = "Issue submission is currently closed by the course teacher.";

const clampTarget = (value, fallback = 50) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
};

const validDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function formatIssueSettings(courseOrSettings) {
  const settings = courseOrSettings?.complaintSettings || courseOrSettings || {};
  const originalMessage = String(settings.closedMessage || "").trim();
  const closedMessage = originalMessage === "Complaint submission is currently closed by the course teacher."
    ? DEFAULT_CLOSED_MESSAGE : originalMessage || DEFAULT_CLOSED_MESSAGE;
  const categories = {};
  for (const key of CATEGORY_KEYS) {
    const saved = settings.categories?.[key] || {};
    categories[key] = {
      enabled: saved.enabled !== false,
      startAt: validDate(saved.startAt),
      endAt: validDate(saved.endAt),
    };
  }
  return {
    allowStudentComplaints: settings.allowStudentComplaints !== false,
    closedMessage,
    categories,
    attendanceTargetPercentage: clampTarget(settings.attendanceTargetPercentage),
    updatedAt: settings.updatedAt || null,
  };
}

function sanitizeIssueSettings(raw = {}, existing = {}) {
  const current = formatIssueSettings(existing);
  const categories = {};
  for (const key of CATEGORY_KEYS) {
    const incoming = raw.categories?.[key];
    const previous = current.categories[key];
    categories[key] = {
      enabled: incoming?.enabled === undefined ? previous.enabled : incoming.enabled === true,
      startAt: incoming?.startAt === undefined ? previous.startAt : validDate(incoming.startAt),
      endAt: incoming?.endAt === undefined ? previous.endAt : validDate(incoming.endAt),
    };
    if (incoming?.startAt && !categories[key].startAt) {
      throw new Error(`Invalid ${key} opening time`);
    }
    if (incoming?.endAt && !categories[key].endAt) {
      throw new Error(`Invalid ${key} closing time`);
    }
    if (categories[key].startAt && categories[key].endAt &&
      categories[key].startAt >= categories[key].endAt) {
      throw new Error(`${key} closing time must be after opening time`);
    }
  }
  const target = raw.attendanceTargetPercentage === undefined
    ? current.attendanceTargetPercentage : Number(raw.attendanceTargetPercentage);
  if (!Number.isFinite(target) || target <= 0 || target > 100) {
    throw new Error("Attendance target must be greater than 0 and at most 100 percent");
  }
  return {
    allowStudentComplaints: raw.allowStudentComplaints === undefined
      ? current.allowStudentComplaints
      : raw.allowStudentComplaints !== false && raw.allowStudentComplaints !== "false",
    closedMessage: typeof raw.closedMessage === "string" && raw.closedMessage.trim()
      ? raw.closedMessage.trim() : current.closedMessage,
    categories,
    attendanceTargetPercentage: target,
    updatedAt: new Date(),
  };
}

function categoryAccess(settings, category, now = new Date()) {
  const configured = formatIssueSettings(settings);
  if (!configured.allowStudentComplaints) {
    return { allowed: false, message: configured.closedMessage };
  }
  const rule = configured.categories[category];
  if (!rule || !rule.enabled) {
    return { allowed: false, message: `${category[0].toUpperCase()}${category.slice(1)} issue submission is disabled for this course.` };
  }
  if (rule.startAt && now < new Date(rule.startAt)) {
    return { allowed: false, message: `Submissions for ${category} issues have not opened yet.` };
  }
  if (rule.endAt && now >= new Date(rule.endAt)) {
    return { allowed: false, message: `Submissions for ${category} issues have closed.` };
  }
  return { allowed: true, message: "" };
}

function requiredAttendanceSessions(present, total, target) {
  if (total <= 0) return 0;
  // >= target, with floating-point tolerance for percentages such as 66.67.
  return Math.max(0, Math.ceil((target / 100) * total - present - 1e-9));
}

module.exports = {
  CATEGORY_KEYS, formatIssueSettings, sanitizeIssueSettings, categoryAccess,
  requiredAttendanceSessions,
};
