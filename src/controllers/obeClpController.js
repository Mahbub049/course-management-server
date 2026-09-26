const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const CourseOutcome = require('../models/CourseOutcome');
const Assessment = require('../models/Assessment');
const ObeClpConfig = require('../models/ObeClpConfig');
const ObeClpStudentMark = require('../models/ObeClpStudentMark');
const {
  buildLabClpData,
  getCourseType,
  isClpSourceAssessment,
  round2,
} = require('../utils/obeClp');

const cleanText = (value = '') => String(value || '').trim();
const cleanCode = (value = '') => cleanText(value).toUpperCase();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const findTeacherLabCourse = async (courseId, teacherId) => {
  const course = await Course.findOne({ _id: courseId, createdBy: teacherId });
  if (!course) return { course: null, error: 'Course not found' };
  if (getCourseType(course) !== 'lab') {
    return { course: null, error: 'CLP configuration is only available for lab courses.' };
  }
  return { course, error: '' };
};

const uniqueStrings = (values = []) => [
  ...new Set((values || []).map((value) => cleanText(value)).filter(Boolean)),
];

const normalizeItems = (items = []) => {
  const usedKeys = new Set();
  return (Array.isArray(items) ? items : []).map((item, index) => {
    let key = cleanText(item?.key || `clp${index + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '') || `clp${index + 1}`;
    const base = key;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);

    const sourceAssessments = uniqueStrings([
      ...(Array.isArray(item?.sourceAssessments) ? item.sourceAssessments : []),
      item?.sourceAssessment,
    ]);

    return {
      key,
      label: cleanText(item?.label || `CLP${index + 1}`),
      marks: round2(item?.marks),
      coCode: cleanCode(item?.coCode),
      sourceAssessment: sourceAssessments[0] || null,
      sourceAssessments,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
    };
  });
};

const getObeClp = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { course, error } = await findTeacherLabCourse(courseId, req.user.userId);
    if (!course) return res.status(error === 'Course not found' ? 404 : 400).json({ message: error });

    const data = await buildLabClpData(courseId);
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  } catch (error) {
    console.error('getObeClp error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const saveObeClpSetup = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { attendanceCoCode = 'CO3', items = [] } = req.body || {};
    const { course, error } = await findTeacherLabCourse(courseId, req.user.userId);
    if (!course) return res.status(error === 'Course not found' ? 404 : 400).json({ message: error });

    const normalizedItems = normalizeItems(items);
    if (!normalizedItems.length) {
      return res.status(400).json({ message: 'Create at least one CLP item.' });
    }

    const totalMarks = round2(
      normalizedItems.reduce((sum, item) => sum + Number(item.marks || 0), 0)
    );
    if (Math.abs(totalMarks - 25) > 0.001) {
      return res.status(400).json({
        message: `CLP items must total 25 marks. Current total is ${totalMarks}.`,
      });
    }

    if (normalizedItems.some((item) => !item.label || item.marks <= 0 || !item.coCode)) {
      return res.status(400).json({
        message: 'Each CLP item requires a label, positive mark, and Course Outcome.',
      });
    }

    const distinctClpCos = new Set(normalizedItems.map((item) => item.coCode));
    if (distinctClpCos.size > 4) {
      return res.status(400).json({
        message: 'The official lab GradeSheet has five continuous-assessment columns. Attendance uses one, so CLP can use at most four different CO groups.',
      });
    }

    const courseOutcomes = await CourseOutcome.find({ course: courseId }).select('code');
    const allowedCOs = new Set(courseOutcomes.map((row) => cleanCode(row.code)));
    const normalizedAttendanceCo = cleanCode(attendanceCoCode);
    if (!allowedCOs.has(normalizedAttendanceCo)) {
      return res.status(400).json({ message: 'Select a valid CO for Attendance.' });
    }
    const invalidCo = normalizedItems.find((item) => !allowedCOs.has(item.coCode));
    if (invalidCo) {
      return res.status(400).json({ message: `Invalid CO selected for ${invalidCo.label}.` });
    }

    const sourceIds = uniqueStrings(
      normalizedItems.flatMap((item) => item.sourceAssessments || [])
    );
    if (sourceIds.length) {
      const sourceAssessments = await Assessment.find({
        _id: { $in: sourceIds },
        course: courseId,
      }).lean();
      const validSourceIds = new Set(
        sourceAssessments.filter(isClpSourceAssessment).map((row) => String(row._id))
      );
      const invalidSource = sourceIds.find((id) => !validSourceIds.has(String(id)));
      if (invalidSource) {
        return res.status(400).json({
          message: 'One or more selected CLP source assessments are not valid Individual Lab Assessments for this course.',
        });
      }
    }

    const config = await ObeClpConfig.findOneAndUpdate(
      { course: courseId },
      {
        $set: {
          course: courseId,
          attendanceCoCode: normalizedAttendanceCo,
          items: normalizedItems,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const allowedKeys = normalizedItems.map((item) => item.key);
    await ObeClpStudentMark.updateMany(
      { course: courseId },
      { $pull: { entries: { clpKey: { $nin: allowedKeys } } } }
    );
    await ObeClpStudentMark.deleteMany({
      course: courseId,
      entries: { $size: 0 },
      $or: [
        { attendanceObtainedMarks: null },
        { attendanceObtainedMarks: { $exists: false } },
      ],
    });

    return res.json({ message: 'CLP setup saved successfully.', config });
  } catch (error) {
    console.error('saveObeClpSetup error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

const saveObeClpMarks = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { records = [] } = req.body || {};
    const { course, error } = await findTeacherLabCourse(courseId, req.user.userId);
    if (!course) return res.status(error === 'Course not found' ? 404 : 400).json({ message: error });

    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ message: 'No CLP or Attendance mark changes were supplied.' });
    }

    const [config, enrollments] = await Promise.all([
      ObeClpConfig.findOne({ course: courseId }).lean(),
      Enrollment.find({ course: courseId }).select('student').lean(),
    ]);

    const itemMap = new Map(
      (config?.items || []).map((item) => [String(item.key), Number(item.marks || 0)])
    );
    const enrolled = new Set(enrollments.map((row) => String(row.student)));

    for (const record of records) {
      const studentId = String(record?.studentId || '');
      if (!enrolled.has(studentId)) {
        return res.status(400).json({ message: 'Invalid student in CLP mark request.' });
      }

      const requestedEntries = Array.isArray(record?.entries) ? record.entries : [];
      if (requestedEntries.length && !itemMap.size) {
        return res.status(400).json({ message: 'Save the CLP setup first.' });
      }

      const existing = await ObeClpStudentMark.findOne({ course: courseId, student: studentId });
      const entryMap = new Map(
        (existing?.entries || []).map((entry) => [String(entry.clpKey), Number(entry.obtainedMarks || 0)])
      );

      for (const entry of requestedEntries) {
        const key = String(entry?.clpKey || '');
        if (!itemMap.has(key)) {
          return res.status(400).json({ message: `Unknown CLP item: ${key || 'blank'}.` });
        }

        if (entry?.obtainedMarks === null || entry?.obtainedMarks === '' || entry?.obtainedMarks === undefined) {
          entryMap.delete(key);
          continue;
        }

        const numeric = Number(entry.obtainedMarks);
        const maxMarks = Number(itemMap.get(key) || 0);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > maxMarks) {
          return res.status(400).json({
            message: `CLP mark must be between 0 and ${maxMarks}.`,
          });
        }
        entryMap.set(key, round2(numeric));
      }

      let attendanceObtainedMarks =
        existing?.attendanceObtainedMarks === null || existing?.attendanceObtainedMarks === undefined
          ? null
          : Number(existing.attendanceObtainedMarks);

      if (hasOwn(record, 'attendanceObtainedMarks')) {
        const rawAttendance = record.attendanceObtainedMarks;
        if (rawAttendance === null || rawAttendance === '' || rawAttendance === undefined) {
          attendanceObtainedMarks = null;
        } else {
          const numericAttendance = Number(rawAttendance);
          if (!Number.isFinite(numericAttendance) || numericAttendance < 0 || numericAttendance > 5) {
            return res.status(400).json({ message: 'Attendance mark must be between 0 and 5.' });
          }
          attendanceObtainedMarks = round2(numericAttendance);
        }
      }

      const entries = [...entryMap.entries()].map(([clpKey, obtainedMarks]) => ({
        clpKey,
        obtainedMarks,
      }));

      if (!entries.length && attendanceObtainedMarks === null) {
        await ObeClpStudentMark.deleteOne({ course: courseId, student: studentId });
      } else {
        await ObeClpStudentMark.findOneAndUpdate(
          { course: courseId, student: studentId },
          {
            $set: {
              course: courseId,
              student: studentId,
              entries,
              attendanceObtainedMarks,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    return res.json({ message: 'CLP / Attendance marks saved successfully.' });
  } catch (error) {
    console.error('saveObeClpMarks error', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getObeClp,
  saveObeClpSetup,
  saveObeClpMarks,
};
