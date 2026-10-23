const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/ExamDutySession');
const Record = require('../models/ExamDutyRecord');
const Proxy = require('../models/ExamDutyProxy');
const Change = require('../models/ExamDutyChange');
const { classifyExamDuty } = require('../utils/examDutyBilling');

const clean = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const codes = (value) => [...new Set(clean(value, 350).toUpperCase().split(/[^A-Z0-9_-]+/).filter(Boolean).filter(v => !/^[-_]+$/.test(v)))];
const validId = (id) => mongoose.isValidObjectId(id);
const isoDate = (v) => /^20\d{2}-(0[1-9]|1[012])-(0[1-9]|[12]\d|3[01])$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const minute = (time) => {
  const m = clean(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m || Number(m[1]) > 12 || Number(m[1]) === 0 || Number(m[2]) > 59) return NaN;
  return (Number(m[1]) % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
};
const overlaps = (a, b) => a.date === b.date && minute(a.startTime) < minute(b.endTime) && minute(b.startTime) < minute(a.endTime);
const withType = (entry) => ({ ...entry, dutyType: classifyExamDuty(entry) });
const sortDuties = (a,b) => a.date.localeCompare(b.date) || minute(a.startTime) - minute(b.startTime) || a.room.localeCompare(b.room);
// The visible program label is a presentation detail, not an exam identity.
// Previous parser builds called the same program "Engineering Textile" and
// "B.Sc. in Textile Engineering", producing duplicate duties and false overlaps.
const identityPart = v => clean(v, 200).toUpperCase().replace(/\s+/g, '');
const dutyIdentity = r => [r.date, r.startTime, r.endTime, r.intake, r.section, r.course, r.room, r.category || 'exam'].map(identityPart).join('|');
const uniqueDuties = rows => {
  const byIdentity = new Map();
  for (const row of [...rows].sort((a,b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))) {
    const key = dutyIdentity(row);
    const old = byIdentity.get(key);
    // Prefer an official record over a proxy of the identical duty.
    if (!old || (old.assignment === 'proxy' && row.assignment === 'official')) byIdentity.set(key, row);
  }
  return [...byIdentity.values()].sort(sortDuties);
};

const sendError = (res, e) => { console.error('Exam duty error:', e); return res.status(500).json({ message: 'The exam duty request could not be completed.' }); };
async function faculty(req, res) {
  const user = await User.findOne({ _id: req.user.userId, role: 'teacher' }).select('name shortCode');
  if (!user) { res.status(403).json({ message: 'Teacher profile not found.' }); return null; }
  if (!clean(user.shortCode)) { res.status(422).json({ message: 'Please add your faculty short code to your profile before using Exam Duties.' }); return null; }
  return user;
}
async function getSession(id, res) {
  if (!validId(id)) { res.status(400).json({ message: 'Invalid exam session.' }); return null; }
  const session = await Session.findById(id).lean();
  if (!session) { res.status(404).json({ message: 'Exam session not found.' }); return null; }
  return session;
}
const upperCode = u => clean(u.shortCode, 20).toUpperCase();
const lockFor = (sessionId, row, code) => crypto.createHash('sha256')
  .update(`${sessionId}|${code}|${dutyIdentity(row)}`).digest('hex');
const isOutgoing = x => ['exchanged_out', 'transferred_out'].includes(x.assignment);
const isActive = x => !isOutgoing(x);
const conflictSummary = x => ({ _id: x._id, course: x.course, room: x.room, time: x.time, date: x.date });
const findTeacherByCode = code => User.findOne({role:'teacher',shortCode:new RegExp(`^${code}$`, 'i')}).select('name shortCode').lean();

// The faculty shortcode, not the portal account, identifies a duty owner.
// A peer may not have a User document yet, but their official duties and
// exchanges/transfers must still be queryable and visible if they register.
async function getMyRows(sessionId, teacher) {
  const code = upperCode(teacher);
  const owners = [{ fromCode: code }, { toCode: code }];
  if (teacher._id) owners.push({ fromUser: teacher._id }, { toUser: teacher._id });
  const [original, proxies, changes] = await Promise.all([
    Record.find({ session: sessionId, invigilatorCodes: code }).lean(),
    teacher._id ? Proxy.find({ session: sessionId, acceptedBy: teacher._id }).lean() : Promise.resolve([]),
    Change.find({ session: sessionId, status: 'active', $or: owners }).lean(),
  ]);
  const referenced = [...new Set(changes.flatMap(c => [c.fromRecord, c.toRecord].filter(Boolean).map(String)))];
  const [proxyRows, changedRows] = await Promise.all([
    Record.find({ _id: { $in: proxies.map(x => x.record) }, session: sessionId }).lean(),
    Record.find({ _id: { $in: referenced }, session: sessionId }).lean(),
  ]);
  const refMap = new Map(changedRows.map(x => [String(x._id), x]));
  const outgoing = new Map(), incoming = [];
  for (const c of changes) {
    const iAmFrom = c.fromCode === code || (Boolean(teacher._id) && String(c.fromUser) === String(teacher._id));
    const myOutgoing = refMap.get(String(iAmFrom ? c.fromRecord : c.toRecord));
    const myIncoming = refMap.get(String(iAmFrom ? c.toRecord : c.fromRecord));
    const other = iAmFrom ? c.toCode : c.fromCode;
    if (myOutgoing) outgoing.set(dutyIdentity(myOutgoing), {
      assignment: c.kind === 'exchange' ? 'exchanged_out' : 'transferred_out',
      changeId: c._id, changeKind: c.kind, changeSide: 'outgoing', counterpartyCode: other,
    });
    if (myIncoming) incoming.push({ ...myIncoming,
      assignment: c.kind === 'exchange' ? 'exchange' : 'transfer',
      changeId: c._id, changeKind: c.kind, changeSide: 'incoming', counterpartyCode: other,
    });
  }
  const base = original.map(x => ({ ...x, assignment: 'official', ...outgoing.get(dutyIdentity(x)) }));
  const proxied = proxyRows.filter(x => !original.some(o => dutyIdentity(o) === dutyIdentity(x)))
    .map(x => ({ ...x, assignment: 'proxy', originalCode: proxies.find(p => String(p.record) === String(x._id))?.originalCode || '' }));
  const all = uniqueDuties([...base, ...proxied, ...incoming].map(withType));
  // Ghost rows stay visible for Revert but do not occupy the teacher's schedule.
  const active = all.filter(isActive);
  return all.map(row => ({ ...row, conflicts: isOutgoing(row) ? [] : active.filter(o => dutyIdentity(o) !== dutyIdentity(row) && overlaps(row, o)).map(conflictSummary) }));
}

exports.listSessions = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const sessions = await Session.find().sort({ year: -1, createdAt: -1 }).limit(60).lean();
    const enriched = await Promise.all(sessions.map(async s => ({ ...s,
      canDelete: Boolean(s.importedBy && String(s.importedBy) === String(teacher._id)),
      totalRows: await Record.countDocuments({ session: s._id }),
      myOfficial: (await getMyRows(s._id, teacher)).filter(x => isActive(x) && x.assignment !== 'proxy').length,
      myProxies: await Proxy.countDocuments({ session: s._id, acceptedBy: teacher._id }),
    })));
    return res.json({ sessions: enriched, faculty: { name: teacher.name, shortCode: teacher.shortCode } });
  } catch (e) { return sendError(res, e); }
};

