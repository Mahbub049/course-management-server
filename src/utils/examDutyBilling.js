// Shared, local-calendar classification for both uploaded and live exam duties.
// Bangladesh university rule: Friday and Saturday are always evening-rate.
// On other days, duties starting no later than 5 PM are day-rate; duties
// starting at or after 5:45 PM are evening-rate. The intervening interval
// is deliberately flagged for review rather than silently misbilled.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutes(value) {
  const s = String(value || '').trim().toUpperCase();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] < 60)
    return (+m[1] % 12 + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2];
  const h = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return h ? +h[1] * 60 + +h[2] : null;
}
function category(row) {
  const iso = String(row?.date || '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  const day = date && !Number.isNaN(date.getTime()) ? DAY_NAMES[date.getUTCDay()] : String(row?.day || '').trim().slice(0,3);
  if (day === 'Fri' || day === 'Sat') return 'evening';
  const start = minutes(row?.startTime || '');
  if (start === null) return 'review';
  if (start <= 17 * 60) return 'day';
  if (start >= 17 * 60 + 45) return 'evening';
  return 'review';
}
module.exports = { classifyExamDuty: category, examDutyTimeMinutes: minutes };
