const crypto = require("crypto");
const { QB_ENCRYPTION_KEY } = require("./params");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM.
 * Returns a single string: base64(iv + authTag + ciphertext)
 */
function encrypt(plaintext) {
  const key = Buffer.from(QB_ENCRYPTION_KEY.value(), "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack iv + authTag + ciphertext into one buffer
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a string produced by encrypt().
 */
function decrypt(packed64) {
  const key = Buffer.from(QB_ENCRYPTION_KEY.value(), "hex");
  const packed = Buffer.from(packed64, "base64");

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