exports.importRows = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const { season, year, examType, name, rows, sources = [] } = req.body || {};
    if (!['Spring','Summer','Fall'].includes(season) || !Number.isInteger(Number(year)) || +year < 2020 || +year > 2100 || !['Mid Term','Final','Supplementary Mid','Supplementary Final','Improvement','Other'].includes(examType)) return res.status(400).json({ message: 'Choose a valid semester, year, and examination.' });
    if (!clean(name)) return res.status(400).json({ message: 'Enter a name for this exam duty list.' });
    if (!Array.isArray(rows) || !rows.length || rows.length > 2500) return res.status(400).json({ message: 'Import between 1 and 2500 recognized rows per batch.' });
    const normalized = [];
    const errors = [];
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') return errors.push(i+1);
      const category = ['exam','reserved','support'].includes(row.category) ? row.category : 'exam';
      const data = {
        date: clean(row.date, 10), day: clean(row.day, 14), startTime: clean(row.startTime, 12), endTime: clean(row.endTime, 12),
        program: clean(row.program, 100), intake: clean(row.intake, 65), section: clean(row.section, 35), course: clean(row.course, 90),
        courseTeacher: clean(row.courseTeacher, 40), invigilators: clean(row.invigilators, 350), room: clean(row.room, 90),
        sourceFile: clean(row.sourceFile, 180), sourcePage: Math.max(0, Math.min(1000, Number(row.sourcePage) || 0)), category,
      };
      data.invigilatorCodes = codes(data.invigilators);
      data.time = `${data.startTime} – ${data.endTime}`;
      if (!isoDate(data.date) || !Number.isFinite(minute(data.startTime)) || !Number.isFinite(minute(data.endTime)) || minute(data.endTime) <= minute(data.startTime) || (!data.course && category === 'exam')) return errors.push(i+1);
      // A natural row key prevents duplicates across different PDFs and repeated imports.
      data.fingerprint = crypto.createHash('sha256').update(dutyIdentity(data)).digest('hex');
      normalized.push(data);
    });
    if (errors.length) return res.status(422).json({ message: `Review ${errors.length} incomplete row(s) before saving: ${errors.slice(0, 15).join(', ')}${errors.length > 15 ? '…' : ''}.`, invalidRows: errors });
    // A semester/exam is a SINGLE shared routine. Other teachers see it automatically
    // using their saved profile shortcode; they cannot silently overwrite its rows.
    const existingSession = await Session.findOne({ season, year: +year, examType }).select('_id importedBy').lean();
    if (existingSession && String(existingSession.importedBy || '') !== String(teacher._id)) {
      return res.status(403).json({ message: 'This shared examination routine was uploaded by another teacher. Your own duties are already available automatically; contact the original uploader to update it.' });
    }
    const session = await Session.findOneAndUpdate({ season, year: +year, examType }, {
      $setOnInsert: { name: clean(name, 120), importedBy: teacher._id },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const seen = new Map(normalized.map(x => [x.fingerprint, x]));
    const docs = [...seen.values()];
    // Do not erase existing sources when importing another program's PDF.
    const ops = docs.map(x => ({ updateOne: { filter: { session: session._id, fingerprint: x.fingerprint }, update: { $set: { ...x, importedBy: teacher._id } }, upsert: true } }));
    await Record.bulkWrite(ops, { ordered: false });
    const files = (Array.isArray(sources) ? sources : []).slice(0, 12).map(s => ({ name: clean(s.name, 180), rows: Math.max(0, Number(s.rows) || 0), importedAt: new Date(), importedBy: teacher._id })).filter(s => s.name);
    if (files.length) {
      // Avoid displaying the same source PDF multiple times after an update.
      await Session.updateOne({ _id: session._id }, { $pull: { sourceFiles: { name: { $in: files.map(f => f.name) } } } });
      await Session.updateOne({ _id: session._id }, { $push: { sourceFiles: { $each: files, $slice: -40 } } });
    }
    return res.status(201).json({ sessionId: session._id, imported: docs.length, skippedDuplicates: normalized.length - docs.length, totalRows: await Record.countDocuments({ session: session._id }) });
  } catch (e) { if (e?.code === 11000) return res.status(409).json({ message: 'A simultaneous import was detected. Please refresh and try again.' }); return sendError(res, e); }
};

