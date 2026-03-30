import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../config/firebase";

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
  try {
    await addDoc(collection(db, "auditLogs"), {
      action,
      actorId: actorId || "system",
      actorName: actorName || "system",
      targetType,
      targetId,
      summary,
      before,
      after,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Audit log failed:", e);
  }
}
