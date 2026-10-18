const CATEGORY_KEYS = ["marks", "attendance", "general"];
const OVERRIDE_MODES = ["allow_only", "enable_selected", "disable_selected", "all_on", "all_off"];
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

function normalizeOverride(raw, { strict = false } = {}) {
  if (!raw) return null;
  if (!OVERRIDE_MODES.includes(raw.mode)) {
    if (!strict) return null;
    throw new Error("Choose a valid temporary access mode");
  }
  if (strict && (!Array.isArray(raw.categories) || raw.categories.some((cat) => !CATEGORY_KEYS.includes(cat)))) {
    throw new Error("Choose valid categories for the temporary rule");
  }
  const categories = [...new Set((raw.categories || []).filter((cat) => CATEGORY_KEYS.includes(cat)))];
  if (strict && ["allow_only", "enable_selected", "disable_selected"].includes(raw.mode) && categories.length === 0) {
    throw new Error("Select at least one category for this temporary rule");
  }
  const startAt = validDate(raw.startAt);
  const endAt = validDate(raw.endAt);
  if (strict && raw.startAt && !startAt) throw new Error("Invalid temporary opening time");
  if (!endAt || (strict && raw.endAt == null)) {
    if (!strict) return null;
    throw new Error("Choose when the temporary rule will end");
  }
  const now = Date.now();
  if (strict && Date.parse(endAt) <= now) throw new Error("Temporary end time must be in the future");
  if (startAt && startAt >= endAt) throw new Error("Temporary end time must be after its start");
  return { mode: raw.mode, categories, startAt, endAt };
}

function getActiveOverride(settings, now = new Date()) {
  const rule = normalizeOverride(settings?.temporaryOverride);
  if (!rule) return null;
  const timestamp = new Date(now).getTime();
  if (timestamp >= Date.parse(rule.endAt)) return null;
  return { ...rule, state: rule.startAt && timestamp < Date.parse(rule.startAt) ? "scheduled" : "active" };
}

function formatIssueSettings(courseOrSettings, now = new Date()) {
  const settings = courseOrSettings?.complaintSettings || courseOrSettings || {};
  const originalMessage = String(settings.closedMessage || "").trim();
  const closedMessage = originalMessage === "Complaint submission is currently closed by the course teacher."
    ? DEFAULT_CLOSED_MESSAGE : originalMessage || DEFAULT_CLOSED_MESSAGE;
  const categories = {};
  for (const key of CATEGORY_KEYS) {
    const saved = settings.categories?.[key] || {};
    categories[key] = {
      enabled: saved.enabled !== false,
      // Legacy category windows stay valid until the teacher changes the rule.
      // Expired legacy windows release their restriction rather than locking forever.
      startAt: validDate(saved.startAt),
      endAt: validDate(saved.endAt),
    };
  }
  return {
    allowStudentComplaints: settings.allowStudentComplaints !== false,
    closedMessage, categories,
    attendanceTargetPercentage: clampTarget(settings.attendanceTargetPercentage),
    temporaryOverride: getActiveOverride(settings, now),
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
    if (incoming?.startAt && !categories[key].startAt) throw new Error(`Invalid ${key} opening time`);
    if (incoming?.endAt && !categories[key].endAt) throw new Error(`Invalid ${key} closing time`);
    if (categories[key].startAt && categories[key].endAt && categories[key].startAt >= categories[key].endAt) {
      throw new Error(`${key} closing time must be after opening time`);
    }
  }
  const target = raw.attendanceTargetPercentage === undefined
    ? current.attendanceTargetPercentage : Number(raw.attendanceTargetPercentage);
  if (!Number.isFinite(target) || target <= 0 || target > 100) {
    throw new Error("Attendance target must be greater than 0 and at most 100 percent");
  }
  const temporaryOverride = Object.prototype.hasOwnProperty.call(raw, "temporaryOverride")
    ? normalizeOverride(raw.temporaryOverride, { strict: raw.temporaryOverride !== null })
    : current.temporaryOverride;
  return {
    allowStudentComplaints: raw.allowStudentComplaints === undefined ? current.allowStudentComplaints
      : raw.allowStudentComplaints !== false && raw.allowStudentComplaints !== "false",
    closedMessage: typeof raw.closedMessage === "string" && raw.closedMessage.trim()
      ? raw.closedMessage.trim() : current.closedMessage,
    categories, attendanceTargetPercentage: target, temporaryOverride,
    updatedAt: new Date(),
  };
}

function categoryAccess(settings, category, now = new Date()) {
  const configured = formatIssueSettings(settings, now);
  const temp = configured.temporaryOverride;
  if (temp?.state === "active") {
    const selected = temp.categories.includes(category);
    if (temp.mode === "all_off") return { allowed: false, message: configured.closedMessage };
    if (temp.mode === "all_on") return { allowed: true, message: "" };
    if (temp.mode === "allow_only") return selected
      ? { allowed: true, message: "" }
      : { allowed: false, message: `${category} issues are temporarily unavailable.` };
    if (temp.mode === "enable_selected" && selected) return { allowed: true, message: "" };
    if (temp.mode === "disable_selected" && selected) return { allowed: false, message: `${category} issues are temporarily unavailable.` };
  }
  if (!configured.allowStudentComplaints) return { allowed: false, message: configured.closedMessage };
  const rule = configured.categories[category];
  if (!rule || !rule.enabled) return { allowed: false, message: `${category} issue submission is disabled for this course.` };
  // Legacy timed windows apply only while they are pending or active.
  if (rule.endAt && new Date(now) >= new Date(rule.endAt)) return { allowed: true, message: "" };
  if (rule.startAt && new Date(now) < new Date(rule.startAt)) return { allowed: false, message: `Submissions for ${category} issues have not opened yet.` };
  return { allowed: true, message: "" };
}

function requiredAttendanceSessions(present, total, target) {
  if (total <= 0) return 0;
  return Math.max(0, Math.ceil((target / 100) * total - present - 1e-9));
}

module.exports = { CATEGORY_KEYS, OVERRIDE_MODES, formatIssueSettings, sanitizeIssueSettings,
  categoryAccess, requiredAttendanceSessions, normalizeOverride };
