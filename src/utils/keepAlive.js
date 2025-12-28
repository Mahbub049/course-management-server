const cron = require("node-cron");
const axios = require("axios");

const SERVER_URL = (process.env.SERVER_URL || "").replace(/\/$/, ""); // ✅ removes trailing /

function startKeepAlive() {
  if (!SERVER_URL) {
    console.warn("⚠️ SERVER_URL not set. Keep-alive disabled.");
    return;
  }

  cron.schedule("*/14 * * * *", async () => {
    try {
      const res = await axios.get(`${SERVER_URL}/api/health`);
      console.log("✅ Keep-alive ping:", res.status);
    } catch (err) {
      const status = err?.response?.status;
      console.error("❌ Keep-alive failed:", status ? `HTTP ${status}` : err.message);
    }
  });

  console.log("🟢 Keep-alive cron started:", `${SERVER_URL}/api/health`);
}

module.exports = startKeepAlive;
