const mongoose = require("mongoose");
const NotebookNote = require("../models/NotebookNote");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const {
  getNotebookMarkSyncConfig,
  sanitizeAndValidateMappings,
  syncNotebookMappings,
} = require("../utils/notebookMarkSync");

const DEFAULT_SETTINGS = {
  groupWise: false,
  groupMarkMode: "group",
  feedbackEntryMode: "group",
  includeRoll: true,
  includeName: true,
  includeFeedback: true,
  includeMcq: true,
  includeCheckbox: false,
  includeBlankFields: false,
  includeTotal: false,
  columnOrder: [],
  mcqLabel: "Marking Category",
  mcqOptions: ["High", "Medium", "Low"],
  mcqFields: [
    {
      id: "mcq_1",
      label: "Marking Category",
      options: ["High", "Medium", "Low"],
      entryMode: "group",
    },
  ],
  checkboxFields: [
    {
      id: "checkbox_1",
      label: "Completed",
      entryMode: "group",
    },
  ],
  blankFields: [
    {
      id: "blank_1",
      label: "Marks",
      entryMode: "group",
    },
  ],
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const cleanString = (value, fallback = "") => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
};

const cleanEditableString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const sanitizeEntryMode = (value, fallback = "group") =>
  String(value || fallback).toLowerCase() === "individual" ? "individual" : "group";

const cleanOptions = (options) => {
  if (!Array.isArray(options) || options.length === 0) return [...DEFAULT_SETTINGS.mcqOptions];
  return options.map((x) => cleanEditableString(x));
};

const blankColumnId = (field) => `blank:${field.id}`;
const mcqColumnId = (field) => `mcq:${field.id}`;
const checkboxColumnId = (field) => `checkbox:${field.id}`;

const getAllMovableColumnIds = (settings = {}) => [
  "roll",
  "name",
  ...(Array.isArray(settings.blankFields) ? settings.blankFields.map(blankColumnId) : []),
  ...(Array.isArray(settings.mcqFields) ? settings.mcqFields.map(mcqColumnId) : []),
  ...(Array.isArray(settings.checkboxFields) ? settings.checkboxFields.map(checkboxColumnId) : []),
  "feedback",
];

const sanitizeColumnOrder = (order = [], settings = {}) => {
  const allIds = getAllMovableColumnIds(settings);
  const allowed = new Set(allIds);
  const seen = new Set();
  const savedOrder = Array.isArray(order) ? order : [];
  const normalized = savedOrder
    .map((item) => cleanString(item))
    .filter((id) => allowed.has(id) && !seen.has(id) && seen.add(id));
  return [...normalized, ...allIds.filter((id) => !seen.has(id))];
};

const sanitizeMcqFields = (raw = {}) => {
  const sourceFields =
    Array.isArray(raw.mcqFields) && raw.mcqFields.length > 0
      ? raw.mcqFields
      : [
          {
            id: "mcq_1",
            label: raw.mcqLabel || DEFAULT_SETTINGS.mcqLabel,
            options: raw.mcqOptions || DEFAULT_SETTINGS.mcqOptions,
          },
        ];

  const usedIds = new Set();

  return sourceFields.map((field, index) => {
    let id = cleanString(field?.id, `mcq_${index + 1}`);
    if (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);

    return {
      id,
      label: cleanEditableString(field?.label ?? field?.mcqLabel, `Category ${index + 1}`),
      options: cleanOptions(field?.options ?? field?.mcqOptions),
      entryMode: sanitizeEntryMode(field?.entryMode, raw.groupMarkMode || "group"),
    };
  });
};

const sanitizeBlankFields = (raw = {}) => {
  const sourceFields =
    Array.isArray(raw.blankFields) && raw.blankFields.length > 0
      ? raw.blankFields
      : DEFAULT_SETTINGS.blankFields;

  const usedIds = new Set();

  return sourceFields.map((field, index) => {
    let id = cleanString(field?.id, `blank_${index + 1}`);
    if (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);

    return {
      id,
      label: cleanEditableString(field?.label, `Blank Field ${index + 1}`),
      entryMode: sanitizeEntryMode(field?.entryMode, raw.groupMarkMode || "group"),
    };
  });
};

