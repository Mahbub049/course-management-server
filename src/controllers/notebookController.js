const mongoose = require("mongoose");
const NotebookNote = require("../models/NotebookNote");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");

const DEFAULT_SETTINGS = {
  includeRoll: true,
  includeName: true,
  includeFeedback: true,
  includeMcq: true,
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
    },
  ],
  blankFields: [
    {
      id: "blank_1",
      label: "Marks",
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

const cleanOptions = (options) => {
  if (!Array.isArray(options) || options.length === 0) return [...DEFAULT_SETTINGS.mcqOptions];
  return options.map((x) => cleanEditableString(x));
};


const blankColumnId = (field) => `blank:${field.id}`;
const mcqColumnId = (field) => `mcq:${field.id}`;

const getAllMovableColumnIds = (settings = {}) => [
  "roll",
  "name",
  ...(Array.isArray(settings.blankFields) ? settings.blankFields.map(blankColumnId) : []),
  ...(Array.isArray(settings.mcqFields) ? settings.mcqFields.map(mcqColumnId) : []),
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
    };
  });
};

const sanitizeSettings = (raw = {}) => {
  const mcqFields = sanitizeMcqFields(raw);
  const blankFields = sanitizeBlankFields(raw);
  const firstField = mcqFields[0] || DEFAULT_SETTINGS.mcqFields[0];

  const settings = {
    includeRoll: raw.includeRoll === undefined ? true : Boolean(raw.includeRoll),
    includeName: raw.includeName === undefined ? true : Boolean(raw.includeName),
    includeFeedback: raw.includeFeedback === undefined ? true : Boolean(raw.includeFeedback),
    includeMcq: raw.includeMcq === undefined ? true : Boolean(raw.includeMcq),
    includeBlankFields: raw.includeBlankFields === undefined ? false : Boolean(raw.includeBlankFields),
    includeTotal: raw.includeTotal === undefined ? false : Boolean(raw.includeTotal),
    mcqLabel: firstField.label,
    mcqOptions: firstField.options,
    mcqFields,
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

const sanitizeEvaluationRows = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    student: isValidObjectId(row.student) ? row.student : null,
    roll: cleanString(row.roll),
    name: cleanString(row.name),
    selectedOption: cleanString(row.selectedOption),
    selectedOptions: sanitizeKeyValueMap(row.selectedOptions),
    blankValues: sanitizeKeyValueMap(row.blankValues),
    feedback: typeof row.feedback === "string" ? row.feedback : "",
  }));
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
  };
};

const getOwnedCourse = async (courseId, teacherId) => {
  if (!courseId) return null;
  if (!isValidObjectId(courseId)) return null;
  return Course.findOne({ _id: courseId, createdBy: teacherId });
};

const buildEvaluationRowsFromCourse = async (courseId) => {
  const enrollments = await Enrollment.find({ course: courseId })
    .populate("student", "username name")
    .lean();

  return enrollments
    .map((enrollment) => ({
      student: enrollment.student?._id || null,
      roll: enrollment.student?.username || "",
      name: enrollment.student?.name || "",
      selectedOption: "",
      selectedOptions: {},
      blankValues: {},
      feedback: "",
    }))
    .sort((a, b) =>
      String(a.roll || "").localeCompare(String(b.roll || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
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
    const title = cleanString(req.body.title, type === "evaluation" ? "Evaluation Sheet" : "Simple Note");
    const courseId = req.body.courseId || req.body.course || null;

    let course = null;
    if (courseId) {
      course = await getOwnedCourse(courseId, teacherId);
      if (!course) {
        return res.status(404).json({ message: "Selected course was not found." });
      }
    }

    if (type === "evaluation" && !course) {
      return res.status(400).json({ message: "Course is required for an evaluation sheet." });
    }

    const settings = sanitizeSettings(req.body.settings || {});
    const evaluationRows =
      type === "evaluation" ? await buildEvaluationRowsFromCourse(course._id) : [];

    const note = await NotebookNote.create({
      teacher: teacherId,
      course: course?._id || null,
      title,
      type,
      date: cleanString(req.body.date),
      time: cleanString(req.body.time),
      settings,
      evaluationRows,
      content: type === "simple" && typeof req.body.content === "string" ? req.body.content : "",
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
      note.settings = sanitizeSettings(req.body.settings);
    }

    if (req.body.content !== undefined) {
      note.content = typeof req.body.content === "string" ? req.body.content : "";
    }

    if (req.body.evaluationRows !== undefined) {
      note.evaluationRows = sanitizeEvaluationRows(req.body.evaluationRows);
    }

    if (req.body.courseId !== undefined || req.body.course !== undefined) {
      const nextCourseId = req.body.courseId || req.body.course || null;
      if (nextCourseId) {
        const course = await getOwnedCourse(nextCourseId, teacherId);
        if (!course) {
          return res.status(404).json({ message: "Selected course was not found." });
        }
        note.course = course._id;
      } else if (note.type === "simple") {
        note.course = null;
      }
    }

    await note.save();

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
      return res.status(400).json({ message: "Student refresh is available only for evaluation sheets." });
    }

    if (!note.course) {
      return res.status(400).json({ message: "This evaluation sheet is not connected to a course." });
    }

    const course = await getOwnedCourse(note.course, teacherId);
    if (!course) {
      return res.status(404).json({ message: "Connected course was not found." });
    }

    const latestRows = await buildEvaluationRowsFromCourse(course._id);
    const existingStudentIds = new Set();
    const existingRolls = new Set();

    note.evaluationRows.forEach((row) => {
      const studentId = row.student?.toString?.() || (row.student ? String(row.student) : "");
      const roll = cleanString(row.roll);
      if (studentId) existingStudentIds.add(studentId);
      if (roll) existingRolls.add(roll);
    });

    const rowsToAdd = latestRows.filter((row) => {
      const studentId = row.student?.toString?.() || (row.student ? String(row.student) : "");
      const roll = cleanString(row.roll);
      if (studentId && existingStudentIds.has(studentId)) return false;
      if (roll && existingRolls.has(roll)) return false;
      if (studentId) existingStudentIds.add(studentId);
      if (roll) existingRolls.add(roll);
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
          ? `${rowsToAdd.length} new student${rowsToAdd.length === 1 ? "" : "s"} added.`
          : "Student data is already up to date.",
      addedCount: rowsToAdd.length,
      note: formatNote(populated),
    });
  } catch (err) {
    console.error("refreshNotebookStudents error", err);
    return res.status(500).json({ message: "Failed to refresh student data." });
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
