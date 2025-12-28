function normalizeUrl(u) {
  return (u || "").trim().replace(/\/$/, "");
}

async function startKeepAlive() {
  const base = normalizeUrl(process.env.SERVER_URL);
  if (!base) {
    console.warn("⚠️ SERVER_URL not set. Keep-alive disabled.");
    return;
  }

  const url = `${base}/api/health`;
  const intervalMs = 14 * 60 * 1000; // 14 minutes

  // keepalive-server uses ESM export, so in CommonJS we use dynamic import
  const { ping } = await import("keepalive-server");

  ping(intervalMs, url, 10_000); // 10s timeout

  console.log("🟢 keepalive-server started:", url, `every ${intervalMs}ms`);
}

module.exports = startKeepAlive;