const sanitizeCheckboxFields = (raw = {}) => {
  const sourceFields =
    Array.isArray(raw.checkboxFields) && raw.checkboxFields.length > 0
      ? raw.checkboxFields
      : DEFAULT_SETTINGS.checkboxFields;

  const usedIds = new Set();
  return sourceFields.map((field, index) => {
    let id = cleanString(field?.id, `checkbox_${index + 1}`);
    if (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);
    return {
      id,
      label: cleanEditableString(field?.label, `Checkbox ${index + 1}`),
      entryMode: sanitizeEntryMode(field?.entryMode, raw.groupMarkMode || "group"),
    };
  });
};

const sanitizeSettings = (raw = {}) => {
  const mcqFields = sanitizeMcqFields(raw);
  const blankFields = sanitizeBlankFields(raw);
  const checkboxFields = sanitizeCheckboxFields(raw);
  const firstField = mcqFields[0] || DEFAULT_SETTINGS.mcqFields[0];

  const settings = {
    groupWise: raw.groupWise === undefined ? false : Boolean(raw.groupWise),
    groupMarkMode: sanitizeEntryMode(raw.groupMarkMode, "group"),
    feedbackEntryMode: sanitizeEntryMode(raw.feedbackEntryMode, raw.groupMarkMode || "group"),
    includeRoll: raw.includeRoll === undefined ? true : Boolean(raw.includeRoll),
    includeName: raw.includeName === undefined ? true : Boolean(raw.includeName),
    includeFeedback: raw.includeFeedback === undefined ? true : Boolean(raw.includeFeedback),
    includeMcq: raw.includeMcq === undefined ? true : Boolean(raw.includeMcq),
    includeCheckbox: raw.includeCheckbox === undefined ? false : Boolean(raw.includeCheckbox),
    includeBlankFields: raw.includeBlankFields === undefined ? false : Boolean(raw.includeBlankFields),
    includeTotal: raw.includeTotal === undefined ? false : Boolean(raw.includeTotal),
    mcqLabel: firstField.label,
    mcqOptions: firstField.options,
    mcqFields,
    checkboxFields,
    blankFields,
  };

  return {
    ...settings,
    columnOrder: sanitizeColumnOrder(raw.columnOrder, settings),
  };
};

const sanitizeKeyValueMap = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.entries(values).reduce((acc, [key, value]) => {
    const cleanKey = cleanString(key);
    if (!cleanKey) return acc;
    acc[cleanKey] = cleanString(value);
    return acc;
  }, {});
};

const sanitizeBooleanMap = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.entries(values).reduce((acc, [key, value]) => {
    const cleanKey = cleanString(key);
    if (!cleanKey) return acc;
    acc[cleanKey] = Boolean(value);
    return acc;
  }, {});
};

const sanitizeEvaluationRows = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    student: isValidObjectId(row.student) ? row.student : null,
    course: isValidObjectId(row.course) ? row.course : null,
    courseLabel: cleanString(row.courseLabel),
    roll: cleanString(row.roll),
    name: cleanString(row.name),
    selectedOption: cleanString(row.selectedOption),
    selectedOptions: sanitizeKeyValueMap(row.selectedOptions),
    checkboxValues: sanitizeBooleanMap(row.checkboxValues),
    blankValues: sanitizeKeyValueMap(row.blankValues),
    feedback: typeof row.feedback === "string" ? row.feedback : "",
  }));
};

