const Course = require("../models/Course");

async function clearExpiredIssueOverrides() {
  return Course.updateMany(
    { "complaintSettings.temporaryOverride.endAt": { $lte: new Date() } },
    { $set: { "complaintSettings.temporaryOverride": null } }
  );
}

function startIssueOverrideCleanup() {
  const run = () => clearExpiredIssueOverrides().catch((err) =>
    console.error("Issue access cleanup failed:", err));
  void run();
  // Access checks also evaluate the expiry timestamp directly (no delay in access).
  const timer = setInterval(run, 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = { clearExpiredIssueOverrides, startIssueOverrideCleanup };
