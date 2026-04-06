const OAuthClient = require("intuit-oauth");
const { getFirestore } = require("firebase-admin/firestore");
const { defineString } = require("firebase-functions/params");
const { encrypt, decrypt } = require("./crypto");

// These are set via: firebase functions:secrets:set QB_CLIENT_ID, etc.
const QB_CLIENT_ID = defineString("QB_CLIENT_ID");
const QB_CLIENT_SECRET = defineString("QB_CLIENT_SECRET");
const QB_REDIRECT_URI = defineString("QB_REDIRECT_URI");
const QB_ENVIRONMENT = defineString("QB_ENVIRONMENT"); // "sandbox" or "production"
const QB_APP_URL = defineString("QB_APP_URL"); // Your frontend URL (e.g., https://testing-and-development-f696f.web.app)

function createOAuthClient() {
  return new OAuthClient({
    clientId: QB_CLIENT_ID.value(),
    clientSecret: QB_CLIENT_SECRET.value(),
    environment: QB_ENVIRONMENT.value(),
    redirectUri: QB_REDIRECT_URI.value(),
  });
}

/**
 * Step 1: Generate the QuickBooks authorization URL and redirect the admin.
 * The admin clicks "Connect to QuickBooks" in the settings page,
 * which calls this function. It redirects them to Intuit's login page.
 */
async function authUri(req, res) {
  const oauthClient = createOAuthClient();
  const crypto = require("crypto");
  // Generate a random CSRF token and store it in Firestore (short-lived)
  const csrfToken = crypto.randomBytes(32).toString("hex");
  await getFirestore().collection("qbTokens").doc("csrf").set({
    token: csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: csrfToken,
  });

  res.redirect(authUri);
}

/**
 * Step 2: Handle the callback from QuickBooks after admin approves.
 * QuickBooks redirects here with an authorization code.
 * We exchange it for access + refresh tokens and store them encrypted.
 */
async function callback(req, res) {
  const oauthClient = createOAuthClient();

  try {
    // Verify CSRF token
    const stateParam = new URL(req.url, `https://${req.headers.host}`).searchParams.get("state");
    const csrfDoc = await getFirestore().collection("qbTokens").doc("csrf").get();

    if (!csrfDoc.exists || csrfDoc.data().token !== stateParam || Date.now() > csrfDoc.data().expiresAt) {
      console.error("OAuth CSRF verification failed");
      const appUrl = QB_APP_URL.value();
      res.redirect(`${appUrl}/admin?qb=error`);
      return;
    }

    // Clean up CSRF token (one-time use)
    await getFirestore().collection("qbTokens").doc("csrf").delete().catch(() => {});

    const authResponse = await oauthClient.createToken(req.url);
    const tokens = authResponse.getJson();

    // realmId comes from the URL query string, not the token response
    const realmId = new URL(req.url, `https://${req.headers.host}`).searchParams.get("realmId") || tokens.realmId || "";

    // Store tokens encrypted in Firestore
    await getFirestore().collection("qbTokens").doc("current").set({
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      realmId: encrypt(realmId),
      tokenType: tokens.token_type,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      refreshExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Write public connection status (no tokens!) so admin UI can show status
    await getFirestore().collection("kioskConfig").doc("qbConnection").set({
      connected: true,
      realmId: realmId,
      connectedAt: Date.now(),
    });

    // Redirect back to admin settings with success indicator
    const appUrl = QB_APP_URL.value();
    res.redirect(`${appUrl}/admin?qb=connected`);
  } catch (err) {
    console.error("QuickBooks OAuth callback error:", err);
    const appUrl = QB_APP_URL.value();
    res.redirect(`${appUrl}/admin?qb=error`);
  }
}

/**
 * Disconnect: revoke tokens and remove from Firestore.
 * Called when admin clicks "Disconnect QuickBooks" in settings.
 */
async function disconnect(req, res) {
  const oauthClient = createOAuthClient();
  const db = getFirestore();

  try {
    const doc = await db.collection("qbTokens").doc("current").get();

    // Try to revoke with QB, but don't block cleanup if it fails
    if (doc.exists) {
      try {
        const plainToken = decrypt(doc.data().accessToken);
        oauthClient.setToken({ access_token: plainToken });
        await oauthClient.revoke({ access_token: plainToken });
      } catch (revokeErr) {
        console.warn("QB token revocation failed (continuing cleanup):", revokeErr.message);
      }
    }

    // Always clean up local state regardless of revocation result
    await db.collection("qbTokens").doc("current").delete().catch(() => {});
    await db.collection("kioskConfig").doc("qbConnection").set({
      connected: false,
      disconnectedAt: Date.now(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("QuickBooks disconnect error:", err);
    res.status(500).json({ error: "Failed to disconnect" });
  }
}

module.exports = { authUri, callback, disconnect, createOAuthClient };
