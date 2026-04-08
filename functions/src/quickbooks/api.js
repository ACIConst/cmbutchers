const { getValidToken } = require("./tokens");
const { defineString } = require("firebase-functions/params");

const QB_ENVIRONMENT = defineString("QB_ENVIRONMENT");

function getBaseUrl() {
  return QB_ENVIRONMENT.value() === "production"
    ? "https://quickbooks.api.intuit.com/v3/company"
    : "https://sandbox-quickbooks.api.intuit.com/v3/company";
}

/**
 * Map a QB HTTP status code to a clean, user-facing message.
 * Raw response bodies stay in logs only — never surfaced to the UI.
 */
function qbUserMessage(statusCode) {
  switch (statusCode) {
    case 400: return "Invalid request — check order data and try again";
    case 401: return "QuickBooks session expired — reconnect in Settings";
    case 403: return "QuickBooks access denied — check app permissions";
    case 429: return "QuickBooks rate limit reached — try again in a moment";
    case 500:
    case 503: return "QuickBooks is temporarily unavailable — try again shortly";
    default:  return `QuickBooks error (${statusCode}) — try again`;
  }
}

/**
 * Build a QB API error with intuit_tid for Intuit's support/assessment requirements.
 * intuit_tid is a transaction ID that Intuit uses to trace API calls in their system.
 * Raw response body is logged but NOT included in err.message (prevents leaking to UI).
 */
function buildQBError(method, endpoint, res, body) {
  const intuitTid = res.headers.get("intuit_tid") || "unknown";
  // Log full details for debugging; keep err.message clean for propagation
  console.error(`QB API ${method} ${endpoint} failed (${res.status}) [intuit_tid: ${intuitTid}]:`, body);
  const err = new Error(qbUserMessage(res.status));
  err.intuit_tid = intuitTid;
  err.statusCode = res.status;
  err.userMessage = qbUserMessage(res.status);
  return err;
}

/**
 * Make a GET request to the QuickBooks API.
 * @param {string} endpoint - e.g., "companyinfo/12345" or "query?query=SELECT..."
 */
async function qbGet(endpoint) {
  const { accessToken, realmId } = await getValidToken();
  const url = `${getBaseUrl()}/${realmId}/${endpoint}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw buildQBError("GET", endpoint, res, body);
  }
  return res.json();
}

/**
 * Make a POST request to the QuickBooks API.
 * @param {string} endpoint - e.g., "invoice" or "customer"
 * @param {object} body - JSON body to send
 */
async function qbPost(endpoint, body) {
  const { accessToken, realmId } = await getValidToken();
  const url = `${getBaseUrl()}/${realmId}/${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw buildQBError("POST", endpoint, res, errBody);
  }
  return res.json();
}

/**
 * Run a QuickBooks query (SQL-like).
 * @param {string} query - e.g., "SELECT * FROM Item WHERE Type = 'Inventory'"
 */
async function qbQuery(query) {
  const encoded = encodeURIComponent(query);
  return qbGet(`query?query=${encoded}`);
}

module.exports = { qbGet, qbPost, qbQuery };