const sanitizeGroupRows = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  const seenIds = new Set();
  const assignedMembers = new Set();
  return rows.map((row, index) => {
    let id = cleanString(row?.id, `group_${index + 1}`);
    if (seenIds.has(id)) id = `${id}_${index + 1}`;
    seenIds.add(id);

    const members = Array.isArray(row?.members)
      ? row.members
          .map((member) => ({
            student: isValidObjectId(member?.student) ? member.student : null,
            roll: cleanString(member?.roll),
            name: cleanString(member?.name),
            selectedOptions: sanitizeKeyValueMap(member?.selectedOptions),
            checkboxValues: sanitizeBooleanMap(member?.checkboxValues),
            blankValues: sanitizeKeyValueMap(member?.blankValues),
            feedback: typeof member?.feedback === "string" ? member.feedback : "",
          }))
          .filter((member) => member.student || member.roll || member.name)
          .filter((member) => {
            const key = member.student
              ? `student:${String(member.student)}`
              : member.roll
                ? `roll:${member.roll.toLowerCase()}`
                : `name:${member.name.toLowerCase()}`;
            if (assignedMembers.has(key)) return false;
            assignedMembers.add(key);
            return true;
          })
      : [];

    return {
      id,
      groupName: cleanEditableString(row?.groupName, `Group ${index + 1}`),
      members,
      selectedOptions: sanitizeKeyValueMap(row?.selectedOptions),
      checkboxValues: sanitizeBooleanMap(row?.checkboxValues),
      blankValues: sanitizeKeyValueMap(row?.blankValues),
      feedback: typeof row?.feedback === "string" ? row.feedback : "",
    };
  });
};

const formatCourse = (course) => {
  if (!course) return null;
  return {
    id: course._id?.toString?.() || course.id,
    _id: course._id?.toString?.() || course.id,
    code: course.code || "",
    title: course.title || "",
    section: course.section || "",
    semester: course.semester || "",
    year: course.year || "",
    courseType: course.courseType || "theory",
  };
};

const formatNote = (note) => {
  if (!note) return null;
  const obj = note.toObject ? note.toObject() : note;
  return {
    ...obj,
    id: obj._id?.toString?.() || obj.id,
    _id: obj._id?.toString?.() || obj.id,
    teacher: obj.teacher?.toString?.() || obj.teacher,
    course: obj.course && typeof obj.course === "object" ? formatCourse(obj.course) : obj.course || null,
    markSyncMappings: Array.isArray(obj.markSyncMappings)
      ? obj.markSyncMappings.map((mapping) => ({
          ...mapping,
          targetAssessment:
            mapping?.targetAssessment?.toString?.() ||
            mapping?.targetAssessment ||
            "",
        }))
      : [],
  };
};

