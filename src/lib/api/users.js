import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { writeAuditLog } from "./audit";

export async function addUser(data, actor = {}) {
  let ref;
  try {
    ref = await addDoc(collection(db, "kioskUsers"), {
      ...data,
      email: data.email?.toLowerCase?.() || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Failed to add user: ${e.message}`);
  }
  await writeAuditLog({
    action: "user.created",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "user",
    targetId: ref.id,
    summary: `Created user ${data.firstName || data.name || ref.id}`,
    after: data,
  });
  return ref;
}

export async function updateUser(id, data, actor = {}) {
  const ref = doc(db, "kioskUsers", id);
  const before = await getDoc(ref);
  try {
    await updateDoc(ref, {
      ...data,
      email: data.email?.toLowerCase?.() || data.email,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Failed to update user ${id}: ${e.message}`);
  }
  await writeAuditLog({
    action: "user.updated",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "user",
    targetId: id,
    summary: `Updated user ${data.firstName || before.data()?.firstName || id}`,
    before: before.exists() ? before.data() : null,
    after: data,
  });
}

export async function deleteUser(id, actor = {}) {
  const ref = doc(db, "kioskUsers", id);
  const before = await getDoc(ref);
  try {
    await deleteDoc(ref);
  } catch (e) {
    throw new Error(`Failed to delete user ${id}: ${e.message}`);
  }
  await writeAuditLog({
    action: "user.deleted",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "user",
    targetId: id,
    summary: `Deleted user ${before.data()?.firstName || id}`,
    before: before.exists() ? before.data() : null,
  });
}
