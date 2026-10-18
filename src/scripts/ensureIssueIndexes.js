/**
 * Optional one-time deployment preparation for installations that disable
 * automatic Mongoose index creation in production.
 * Run: node src/scripts/ensureIssueIndexes.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
    await mongoose.connect(process.env.MONGO_URI);
    await Complaint.createIndexes();
    console.log("Issue de-duplication indexes are ready.");
  } catch (error) {
    console.error("Unable to create issue indexes:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