const getOwnedCourse = async (courseId, teacherId) => {
  if (!courseId) return null;
  if (!isValidObjectId(courseId)) return null;
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const formatRowCourseLabel = (course = {}) => {
  const code = cleanString(course.code, "Course");
  const title = cleanString(course.title);
  const section = cleanString(course.section);
  return `${code}${title ? ` - ${title}` : ""}${section ? ` (${section})` : ""}`;
};

const buildEvaluationRowsFromCourses = async (courses = []) => {
  const validCourses = (Array.isArray(courses) ? courses : []).filter((course) => course?._id);
  if (!validCourses.length) return [];

  const courseMap = new Map(validCourses.map((course) => [String(course._id), course]));
  const enrollments = await Enrollment.find({
    course: { $in: validCourses.map((course) => course._id) },
  })
    .populate("student", "username name")
    .lean();

  return enrollments
    .map((enrollment) => {
      const course = courseMap.get(String(enrollment.course));
      return {
        student: enrollment.student?._id || null,
        course: course?._id || enrollment.course || null,
        courseLabel: formatRowCourseLabel(course),
        roll: enrollment.student?.username || "",
        name: enrollment.student?.name || "",
        selectedOption: "",
        selectedOptions: {},
        checkboxValues: {},
        blankValues: {},
        feedback: "",
      };
    })
    .sort((a, b) => {
      const courseDifference = String(a.courseLabel || "").localeCompare(
        String(b.courseLabel || ""),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
      if (courseDifference) return courseDifference;
      return String(a.roll || "").localeCompare(String(b.roll || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
};

const buildEvaluationRowsFromCourse = async (course) =>
  buildEvaluationRowsFromCourses([course]);

const buildScopedCourseQuery = (teacherId, semester = "", year = "") => {
  const query = {
    createdBy: teacherId,
    archived: { $ne: true },
  };

  const cleanSemester = cleanString(semester);
  const cleanYear = cleanString(year);
  if (cleanSemester) query.semester = cleanSemester;
  if (cleanYear) {
    const numericYear = Number(cleanYear);
    query.year = Number.isFinite(numericYear) ? numericYear : cleanYear;
  }

  return query;
};

const getScopedCourses = async (teacherId, semester = "", year = "") =>
  Course.find(buildScopedCourseQuery(teacherId, semester, year)).sort({
    year: -1,
    semester: 1,
    code: 1,
    section: 1,
  });

const evaluationRowIdentity = (row = {}, fallbackCourseId = "") => {
  const courseId =
    row.course?.toString?.() ||
    (row.course ? String(row.course) : "") ||
    String(fallbackCourseId || "");
  const studentId =
    row.student?.toString?.() || (row.student ? String(row.student) : "");
  const roll = cleanString(row.roll);
  const studentKey = studentId || (roll ? `roll:${roll}` : "");
  return courseId && studentKey ? `${courseId}::${studentKey}` : "";
};

const ensureMarkSyncEvaluation = (note) => {
  if (note?.type !== "evaluation") {
    const error = new Error("Marks Sync is available only for evaluation sheets.");
    error.statusCode = 400;
    throw error;
  }
};

exports.getNotebookNotes = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { type, courseId, q } = req.query;

    const filter = { teacher: teacherId };

    if (["evaluation", "simple"].includes(type)) {
      filter.type = type;
    }

    if (courseId && isValidObjectId(courseId)) {
      filter.course = courseId;
    }

    if (q && String(q).trim()) {
      filter.title = { $regex: String(q).trim(), $options: "i" };
    }

    const notes = await NotebookNote.find(filter)
      .populate("course", "code title section semester year courseType")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json(notes.map(formatNote));
  } catch (err) {
    console.error("getNotebookNotes error", err);
    return res.status(500).json({ message: "Failed to load notebook notes." });
  }
};

exports.createNotebookNote = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const type = req.body.type === "evaluation" ? "evaluation" : "simple";
    const settings = sanitizeSettings(req.body.settings || {});
    const title = cleanString(
      req.body.title,
      type === "evaluation" ? "Evaluation Sheet" : "Simple Note"
    );
    const requestedScope =
      type === "evaluation" && !settings.groupWise && req.body.courseScope === "all"
        ? "all"
        : "single";
    const courseId = req.body.courseId || req.body.course || null;

    let course = null;
    let scopeCourses = [];
    let scopeSemester = "";
    let scopeYear = "";

    if (requestedScope === "all") {
      scopeSemester = cleanString(req.body.scopeSemester);
      scopeYear = cleanString(req.body.scopeYear);
      scopeCourses = await getScopedCourses(teacherId, scopeSemester, scopeYear);

      if (!scopeCourses.length) {
        return res.status(404).json({
          message: "No active course was found for the selected semester.",
        });
      }

      scopeSemester = scopeSemester || cleanString(scopeCourses[0]?.semester);
      scopeYear = scopeYear || cleanString(String(scopeCourses[0]?.year || ""));
    } else if (courseId) {
      course = await getOwnedCourse(courseId, teacherId);
      if (!course) {
        return res.status(404).json({ message: "Selected course was not found." });
      }
    }

    if (type === "evaluation" && requestedScope === "single" && !course) {
      return res.status(400).json({
        message: settings.groupWise
          ? "Course is required for a group-wise presentation sheet."
          : "Course is required for an evaluation sheet.",
      });
    }

    let evaluationRows = [];
    if (type === "evaluation") {
      evaluationRows =
        requestedScope === "all"
          ? await buildEvaluationRowsFromCourses(scopeCourses)
          : await buildEvaluationRowsFromCourse(course);
    }

    const note = await NotebookNote.create({
      teacher: teacherId,
      course: requestedScope === "single" ? course?._id || null : null,
      courseScope: requestedScope,
      scopeSemester: requestedScope === "all" ? scopeSemester : "",
      scopeYear: requestedScope === "all" ? scopeYear : "",
      title,
      type,
      date: cleanString(req.body.date),
      time: cleanString(req.body.time),
      settings,
      evaluationRows,
      groupRows: settings.groupWise ? sanitizeGroupRows(req.body.groupRows || []) : [],
      content:
        type === "simple" && typeof req.body.content === "string"
          ? req.body.content
          : "",
    });

    const populated = await NotebookNote.findById(note._id).populate(
      "course",
      "code title section semester year courseType"
    );

    return res.status(201).json(formatNote(populated));
  } catch (err) {
    console.error("createNotebookNote error", err);
    return res.status(500).json({ message: "Failed to create notebook note." });
  }
};

exports.getNotebookNoteById = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({ _id: noteId, teacher: teacherId }).populate(
      "course",
      "code title section semester year courseType"
    );

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    return res.json(formatNote(note));
  } catch (err) {
    console.error("getNotebookNoteById error", err);
    return res.status(500).json({ message: "Failed to load notebook note." });
  }
};

