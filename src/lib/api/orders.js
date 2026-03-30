import {
  collection, doc, getDoc, getDocs,
  serverTimestamp, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import { normalizeStatus, canTransition } from "../../styles/tokens";
import { generateOrderId } from "./orderIds";
import { writeAuditLog } from "./audit";

function buildStatusHistory(order, newStatus, actorName = "system") {
  return [...(order?.statusHistory || []), { status: newStatus, at: new Date().toISOString(), by: actorName }];
}

export async function placeOrder({ orderData, menu, actor = {} }) {
  const barcode = await generateOrderId();
  const batch = writeBatch(db);
  const orderRef = doc(collection(db, "kioskOrders"));
  const actorName = actor.actorName || orderData.user || "customer";

  batch.set(orderRef, {
    ...orderData,
    barcode,
    orderNumber: barcode,
    placedAt: serverTimestamp(),
    archived: false,
    status: "placed",
    statusHistory: [{ status: "placed", at: new Date().toISOString(), by: actorName }],
  });

  // Decrement stock — bundles deduct from sub-items
  for (const item of orderData.items || []) {
    const menuItem = menu.find((m) => m.id === item.id);
    if (!menuItem) continue;

    if (menuItem.isBundle && menuItem.bundleItems?.length) {
      for (const bi of menuItem.bundleItems) {
        const subItem = menu.find((m) => m.id === bi.itemId);
        if (!subItem || subItem.stock == null) continue;
        const deduct = bi.quantity * item.quantity;
        const newStock = Math.max(0, (subItem.stock || 0) - deduct);
        const updates = { stock: newStock, updatedAt: serverTimestamp() };
        if (newStock === 0) updates.inStock = false;
        batch.update(doc(db, "kioskMenu", bi.itemId), updates);
      }
    } else if (menuItem.stock != null) {
      const newStock = Math.max(0, (menuItem.stock || 0) - item.quantity);
      const updates = { stock: newStock, updatedAt: serverTimestamp() };
      if (newStock === 0) updates.inStock = false;
      batch.update(doc(db, "kioskMenu", item.id), updates);
    }
  }

  await batch.commit();

  await writeAuditLog({
    action: "order.placed",
    actorId: actor.actorId || orderData.userId || "system",
    actorName,
    targetType: "order",
    targetId: orderRef.id,
    summary: `Placed order ${barcode}`,
    after: { orderNumber: barcode, total: orderData.total, itemCount: orderData.items?.length || 0 },
  });

  return barcode;
}

export async function updateOrder(id, data, actor = {}) {
  const ref = doc(db, "kioskOrders", id);
  const before = await getDoc(ref);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  await writeAuditLog({
    action: "order.updated",
    actorId: actor.actorId || "system",
    actorName: actor.actorName || "system",
    targetType: "order",
    targetId: id,
    summary: `Updated order ${before.data()?.orderNumber || id}`,
    before: before.exists() ? before.data() : null,
    after: data,
  });
}

export async function updateOrderStatus(id, nextStatus, actor = {}) {
  const ref = doc(db, "kioskOrders", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found");
  const order = { id: snap.id, ...snap.data() };
  const currentStatus = normalizeStatus(order.status);
  const normalizedNext = normalizeStatus(nextStatus);
  const force = actor.force === true;

  if (!force && currentStatus !== normalizedNext && !canTransition(currentStatus, normalizedNext)) {
    throw new Error(`Invalid transition: ${currentStatus} -> ${normalizedNext}`);
  }

  const payload = {
    status: normalizedNext,
    statusHistory: buildStatusHistory(order, normalizedNext, actor.actorName || "system"),
    updatedAt: serverTimestamp(),
  };
  if (normalizedNext === "delivered") payload.deliveredAt = serverTimestamp();
  await updateDoc(ref, payload);
  await writeAuditLog({
    action: "order.status_updated",
    actorId: actor.actorId || "system",
    actorName: actor.actorName || "system",
    targetType: "order",
    targetId: id,
    summary: `Order ${order.orderNumber || id} moved to ${normalizedNext}`,
    before: { status: currentStatus },
    after: { status: normalizedNext },
  });
}

export async function archiveOrder(id, actor = {}) {
  const ref = doc(db, "kioskOrders", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const before = snap.data();
  await updateDoc(ref, { archived: true, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await writeAuditLog({
    action: "order.archived",
    actorId: actor.actorId || "system",
    actorName: actor.actorName || "system",
    targetType: "order",
    targetId: id,
    summary: `Archived order ${before.orderNumber || id}`,
    before,
    after: { archived: true },
  });
}

export async function restoreArchivedOrder(id, actor = {}) {
  const ref = doc(db, "kioskOrders", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const before = snap.data();
  await updateDoc(ref, { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
  await writeAuditLog({
    action: "order.restored",
    actorId: actor.actorId || "system",
    actorName: actor.actorName || "system",
    targetType: "order",
    targetId: id,
    summary: `Restored order ${before.orderNumber || id}`,
    before,
    after: { archived: false },
  });
}

export async function archiveAllActiveOrders(actor = {}) {
  const snap = await getDocs(collection(db, "kioskOrders"));
  const batch = writeBatch(db);
  let count = 0;
  snap.docs
    .filter((d) => !d.data().archived)
    .forEach((d) => {
      count += 1;
      batch.update(d.ref, { archived: true, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
  await batch.commit();
  await writeAuditLog({
    action: "order.archive_all",
    actorId: actor.actorId || "system",
    actorName: actor.actorName || "system",
    targetType: "order",
    targetId: "all-active",
    summary: `Archived ${count} active orders`,
    after: { count },
  });
}

export const deleteOrder = archiveOrder;
