import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { writeAuditLog } from "./audit";

export async function addMenuItem(data, actor = {}) {
  const ref = await addDoc(collection(db, "kioskMenu"), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    action: "menu.created",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "menuItem",
    targetId: ref.id,
    summary: `Created menu item ${data.name}`,
    after: data,
  });
  return ref;
}

export async function updateMenuItem(id, data, actor = {}) {
  const ref = doc(db, "kioskMenu", id);
  const before = await getDoc(ref);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  await writeAuditLog({
    action: "menu.updated",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "menuItem",
    targetId: id,
    summary: `Updated menu item ${data.name || before.data()?.name || id}`,
    before: before.exists() ? before.data() : null,
    after: data,
  });
}

export async function deleteMenuItem(id, actor = {}) {
  const ref = doc(db, "kioskMenu", id);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  await writeAuditLog({
    action: "menu.deleted",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "menuItem",
    targetId: id,
    summary: `Deleted menu item ${before.data()?.name || id}`,
    before: before.exists() ? before.data() : null,
  });
}