// Delete the ENTIRE shared routine (all imported PDFs/records) only by its uploader.
// Proxies reference stored rows, so they are removed as well to prevent dangling links.
// This endpoint intentionally does not touch bills or faculty profiles.
exports.deleteSession = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid examination routine.' });
    const session = await Session.findById(req.params.id).select('_id season year examType importedBy').lean();
    if (!session) return res.status(404).json({ message: 'Examination routine not found.' });
    if (!session.importedBy || String(session.importedBy) !== String(teacher._id)) {
      return res.status(403).json({ message: 'Only the teacher who uploaded this shared routine can delete it.' });
    }
    if (req.body?.confirm !== `${session.season} ${session.year} ${session.examType}`) {
      return res.status(400).json({ message: 'The deletion confirmation does not match this examination.' });
    }
    // Destructive DB actions are intentionally scoped strictly to the selected session.
    const changes = await Change.deleteMany({ session: session._id });
    const proxies = await Proxy.deleteMany({ session: session._id });
    const records = await Record.deleteMany({ session: session._id });
    await Session.deleteOne({ _id: session._id, importedBy: teacher._id });
    return res.json({ message: 'Shared examination routine deleted.', deletedRecords: records.deletedCount, deletedProxies: proxies.deletedCount, deletedChanges: changes.deletedCount });
  } catch (e) { return sendError(res, e); }
};

