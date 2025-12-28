const cron = require("node-cron");
const axios = require("axios");

const SERVER_URL = process.env.SERVER_URL; 
// example: https://your-backend.onrender.com

function startKeepAlive() {
  if (!SERVER_URL) {
    console.warn("⚠️ SERVER_URL not set. Keep-alive disabled.");
    return;
  }

  // Every 14 minutes
  cron.schedule("*/14 * * * *", async () => {
    try {
      const res = await axios.get(`${SERVER_URL}/api/health`);
      console.log("✅ Keep-alive ping:", res.status);
    } catch (err) {
      console.error("❌ Keep-alive failed:", err.message);
    }
  });

  console.log("🟢 Keep-alive cron started");
}

module.exports = startKeepAlive;
