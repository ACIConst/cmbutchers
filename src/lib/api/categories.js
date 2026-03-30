import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../config/firebase";
import { writeAuditLog } from "./audit";

export async function addCategoryDoc(data, actor = {}) {
  const ref = await addDoc(collection(db, "kioskCategories"), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await writeAuditLog({
    action: "category.created",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "category",
    targetId: ref.id,
    summary: `Created category ${data.name}`,
    after: data,
  });
  return ref;
}

export async function updateCategoryDoc(id, data, actor = {}) {
  const ref = doc(db, "kioskCategories", id);
  const before = await getDoc(ref);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  await writeAuditLog({
    action: "category.updated",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "category",
    targetId: id,
    summary: `Updated category ${data.name || before.data()?.name || id}`,
    before: before.exists() ? before.data() : null,
    after: data,
  });
}

export async function deleteCategoryDoc(id, actor = {}) {
  const ref = doc(db, "kioskCategories", id);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  await writeAuditLog({
    action: "category.deleted",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "category",
    targetId: id,
    summary: `Deleted category ${before.data()?.name || id}`,
    before: before.exists() ? before.data() : null,
  });
}

export async function renameCategoryWithMenu(menu, categories, id, newName, actor = {}) {
  const oldName = categories.find((c) => c.id === id)?.name;
  const batch = writeBatch(db);
  menu.filter((item) => item.category === oldName).forEach((item) => {
    batch.update(doc(db, "kioskMenu", item.id), { category: newName.trim(), updatedAt: serverTimestamp() });
  });
  batch.update(doc(db, "kioskCategories", id), { name: newName.trim(), updatedAt: serverTimestamp() });
  await batch.commit();
  await writeAuditLog({
    action: "category.renamed",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "category",
    targetId: id,
    summary: `Renamed category ${oldName || id} to ${newName.trim()}`,
    before: { name: oldName },
    after: { name: newName.trim() },
  });
}

export async function reorderCategory(categories, id, direction, actor = {}) {
  const idx = categories.findIndex((c) => c.id === id);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= categories.length) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "kioskCategories", categories[idx].id), { sortOrder: categories[swap].sortOrder, updatedAt: serverTimestamp() });
  batch.update(doc(db, "kioskCategories", categories[swap].id), { sortOrder: categories[idx].sortOrder, updatedAt: serverTimestamp() });
  await batch.commit();
  await writeAuditLog({
    action: "category.reordered",
    actorId: actor.actorId,
    actorName: actor.actorName,
    targetType: "category",
    targetId: id,
    summary: `Reordered category ${categories[idx]?.name || id}`,
    before: { sortOrder: categories[idx]?.sortOrder },
    after: { sortOrder: categories[swap]?.sortOrder },
  });
}
