const assert = require('node:assert/strict');
const { classifyExamDuty } = require('../src/utils/examDutyBilling');
const examples = [
  ['2026-10-24','12:00 PM','evening','Saturday noon is evening'],
  ['2026-10-30','10:00 AM','evening','Friday morning is evening'],
  ['2026-10-25','12:00 PM','day','Sunday noon is day'],
  ['2026-10-26','5:00 PM','day','weekday 5 PM is day'],
  ['2026-10-26','5:01 PM','review','weekday 5:01 PM requires review'],
  ['2026-10-26','5:30 PM','review','weekday 5:30 PM requires review'],
  ['2026-10-26','5:45 PM','evening','weekday 5:45 PM is evening'],
  ['2026-10-26','7:00 PM','evening','weekday 7 PM is evening'],
];
for (const [date,startTime,expected,msg] of examples) assert.equal(classifyExamDuty({ date,startTime }),expected,msg);
console.log(`Exam duty time-band validation passed: ${examples.length} cases`);
