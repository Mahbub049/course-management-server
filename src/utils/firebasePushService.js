const crypto = require("crypto");
const UserNotificationPreference = require("../models/UserNotificationPreference");

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;
let warnedMissingConfig = false;

function firebaseEnv() {
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || "").trim(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/\\n/g, "\n")
      .trim(),
  };
}

function isFirebasePushConfigured() {
  const { projectId, clientEmail, privateKey } = firebaseEnv();
  return Boolean(projectId && clientEmail && privateKey);
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createServiceAccountJwt() {
  const { clientEmail, privateKey } = firebaseEnv();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsigned}.${signature}`;
}

async function getGoogleAccessToken() {
  if (!isFirebasePushConfigured()) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "FCM push is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY on the server."
      );
    }
    return "";
  }

  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const assertion = createServiceAccountJwt();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Google OAuth failed with ${response.status}`
    );
  }

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function normalizeData(data = {}) {
  return Object.entries(data).reduce((result, [key, value]) => {
    if (value === undefined || value === null) return result;
    result[key] = typeof value === "string" ? value : String(value);
    return result;
  }, {});
}

function preferenceAllowsCategory(preference, category) {
  if (!preference || preference.enabled === false) return false;
  if (!category) return true;
  return preference.categories?.[category] !== false;
}

function isInvalidRegistrationResponse(responseBody = {}) {
  const status = String(responseBody?.error?.status || "");
  const message = String(responseBody?.error?.message || "").toLowerCase();
  const detailCodes = Array.isArray(responseBody?.error?.details)
    ? responseBody.error.details.map((detail) => String(detail?.errorCode || ""))
    : [];

  return (
    status === "NOT_FOUND" ||
    detailCodes.includes("UNREGISTERED") ||
    (status === "INVALID_ARGUMENT" && /registration token|fcm token/.test(message))
  );
}

async function removeInvalidTokens(tokens = []) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) return;

  try {
    await UserNotificationPreference.updateMany(
      { "deviceTokens.token": { $in: uniqueTokens } },
      { $pull: { deviceTokens: { token: { $in: uniqueTokens } } } }
    );
  } catch (error) {
    console.error("Could not remove invalid FCM device tokens:", error);
  }
}

async function getEligiblePreferences(userIds = [], category = "") {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  if (!ids.length) return [];

  const preferences = await UserNotificationPreference.find({
    user: { $in: ids },
    enabled: { $ne: false },
    "deviceTokens.0": { $exists: true },
  }).lean();

  return preferences.filter((preference) =>
    preferenceAllowsCategory(preference, category)
  );
}

async function sendOneFcmMessage(accessToken, target, payload) {
  const { projectId } = firebaseEnv();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: target.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data,
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "marks_portal_reminders",
              icon: "ic_stat_bubt",
              color: "#4F46E5",
              sound: "default",
              tag: payload.tag,
            },
          },
        },
      }),
    }
  );

  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body,
    token: target.token,
  };
}

async function sendPushToPreferences(
  preferences = [],
  { title, body, data = {}, tag = "marks-portal", category = "" } = {}
) {
  if (!isFirebasePushConfigured()) {
    return { configured: false, successCount: 0, failureCount: 0, targetCount: 0 };
  }

  const targets = [];
  for (const preference of preferences) {
    if (!preferenceAllowsCategory(preference, category)) continue;
    for (const device of preference.deviceTokens || []) {
      if (!device?.token) continue;
      targets.push({ token: device.token, userId: String(preference.user) });
    }
  }

  if (!targets.length) {
    return { configured: true, successCount: 0, failureCount: 0, targetCount: 0 };
  }

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return { configured: false, successCount: 0, failureCount: 0, targetCount: targets.length };
  }

  const payload = {
    title: String(title || "BUBT Marks Portal"),
    body: String(body || "You have a new portal notification."),
    data: normalizeData(data),
    tag: String(tag || "marks-portal").slice(0, 100),
  };

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  // Keep concurrency moderate so a university-wide event does not create an
  // unnecessary burst of outbound connections from the Render server.
  for (let start = 0; start < targets.length; start += 20) {
    const chunk = targets.slice(start, start + 20);
    const results = await Promise.all(
      chunk.map((target) =>
        sendOneFcmMessage(accessToken, target, payload).catch((error) => ({
          ok: false,
          status: 0,
          body: { error: { message: error?.message || String(error) } },
          token: target.token,
        }))
      )
    );

    for (const result of results) {
      if (result.ok) {
        successCount += 1;
        continue;
      }

      failureCount += 1;
      if (isInvalidRegistrationResponse(result.body)) invalidTokens.push(result.token);
      console.warn(
        "FCM delivery failed:",
        result.status,
        result.body?.error?.status || "",
        result.body?.error?.message || ""
      );
    }
  }

  await removeInvalidTokens(invalidTokens);

  return {
    configured: true,
    successCount,
    failureCount,
    targetCount: targets.length,
  };
}

async function sendPushToUserIds(
  userIds = [],
  { title, body, data = {}, tag = "marks-portal", category = "" } = {}
) {
  if (!isFirebasePushConfigured()) {
    return { configured: false, successCount: 0, failureCount: 0, targetCount: 0 };
  }

  const preferences = await getEligiblePreferences(userIds, category);
  return sendPushToPreferences(preferences, {
    title,
    body,
    data,
    tag,
    category,
  });
}

module.exports = {
  getEligiblePreferences,
  isFirebasePushConfigured,
  sendPushToPreferences,
  sendPushToUserIds,
};
