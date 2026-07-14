const mongoose = require('mongoose');
const Assessment = require('../models/Assessment');
const Enrollment = require('../models/Enrollment');
const Mark = require('../models/Mark');
const NotebookNote = require('../models/NotebookNote');

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || ''));

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const isHalfStepMark = (value) => {
  const number = Number(value);
  return (
    Number.isFinite(number) &&
    number >= 0 &&
    Math.abs(number * 2 - Math.round(number * 2)) < 1e-9
  );
};

const normalizeRoll = (value) => String(value || '').trim().toLowerCase();

const getNoteCourseId = (note) =>
  String(note?.course?._id || note?.course || '').trim();

const getGenericComponents = (assessment) => {
  if (
    assessment?.structureType !== 'lab_final' ||
    assessment?.labFinalConfig?.mode !== 'components'
  ) {
    return [];
  }

  return Array.isArray(assessment?.labFinalConfig?.genericComponents)
    ? assessment.labFinalConfig.genericComponents
    : [];
};

const mappingTargetKey = (mapping = {}) => {
  const assessmentId = String(mapping.targetAssessment || '').trim();
  const componentKey = String(mapping.targetComponentKey || '').trim();
  return `${assessmentId}:${componentKey}`;
};

const mappingSourceKey = (mapping = {}) => {
  const sourceType = String(mapping.sourceType || '').trim();
  const fieldId = String(mapping.sourceFieldId || '').trim();
  return sourceType === 'total' ? 'total' : `blank:${fieldId}`;
};