exports.updateNotebookNote = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({ _id: noteId, teacher: teacherId });

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    if (req.body.title !== undefined) {
      note.title = cleanString(req.body.title, "Untitled Note");
    }

    if (req.body.date !== undefined) {
      note.date = cleanString(req.body.date);
    }

    if (req.body.time !== undefined) {
      note.time = cleanString(req.body.time);
    }

    if (req.body.settings !== undefined) {
      const nextSettings = sanitizeSettings(req.body.settings);
      if (nextSettings.groupWise && note.courseScope === "all") {
        return res.status(400).json({
          message: "Group-wise presentation sheets must be connected to one course.",
        });
      }
      note.settings = nextSettings;
    }

    if (req.body.content !== undefined) {
      note.content = typeof req.body.content === "string" ? req.body.content : "";
    }

    if (req.body.evaluationRows !== undefined) {
      note.evaluationRows = sanitizeEvaluationRows(req.body.evaluationRows);
    }

    if (req.body.groupRows !== undefined) {
      note.groupRows = sanitizeGroupRows(req.body.groupRows);
    }

    if (note.type === "evaluation" && req.body.courseScope !== undefined) {
      const nextScope = req.body.courseScope === "all" ? "all" : "single";
      if (note.settings?.groupWise && nextScope === "all") {
        return res.status(400).json({
          message: "Group-wise presentation sheets cannot use All Courses scope.",
        });
      }
      note.courseScope = nextScope;
    }
    if (req.body.scopeSemester !== undefined) {
      note.scopeSemester = cleanString(req.body.scopeSemester);
    }
    if (req.body.scopeYear !== undefined) {
      note.scopeYear = cleanString(req.body.scopeYear);
    }

    if (req.body.courseId !== undefined || req.body.course !== undefined) {
      const nextCourseId = req.body.courseId || req.body.course || null;
      if (nextCourseId) {
        const course = await getOwnedCourse(nextCourseId, teacherId);
        if (!course) {
          return res.status(404).json({ message: "Selected course was not found." });
        }
        note.course = course._id;
      } else if (note.type === "simple" || note.courseScope === "all") {
        note.course = null;
      }
    }

    if (note.type === "evaluation" && note.courseScope === "all") {
      note.course = null;
      note.markSyncMappings = [];
    } else if (note.type !== "evaluation") {
      note.courseScope = "single";
      note.scopeSemester = "";
      note.scopeYear = "";
      note.groupRows = [];
    }

    await note.save();

    if (
      note.type === "evaluation" &&
      note.courseScope !== "all" &&
      note.markSyncMappings?.length
    ) {
      try {
        await syncNotebookMappings(note);
      } catch (syncError) {
        console.error("automatic notebook mark sync error", syncError);
      }
    }

    const populated = await NotebookNote.findById(note._id).populate(
      "course",
      "code title section semester year courseType"
    );

    return res.json(formatNote(populated));
  } catch (err) {
    console.error("updateNotebookNote error", err);
    return res.status(500).json({ message: "Failed to save notebook note." });
  }
};

