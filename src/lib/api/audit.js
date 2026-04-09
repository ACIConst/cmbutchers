import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../config/firebase";

const SENSITIVE_KEYS = [
  "passwordHash", "password", "pin",
  "accessToken", "refreshToken",
  "secret", "clientSecret", "credentials",
];

function sanitize(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clean = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(clean)) {
    if (SENSITIVE_KEYS.includes(key)) {
      clean[key] = "[REDACTED]";
    } else if (typeof clean[key] === "object" && clean[key] !== null) {
      clean[key] = sanitize(clean[key]);
    }
  }
  return clean;
}

export async function writeAuditLog({
  action,
  actorId,
  actorName,
  targetType,
  targetId,
  summary,
  before = null,
  after = null,
}) {
  const data = {
    action,
    actorId: actorId || "system",
    actorName: actorName || "system",
    targetType,
    targetId,
    summary,
    before: sanitize(before),
    after: sanitize(after),
    createdAt: serverTimestamp(),
  };
  try {
    await addDoc(collection(db, "auditLogs"), data);
  } catch (e) {
    // Retry once after 1s for transient failures
    console.warn("Audit log failed, retrying:", e.message);
    try {
      await new Promise(r => setTimeout(r, 1000));
      await addDoc(collection(db, "auditLogs"), data);
    } catch (e2) {
      console.warn("Audit log retry failed:", e2.message);
    }
  }
}
