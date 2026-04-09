const crypto = require("crypto");
const { QB_WEBHOOK_VERIFIER } = require("./params");

/**
 * Verify and handle QuickBooks webhook notifications.
 *
 * QuickBooks signs every webhook payload with HMAC-SHA256 using your
 * verifier token. We must verify this signature before trusting the payload.
 *
 * Intuit sends a validation request when you first register the webhook —
 * it expects a 200 response to confirm the endpoint is live.
 */
async function handleWebhook(req, res) {
  // Intuit sends the signature in this header
  const signature = req.headers["intuit-signature"];
  if (!signature) {
    res.status(401).json({ error: "Missing intuit-signature header" });
    return;
  }

  // Compute expected signature from the raw request body
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = crypto
    .createHmac("sha256", QB_WEBHOOK_VERIFIER.value())
    .update(rawBody)
    .digest("base64");

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    console.warn("Webhook signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Signature is valid — process the webhook payload
  const payload = req.body;

  if (payload.eventNotifications) {
    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId;
      const events = notification.dataChangeEvent?.entities || [];

      for (const entity of events) {
        console.log(
          `QB webhook: ${entity.operation} ${entity.name} (id: ${entity.id}) in realm ${realmId}`
        );
        // Future: handle specific entity changes (Invoice, Payment, etc.)
      }
    }
  }

  // Always respond 200 quickly — Intuit retries on failure
  res.status(200).json({ received: true });
}

module.exports = { handleWebhook };
