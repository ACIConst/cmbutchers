import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { writeAuditLog } from "./audit";

export async function addMenuItem(data, actor = {}) {
  let ref;
  try {
    ref = await addDoc(collection(db, "kioskMenu"), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Failed to add menu item: ${e.message}`);
  }
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
  try {
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } catch (e) {
    throw new Error(`Failed to update menu item ${id}: ${e.message}`);
  }
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
  try {
    await deleteDoc(ref);
  } catch (e) {
    throw new Error(`Failed to delete menu item ${id}: ${e.message}`);
  }
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