// Course teaching is separate from invigilation. A teacher may supervise an
// examination without having been assigned as its invigilator. Read the shared
// routine by courseTeacher shortcode; do not include these rows in duty/billing.
async function getOwnCourseExams(sessionId, teacher) {
  const code = upperCode(teacher);
  // Prefilter in MongoDB, then verify complete tokens: MM is not MMSS, etc.
  const safeCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const possible = await Record.find({
    session: sessionId,
    category: 'exam',
    courseTeacher: new RegExp(safeCode, 'i'),
  }).lean();
  return uniqueDuties(possible.filter(row => codes(row.courseTeacher).includes(code)));
}

exports.mySchedule = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    const [rows, courseExams] = await Promise.all([
      getMyRows(session._id, teacher),
      getOwnCourseExams(session._id, teacher),
    ]);
    return res.json({ session, faculty: { name: teacher.name, shortCode: teacher.shortCode }, rows, courseExams, officialCount: rows.filter(x => x.assignment === 'official').length, proxyCount: rows.filter(x => x.assignment === 'proxy').length, incomingChanges: rows.filter(x => x.changeSide === 'incoming').length });
  } catch (e) { return sendError(res, e); }
};

exports.searchFaculty = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    const code = clean(req.query.code, 20).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return res.status(400).json({ message: 'Enter a valid faculty short code (at least two characters).' });
    if (code === clean(teacher.shortCode).toUpperCase()) return res.status(400).json({ message: 'Enter another faculty member’s short code to find their duties.' });
    const rows = uniqueDuties((await Record.find({ session: session._id, invigilatorCodes: code }).sort({ date: 1, startTime: 1, room: 1 }).limit(1000).lean()).map(withType));
    const mine = await getMyRows(session._id, teacher);
    const peer = await findTeacherByCode(code);
    // Even without an account, the routine can contain this faculty's code.
    // Include prior incoming/outgoing changes when checking their availability.
    const peerRows = await getMyRows(session._id, peer || { shortCode: code });
    const chosen = new Set(mine.filter(isActive).map(dutyIdentity));
    const unavailable = new Set(peerRows.filter(isOutgoing).map(dutyIdentity));
    return res.json({ code, faculty: peer ? {name: peer.name, shortCode: peer.shortCode} : null,
      peerSchedule: peerRows.map(r => ({ _id:r._id, date:r.date, startTime:r.startTime, endTime:r.endTime, time:r.time, course:r.course, room:r.room, assignment:r.assignment })),
      rows: rows.map(x => ({ ...x, alreadyAdded: chosen.has(dutyIdentity(x)), unavailable: unavailable.has(dutyIdentity(x)),
        conflicts: mine.filter(o => isActive(o) && dutyIdentity(o) !== dutyIdentity(x) && overlaps(x, o)).map(conflictSummary) })) });
  } catch (e) { return sendError(res, e); }
};

