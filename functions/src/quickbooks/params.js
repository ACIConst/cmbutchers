const { defineSecret, defineString } = require("firebase-functions/params");

const QB_CLIENT_ID = defineString("QB_CLIENT_ID");
const QB_CLIENT_SECRET = defineSecret("QB_CLIENT_SECRET");
const QB_REDIRECT_URI = defineString("QB_REDIRECT_URI");
const QB_ENVIRONMENT = defineString("QB_ENVIRONMENT");
const QB_APP_URL = defineString("QB_APP_URL");
const QB_ENCRYPTION_KEY = defineSecret("QB_ENCRYPTION_KEY");
const QB_WEBHOOK_VERIFIER = defineString("QB_WEBHOOK_VERIFIER");

module.exports = {
  QB_CLIENT_ID,
  QB_CLIENT_SECRET,
  QB_REDIRECT_URI,
  QB_ENVIRONMENT,
  QB_APP_URL,
  QB_ENCRYPTION_KEY,
  QB_WEBHOOK_VERIFIER,
};
