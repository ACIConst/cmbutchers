const { getFirestore } = require("firebase-admin/firestore");
const { createOAuthClient } = require("./auth");
const { encrypt, decrypt } = require("./crypto");

/**
 * Refresh the QuickBooks access token.
 *
 * Access tokens expire every 60 minutes. This function:
 * 1. Reads and decrypts the current refresh token from Firestore
 * 2. Exchanges it for a new access + refresh token pair
 * 3. Encrypts and stores the new tokens
 *
 * IMPORTANT: QuickBooks rotates the refresh token on every refresh call.
 * The old refresh token becomes invalid immediately.
 * If this write fails, you lose access — that's why we update atomically.
 */
async function refreshToken(req, res) {
  const db = getFirestore();

  try {
    const doc = await db.collection("qbTokens").doc("current").get();
    if (!doc.exists) {
      res.status(400).json({ error: "No QuickBooks connection found" });
      return;
    }

    const stored = doc.data();

    // Check if refresh token itself has expired (101 days)
    if (Date.now() > stored.refreshExpiresAt) {
      res.status(401).json({
        error: "Refresh token expired — admin must reconnect QuickBooks",
      });
      return;
    }

    const oauthClient = createOAuthClient();
    oauthClient.setToken({ refresh_token: decrypt(stored.refreshToken) });

    const authResponse = await oauthClient.refresh();
    const tokens = authResponse.getJson();

    // Atomically update both tokens (encrypted)
    await db.collection("qbTokens").doc("current").update({
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt: Date.now() + tokens.expires_in * 1000,
      refreshExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
      updatedAt: Date.now(),
    });

    res.json({ success: true, expiresIn: tokens.expires_in });
  } catch (err) {
    console.error("QuickBooks token refresh error:", err);
    res.status(500).json({ error: "Token refresh failed" });
  }
}

/**
 * Helper: get a valid access token, refreshing if needed.
 * Use this in any function that calls the QuickBooks API.
 */
async function getValidToken() {
  const db = getFirestore();
  const doc = await db.collection("qbTokens").doc("current").get();

  if (!doc.exists) {
    throw new Error("No QuickBooks connection — admin must connect first");
  }

  const stored = doc.data();

  // If access token expires within 5 minutes, refresh proactively
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (Date.now() > stored.expiresAt - FIVE_MINUTES) {
    const oauthClient = createOAuthClient();
    oauthClient.setToken({ refresh_token: decrypt(stored.refreshToken) });

    const authResponse = await oauthClient.refresh();
    const tokens = authResponse.getJson();

    await db.collection("qbTokens").doc("current").update({
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt: Date.now() + tokens.expires_in * 1000,
      refreshExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
      updatedAt: Date.now(),
    });

    return { accessToken: tokens.access_token, realmId: decrypt(stored.realmId) };
  }

  return { accessToken: decrypt(stored.accessToken), realmId: decrypt(stored.realmId) };
}

module.exports = { refreshToken, getValidToken };