exports.addProxy = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    if (!validId(req.body?.recordId)) return res.status(400).json({ message: 'Invalid duty selection.' });
    const row = await Record.findOne({ _id: req.body.recordId, session: session._id }).lean();
    if (!row) return res.status(404).json({ message: 'This duty is no longer available.' });
    const code = clean(req.body?.originalCode, 20).toUpperCase();
    if (!code || code === clean(teacher.shortCode).toUpperCase() || !row.invigilatorCodes.includes(code)) return res.status(400).json({ message: 'Select a duty belonging to the searched faculty.' });
    const mine = await getMyRows(session._id, teacher);
    if (mine.some(x => dutyIdentity(x) === dutyIdentity(row))) return res.status(409).json({ message: 'This duty is already in your schedule.' });
    const conflicts = mine.filter(x => overlaps(row, x)).map(x => ({ date: x.date, time: x.time, course: x.course, room: x.room }));
    if (conflicts.length && req.body?.allowConflict !== true) return res.status(409).json({ code: 'DUTY_CONFLICT', message: 'You already have a duty at an overlapping date and time.', conflicts });
    await Proxy.create({ session: session._id, record: row._id, acceptedBy: teacher._id, originalCode: code, conflictAcknowledged: conflicts.length > 0 });
    return res.status(201).json({ message: 'Proxy duty added.', conflicts });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ message: 'This proxy duty is already in your schedule.' }); return sendError(res, e); }
};

exports.removeProxy = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    if (!validId(req.params.recordId)) return res.status(400).json({ message: 'Invalid duty ID.' });
    const deleted = await Proxy.findOneAndDelete({ session: session._id, record: req.params.recordId, acceptedBy: teacher._id });
    return deleted ? res.json({ message: 'Proxy removed.' }) : res.status(404).json({ message: 'This proxy was not found in your list.' });
  } catch (e) { return sendError(res, e); }
};