const makeMappingId = () =>
  `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const getNotebookTargetLocks = async (
  courseId,
  { targetAssessmentIds = null, excludeNoteId = null } = {}
) => {
  const query = {
    course: courseId,
    type: 'evaluation',
    'markSyncMappings.0': { $exists: true },
  };

  if (excludeNoteId && isValidObjectId(excludeNoteId)) {
    query._id = { $ne: excludeNoteId };
  }

  if (Array.isArray(targetAssessmentIds) && targetAssessmentIds.length > 0) {
    query['markSyncMappings.targetAssessment'] = {
      $in: targetAssessmentIds.filter(isValidObjectId),
    };
  }

  const notes = await NotebookNote.find(query)
    .select('_id title markSyncMappings')
    .lean();

  return notes.flatMap((note) =>
    (note.markSyncMappings || []).map((mapping) => ({
      noteId: String(note._id),
      noteTitle: note.title || 'Evaluation Sheet',
      mappingId: String(mapping.id || ''),
      sourceType: mapping.sourceType || 'blank',
      sourceFieldId: mapping.sourceFieldId || '',
      sourceLabel: mapping.sourceLabel || '',
      targetAssessment: String(mapping.targetAssessment || ''),
      targetComponentKey: String(mapping.targetComponentKey || ''),
    }))
  );
};

const getSubmissionTargetLocks = async (courseId) => {
  const rows = await Assessment.find({
    course: courseId,
    structureType: 'lab_submission',
    'submissionConfig.linkedMarkAssessment': { $ne: null },
  })
    .select(
      '_id name submissionConfig.linkedMarkAssessment submissionConfig.linkedMarkComponentKey'
    )
    .lean();

  return rows.map((row) => ({
    sourceAssessmentId: String(row._id),
    sourceAssessmentName: row.name || 'Submission Assessment',
    targetAssessment: String(
      row?.submissionConfig?.linkedMarkAssessment || ''
    ),
    targetComponentKey: String(
      row?.submissionConfig?.linkedMarkComponentKey || ''
    ),
  }));
};

const buildSourceOptions = (note) => {
  const settings = note?.settings || {};
  const blankFields = Array.isArray(settings.blankFields)
    ? settings.blankFields
    : [];

  return [
    ...blankFields.map((field, index) => ({
      key: `blank:${String(field?.id || '')}`,
      sourceType: 'blank',
      sourceFieldId: String(field?.id || ''),
      label: String(field?.label || `Blank Field ${index + 1}`),
    })),
    {
      key: 'total',
      sourceType: 'total',
      sourceFieldId: '',
      label: 'Total (sum of all blank fields)',
    },
  ];
};

const formatTargetAssessments = (assessments = []) =>
  assessments.map((assessment) => ({
    id: String(assessment._id),
    _id: String(assessment._id),
    name: assessment.name || 'Assessment',
    fullMarks: Number(assessment.fullMarks || 0),
    structureType: assessment.structureType || 'regular',
    period:
      assessment?.structureType === 'lab_final'
        ? String(assessment?.labFinalConfig?.period || 'final')
        : '',
    components: getGenericComponents(assessment).map((component) => ({
      key: String(component?.key || ''),
      name: component?.name || 'Component',
      marks: Number(component?.marks || 0),
      order: Number(component?.order || 0),
      sourceType: String(component?.sourceType || 'manual'),
    })),
  }));

const getNotebookMarkSyncConfig = async (note) => {
  const courseId = getNoteCourseId(note);
  if (!courseId || !isValidObjectId(courseId)) {
    return {
      sourceOptions: buildSourceOptions(note),
      targetAssessments: [],
      mappings: [],
      locks: [],
    };
  }

  const [assessments, notebookLocks, submissionLocks] = await Promise.all([
    Assessment.find({
      course: courseId,
      $or: [
        { structureType: 'regular' },
        {
          structureType: 'lab_final',
          'labFinalConfig.mode': 'components',
        },
      ],
    })
      .sort({ order: 1, createdAt: 1 })
      .lean(),
    getNotebookTargetLocks(courseId, { excludeNoteId: note._id }),
    getSubmissionTargetLocks(courseId),
  ]);

  return {
    sourceOptions: buildSourceOptions(note),
    targetAssessments: formatTargetAssessments(assessments),
    mappings: (note.markSyncMappings || []).map((mapping) => ({
      id: String(mapping.id || ''),
      sourceType: mapping.sourceType || 'blank',
      sourceFieldId: mapping.sourceFieldId || '',
      sourceLabel: mapping.sourceLabel || '',
      targetAssessment: String(mapping.targetAssessment || ''),
      targetComponentKey: mapping.targetComponentKey || '',
    })),
    locks: [
      ...notebookLocks.map((lock) => ({
        ...lock,
        lockType: 'notebook',
        label: lock.noteTitle || 'Another evaluation sheet',
      })),
      ...submissionLocks.map((lock) => ({
        ...lock,
        lockType: 'submission',
        label: lock.sourceAssessmentName || 'Submission mapping',
      })),
    ],
  };
};

const sanitizeAndValidateMappings = async (note, rawMappings = []) => {
  if (note?.type !== 'evaluation') {
    const error = new Error(
      'Marks Sync is available only for evaluation sheets.'
    );
    error.statusCode = 400;
    throw error;
  }

  const courseId = getNoteCourseId(note);
  if (!courseId || !isValidObjectId(courseId)) {
    const error = new Error(
      'This evaluation sheet is not connected to a valid course.'
    );
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(rawMappings)) {
    const error = new Error('Mappings must be an array.');
    error.statusCode = 400;
    throw error;
  }

  const settings = note.settings || {};
  const blankFields = Array.isArray(settings.blankFields)
    ? settings.blankFields
    : [];
  const blankFieldMap = new Map(
    blankFields.map((field, index) => [
      String(field?.id || ''),
      {
        id: String(field?.id || ''),
        label: String(field?.label || `Blank Field ${index + 1}`),
      },
    ])
  );

  const cleaned = rawMappings.map((mapping) => {
    const sourceType =
      String(mapping?.sourceType || '').toLowerCase() === 'total'
        ? 'total'
        : 'blank';
    const sourceFieldId =
      sourceType === 'blank'
        ? String(mapping?.sourceFieldId || '').trim()
        : '';

    return {
      id: String(mapping?.id || '').trim() || makeMappingId(),
      sourceType,
      sourceFieldId,
      sourceLabel:
        sourceType === 'total'
          ? 'Total'
          : blankFieldMap.get(sourceFieldId)?.label ||
            String(mapping?.sourceLabel || '').trim(),
      targetAssessment: String(mapping?.targetAssessment || '').trim(),
      targetComponentKey: String(
        mapping?.targetComponentKey || ''
      ).trim(),
    };
  });

  const duplicateSource = cleaned.find(
    (mapping, index) =>
      cleaned.findIndex(
        (other) => mappingSourceKey(other) === mappingSourceKey(mapping)
      ) !== index
  );
  if (duplicateSource) {
    const error = new Error(
      'The same evaluation-sheet source can be mapped only once in this sheet.'
    );
    error.statusCode = 400;
    throw error;
  }

  const duplicateTarget = cleaned.find(
    (mapping, index) =>
      cleaned.findIndex(
        (other) => mappingTargetKey(other) === mappingTargetKey(mapping)
      ) !== index
  );
  if (duplicateTarget) {
    const error = new Error(
      'The same assessment destination can receive marks from only one source.'
    );
    error.statusCode = 400;
    throw error;
  }

  for (const mapping of cleaned) {
    if (
      mapping.sourceType === 'blank' &&
      !blankFieldMap.has(mapping.sourceFieldId)
    ) {
      const error = new Error(
        'One selected source field no longer exists in this evaluation sheet.'
      );
      error.statusCode = 400;
      throw error;
    }

    if (!isValidObjectId(mapping.targetAssessment)) {
      const error = new Error('Please select a target assessment.');
      error.statusCode = 400;
      throw error;
    }
  }

  const targetIds = Array.from(
    new Set(cleaned.map((mapping) => mapping.targetAssessment))
  );
  const [targets, externalNotebookLocks, submissionLocks] = await Promise.all([
    Assessment.find({
      _id: { $in: targetIds },
      course: courseId,
      structureType: { $ne: 'lab_submission' },
    }),
    getNotebookTargetLocks(courseId, {
      targetAssessmentIds: targetIds,
      excludeNoteId: note._id,
    }),
    getSubmissionTargetLocks(courseId),
  ]);

  const targetMap = new Map(
    targets.map((assessment) => [String(assessment._id), assessment])
  );

  for (const mapping of cleaned) {
    const target = targetMap.get(mapping.targetAssessment);
    if (!target) {
      const error = new Error(
        'One selected target assessment could not be found in this course.'
      );
      error.statusCode = 404;
      throw error;
    }

    if (target.structureType === 'lab_final') {
      const components = getGenericComponents(target);
      const component = components.find(
        (item) => String(item?.key || '') === mapping.targetComponentKey
      );

      if (!component) {
        const error = new Error(
          `Please select a valid component under “${target.name}”.`
        );
        error.statusCode = 400;
        throw error;
      }

      if (['submission', 'project'].includes(String(component.sourceType || ''))) {
        const error = new Error(
          `Component “${component.name}” is already reserved for ${
            component.sourceType === 'project' ? 'Project Sync' : 'Submission Sync'
          }.`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (mapping.targetComponentKey) {
      const error = new Error(
        `“${target.name}” is a regular assessment and does not use a component.`
      );
      error.statusCode = 400;
      throw error;
    }

    const targetKey = mappingTargetKey(mapping);
    const notebookConflict = externalNotebookLocks.find(
      (lock) => mappingTargetKey(lock) === targetKey
    );
    if (notebookConflict) {
      const error = new Error(
        `This destination is already synced from “${notebookConflict.noteTitle}”.`
      );
      error.statusCode = 400;
      throw error;
    }

    const submissionConflict = submissionLocks.find(
      (lock) => mappingTargetKey(lock) === targetKey
    );
    if (submissionConflict) {
      const error = new Error(
        `This destination is already synced from submission assessment “${submissionConflict.sourceAssessmentName}”.`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  return cleaned;
};

const calculateRowTotal = (row, settings = {}) => {
  const fields = Array.isArray(settings.blankFields)
    ? settings.blankFields
    : [];
  const values = fields
    .map((field) =>
      String(row?.blankValues?.[String(field?.id || '')] ?? '').trim()
    )
    .filter((value) => value !== '');

  if (!values.length) return { valid: false, reason: 'empty' };

  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    return { valid: false, reason: 'non_numeric' };
  }

  return {
    valid: true,
    value: round2(numbers.reduce((sum, value) => sum + value, 0)),
  };
};

const getSourceValue = (note, row, mapping) => {
  if (mapping.sourceType === 'total') {
    return calculateRowTotal(row, note.settings || {});
  }

  const raw = String(
    row?.blankValues?.[String(mapping.sourceFieldId || '')] ?? ''
  ).trim();

  if (!raw) return { valid: false, reason: 'empty' };

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { valid: false, reason: 'non_numeric' };
  }

  return { valid: true, value: round2(value) };
};

const syncNotebookMappings = async (note) => {
  const courseId = getNoteCourseId(note);
  const mappings = Array.isArray(note?.markSyncMappings)
    ? note.markSyncMappings
    : [];

  if (
    note?.type !== 'evaluation' ||
    !courseId ||
    !isValidObjectId(courseId) ||
    !mappings.length
  ) {
    return {
      updatedRecords: 0,
      skippedRows: 0,
      message: 'No saved notebook mark mapping was found.',
    };
  }

  const targetIds = Array.from(
    new Set(mappings.map((mapping) => String(mapping.targetAssessment || '')))
  ).filter(isValidObjectId);

  const [targets, enrollments] = await Promise.all([
    Assessment.find({
      _id: { $in: targetIds },
      course: courseId,
      structureType: { $ne: 'lab_submission' },
    }),
    Enrollment.find({ course: courseId })
      .populate('student', 'username name')
      .lean(),
  ]);

  const targetMap = new Map(
    targets.map((assessment) => [String(assessment._id), assessment])
  );
  const rollMap = new Map();
  enrollments.forEach((enrollment) => {
    const roll = normalizeRoll(enrollment?.student?.username);
    const studentId = enrollment?.student?._id;
    if (roll && studentId) rollMap.set(roll, String(studentId));
  });

  const rows = Array.isArray(note.evaluationRows) ? note.evaluationRows : [];
  const candidateEntries = [];
  const skippedDetails = [];

  mappings.forEach((mapping) => {
    const target = targetMap.get(String(mapping.targetAssessment || ''));
    if (!target) {
      skippedDetails.push({
        mappingId: String(mapping.id || ''),
        reason: 'Target assessment was not found.',
      });
      return;
    }

    let component = null;
    let limit = Number(target.fullMarks || 0);
    if (target.structureType === 'lab_final') {
      component = getGenericComponents(target).find(
        (item) =>
          String(item?.key || '') ===
          String(mapping.targetComponentKey || '')
      );
      if (!component) {
        skippedDetails.push({
          mappingId: String(mapping.id || ''),
          reason: 'Target component was not found.',
        });
        return;
      }
      if (['submission', 'project'].includes(String(component.sourceType || ''))) {
        skippedDetails.push({
          mappingId: String(mapping.id || ''),
          reason: 'Target component is managed by another sync system.',
        });
        return;
      }
      limit = Number(component.marks || 0);
    }

    rows.forEach((row) => {
      const roll = normalizeRoll(row?.roll);
      const studentId = rollMap.get(roll);
      if (!studentId) {
        skippedDetails.push({
          mappingId: String(mapping.id || ''),
          roll: row?.roll || '',
          reason: 'No enrolled student matched this roll number.',
        });
        return;
      }

      const source = getSourceValue(note, row, mapping);
      if (!source.valid) {
        if (source.reason !== 'empty') {
          skippedDetails.push({
            mappingId: String(mapping.id || ''),
            roll: row?.roll || '',
            reason: 'Source value is not numeric.',
          });
        }
        return;
      }

      const value = Number(source.value);
      if (!isHalfStepMark(value)) {
        skippedDetails.push({
          mappingId: String(mapping.id || ''),
          roll: row?.roll || '',
          reason: 'Marks must be whole numbers or .5 values.',
        });
        return;
      }

      if (value > limit) {
        skippedDetails.push({
          mappingId: String(mapping.id || ''),
          roll: row?.roll || '',
          reason: `Value ${value} is greater than the destination limit ${limit}.`,
        });
        return;
      }

      candidateEntries.push({
        studentId,
        target,
        componentKey:
          target.structureType === 'lab_final'
            ? String(mapping.targetComponentKey || '')
            : '',
        value: round2(value),
      });
    });
  });

  if (!candidateEntries.length) {
    return {
      updatedRecords: 0,
      skippedRows: skippedDetails.length,
      skippedDetails: skippedDetails.slice(0, 30),
      message: 'No valid numeric mark was available to sync.',
    };
  }

  const studentIds = Array.from(
    new Set(candidateEntries.map((entry) => entry.studentId))
  );
  const existingMarks = await Mark.find({
    course: courseId,
    student: { $in: studentIds },
    assessment: { $in: targetIds },
  }).lean();

  const existingMap = new Map(
    existingMarks.map((mark) => [
      `${String(mark.student)}:${String(mark.assessment)}`,
      mark,
    ])
  );
  const pendingMap = new Map();

  candidateEntries.forEach((entry) => {
    const assessmentId = String(entry.target._id);
    const key = `${entry.studentId}:${assessmentId}`;
    const existing = pendingMap.get(key) || existingMap.get(key) || null;

    if (entry.target.structureType === 'lab_final') {
      const subMarkMap = new Map(
        (existing?.subMarks || []).map((item) => [
          String(item?.key || ''),
          Number(item?.obtainedMarks || 0),
        ])
      );
      subMarkMap.set(entry.componentKey, entry.value);

      const configuredKeys = new Set(
        getGenericComponents(entry.target).map((component) =>
          String(component?.key || '')
        )
      );
      const subMarks = Array.from(subMarkMap.entries())
        .filter(([componentKey]) => configuredKeys.has(componentKey))
        .map(([componentKey, obtainedMarks]) => ({
          key: componentKey,
          obtainedMarks: round2(obtainedMarks),
        }));
      const obtainedMarks = round2(
        subMarks.reduce(
          (sum, item) => sum + Number(item.obtainedMarks || 0),
          0
        )
      );

      pendingMap.set(key, {
        studentId: entry.studentId,
        assessmentId,
        obtainedMarks,
        status: 'present',
        subMarks,
      });
    } else {
      pendingMap.set(key, {
        studentId: entry.studentId,
        assessmentId,
        obtainedMarks: entry.value,
        status: 'present',
        subMarks: [],
      });
    }
  });

  const bulkOps = Array.from(pendingMap.values()).map((entry) => ({
    updateOne: {
      filter: {
        course: courseId,
        student: entry.studentId,
        assessment: entry.assessmentId,
      },
      update: {
        $set: {
          course: courseId,
          student: entry.studentId,
          assessment: entry.assessmentId,
          obtainedMarks: entry.obtainedMarks,
          status: entry.status,
          subMarks: entry.subMarks,
        },
      },
      upsert: true,
    },
  }));

  if (bulkOps.length) await Mark.bulkWrite(bulkOps);

  return {
    updatedRecords: bulkOps.length,
    skippedRows: skippedDetails.length,
    skippedDetails: skippedDetails.slice(0, 30),
    message: `${bulkOps.length} student mark record${
      bulkOps.length === 1 ? '' : 's'
    } synchronized from the evaluation sheet.`,
  };
};

module.exports = {
  getNotebookMarkSyncConfig,
  getNotebookTargetLocks,
  sanitizeAndValidateMappings,
  syncNotebookMappings,
};