exports.refreshNotebookStudents = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({ _id: noteId, teacher: teacherId });

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    if (note.type !== "evaluation") {
      return res.status(400).json({
        message: "Student refresh is available only for evaluation sheets.",
      });
    }

    const isAllCourses = note.courseScope === "all";
    let latestRows = [];
    let fallbackCourseId = "";

    if (isAllCourses) {
      const courses = await getScopedCourses(
        teacherId,
        note.scopeSemester,
        note.scopeYear
      );
      if (!courses.length) {
        return res.status(404).json({
          message: "No active course was found for this sheet's semester.",
        });
      }
      latestRows = await buildEvaluationRowsFromCourses(courses);
    } else {
      if (!note.course) {
        return res.status(400).json({
          message: "This evaluation sheet is not connected to a course.",
        });
      }

      const course = await getOwnedCourse(note.course, teacherId);
      if (!course) {
        return res.status(404).json({ message: "Connected course was not found." });
      }
      fallbackCourseId = course._id;
      latestRows = await buildEvaluationRowsFromCourse(course);
    }

    const existingKeys = new Set();
    note.evaluationRows.forEach((row) => {
      const key = evaluationRowIdentity(row, fallbackCourseId);
      if (key) existingKeys.add(key);
    });

    const rowsToAdd = latestRows.filter((row) => {
      const key = evaluationRowIdentity(row, fallbackCourseId);
      if (!key || existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (rowsToAdd.length > 0) {
      note.evaluationRows = [...note.evaluationRows, ...rowsToAdd];
      await note.save();
    }

    const populated = await NotebookNote.findById(note._id).populate(
      "course",
      "code title section semester year courseType"
    );

    return res.json({
      message:
        rowsToAdd.length > 0
          ? `${rowsToAdd.length} new student entr${
              rowsToAdd.length === 1 ? "y" : "ies"
            } added.`
          : "Student data is already up to date.",
      addedCount: rowsToAdd.length,
      note: formatNote(populated),
    });
  } catch (err) {
    console.error("refreshNotebookStudents error", err);
    return res.status(500).json({ message: "Failed to refresh student data." });
  }
};

exports.getNotebookMarkSync = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({
      _id: noteId,
      teacher: teacherId,
    });

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    ensureMarkSyncEvaluation(note);
    const config = await getNotebookMarkSyncConfig(note);
    return res.json(config);
  } catch (err) {
    console.error("getNotebookMarkSync error", err);
    return res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to load notebook marks sync.",
    });
  }
};

exports.saveNotebookMarkSync = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({
      _id: noteId,
      teacher: teacherId,
    });

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    ensureMarkSyncEvaluation(note);
    const mappings = await sanitizeAndValidateMappings(
      note,
      req.body?.mappings
    );

    note.markSyncMappings = mappings;
    await note.save();

    const summary = await syncNotebookMappings(note);
    const config = await getNotebookMarkSyncConfig(note);

    return res.json({
      message:
        mappings.length > 0
          ? "Notebook marks mapping saved and synchronized."
          : "Notebook marks mappings removed. Existing marks were kept.",
      summary,
      ...config,
    });
  } catch (err) {
    console.error("saveNotebookMarkSync error", err);
    return res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to save notebook marks mapping.",
    });
  }
};

exports.syncNotebookMarks = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const note = await NotebookNote.findOne({
      _id: noteId,
      teacher: teacherId,
    });

    if (!note) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    ensureMarkSyncEvaluation(note);
    const summary = await syncNotebookMappings(note);
    return res.json({
      message: summary.message,
      summary,
    });
  } catch (err) {
    console.error("syncNotebookMarks error", err);
    return res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to synchronize notebook marks.",
    });
  }
};

exports.deleteNotebookNote = async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ message: "Invalid note id." });
    }

    const deleted = await NotebookNote.findOneAndDelete({ _id: noteId, teacher: teacherId });

    if (!deleted) {
      return res.status(404).json({ message: "Notebook note not found." });
    }

    return res.json({ message: "Notebook note deleted." });
  } catch (err) {
    console.error("deleteNotebookNote error", err);
    return res.status(500).json({ message: "Failed to delete notebook note." });
  }
};