// A change applies immediately to BOTH faculty schedules. The published PDF
// assignments are immutable. Any participant can revert the change.
exports.createChange = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    const { kind, sourceRecordId, targetRecordId, targetCode, allowConflict } = req.body || {};
    if (!['exchange','transfer'].includes(kind) || !validId(sourceRecordId) || (kind === 'exchange' && !validId(targetRecordId)))
      return res.status(400).json({message:'Select a valid original duty and exchange/transfer action.'});
    const fromCode = upperCode(teacher), toCode = clean(targetCode,20).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(toCode) || fromCode === toCode)
      return res.status(400).json({message:'Choose another faculty shortcode.'});
    // The target's portal account is optional; PDF faculty shortcodes are valid.
    const targetUser = await findTeacherByCode(toCode);
    if (targetUser && String(targetUser._id) === String(teacher._id))
      return res.status(400).json({message:'You cannot exchange or transfer a duty to yourself.'});
    const [from, to] = await Promise.all([
      Record.findOne({_id:sourceRecordId,session:session._id}).lean(),
      kind === 'exchange' ? Record.findOne({_id:targetRecordId,session:session._id}).lean() : Promise.resolve(null),
    ]);
    if (!from || !from.invigilatorCodes.includes(fromCode))
      return res.status(403).json({message:'You may only exchange or transfer a duty assigned to your faculty shortcode in the published routine.'});
    if (kind === 'exchange' && (!to || !to.invigilatorCodes.includes(toCode) || dutyIdentity(from) === dutyIdentity(to)))
      return res.status(400).json({message:'Choose a different original duty assigned to the other teacher.'});
    if (from.invigilatorCodes.includes(toCode) || (to && to.invigilatorCodes.includes(fromCode)))
      return res.status(409).json({message:'This duty is already assigned to one of the exchange participants; choose different duties.'});
    const locks = [lockFor(session._id,from,fromCode), ...(to ? [lockFor(session._id,to,toCode)] : [])];
    if (await Change.exists({session:session._id,status:'active',locks:{$in:locks}}))
      return res.status(409).json({code:'DUTY_ALREADY_MOVED',message:'One of these duties has already been exchanged or transferred. Refresh the list.'});
    const [mine, theirs] = await Promise.all([
      getMyRows(session._id, teacher),
      getMyRows(session._id, targetUser || { shortCode: toCode }),
    ]);
    const sourceKey = dutyIdentity(from), targetKey = to && dutyIdentity(to);
    if (!mine.some(x=>dutyIdentity(x) === sourceKey && x.assignment === 'official'))
      return res.status(409).json({message:'Your original duty is no longer available for reassignment.'});
    if (to && !theirs.some(x=>dutyIdentity(x) === targetKey && x.assignment === 'official'))
      return res.status(409).json({message:'The selected faculty duty is no longer available for exchange.'});
    // Don't assign a record to someone who already has that same examination
    // through a proxy, transfer or official invigilation assignment.
    if (theirs.some(x=>isActive(x) && dutyIdentity(x) === sourceKey)
      || (to && mine.some(x=>isActive(x) && dutyIdentity(x) === targetKey)))
      return res.status(409).json({message:'This examination duty is already in one of the recipient schedules.'});
    // After an exchange the original slots are vacated first, so they are not conflicts.
    const mineConflicts = to ? mine.filter(x=>isActive(x) && dutyIdentity(x)!==sourceKey && overlaps(x,to)).map(conflictSummary) : [];
    const theirConflicts = theirs.filter(x=>isActive(x) && (!to || dutyIdentity(x)!==targetKey) && overlaps(x,from)).map(conflictSummary);
    if (mineConflicts.length || theirConflicts.length) {
      if (allowConflict !== true) return res.status(409).json({code:'DUTY_CONFLICT',
        message:'One or both teachers have an overlapping duty. Review both schedules before proceeding.',
        mineConflicts, theirConflicts });
    }
    const created = await Change.create({session:session._id,kind,fromRecord:from._id,toRecord:to?to._id:null,
      fromUser:teacher._id,toUser:targetUser?._id || null,fromCode,toCode,locks,
      conflictAcknowledged:mineConflicts.length>0||theirConflicts.length>0});
    return res.status(201).json({message: kind==='exchange'?'Duty exchange saved for both faculty shortcodes.':'Duty transfer saved for the recipient faculty shortcode.',
      changeId:created._id, recipientHasAccount:Boolean(targetUser), mineConflicts,theirConflicts});
  } catch(e) {
    if(e?.code===11000) return res.status(409).json({code:'DUTY_ALREADY_MOVED',message:'This duty was reassigned in another request. Refresh and try again.'});
    return sendError(res,e);
  }
};

exports.revertChange = async (req, res) => {
  try {
    const teacher = await faculty(req, res); if (!teacher) return;
    const session = await getSession(req.params.id, res); if (!session) return;
    if (!validId(req.params.changeId)) return res.status(400).json({message:'Invalid exchange/transfer reference.'});
    const reverted = await Change.findOneAndUpdate({ _id:req.params.changeId, session:session._id,
      status:'active', $or:[{fromCode:upperCode(teacher)},{toCode:upperCode(teacher)},
        {fromUser:teacher._id},{toUser:teacher._id}] },
      {$set:{status:'reverted',revertedAt:new Date(),revertedBy:teacher._id}}, {new:true});
    if(!reverted) return res.status(404).json({message:'Active exchange/transfer not found, or you are not one of its participants.'});
    return res.json({message:'Original official duties restored for both faculty members.'});
  } catch(e) { return sendError(res,e); }
};

// Reuse the exact effective faculty schedule for live billing (no duplicate business rules).
exports.getFacultyDutyRows = getMyRows;
