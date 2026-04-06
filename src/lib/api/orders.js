import {
  collection, doc, getDoc, getDocs,
  serverTimestamp, updateDoc, writeBatch, runTransaction,
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
  const orderRef = doc(collection(db, "kioskOrders"));
  const actorName = actor.actorName || orderData.user || "customer";

  // Build list of stock decrements needed (refs + quantities)
  const stockOps = [];
  for (const item of orderData.items || []) {
    const menuItem = menu.find((m) => m.id === item.id);
    if (!menuItem) continue;

    if (menuItem.isBundle && menuItem.bundleItems?.length) {
      for (const bi of menuItem.bundleItems) {
        const subItem = menu.find((m) => m.id === bi.itemId);
        if (!subItem || subItem.stock == null) continue;
        stockOps.push({ ref: doc(db, "kioskMenu", bi.itemId), deduct: bi.quantity * item.quantity });
      }
    } else if (menuItem.stock != null) {
      stockOps.push({ ref: doc(db, "kioskMenu", item.id), deduct: item.quantity });
    }
  }

  // Transaction: fresh-read stock, decrement atomically, create order
  // Firestore retries automatically if a concurrent write changes any read doc
  try {
    await runTransaction(db, async (transaction) => {
      // Read all stock docs fresh inside the transaction
      const freshSnaps = await Promise.all(stockOps.map((op) => transaction.get(op.ref)));

      // Decrement stock from fresh values
      freshSnaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const currentStock = snap.data().stock ?? 0;
        const newStock = Math.max(0, currentStock - stockOps[i].deduct);
        const updates = { stock: newStock, updatedAt: serverTimestamp() };
        if (newStock === 0) updates.inStock = false;
        transaction.update(stockOps[i].ref, updates);
      });

      // Create the order in the same transaction
      transaction.set(orderRef, {
        ...orderData,
        barcode,
        orderNumber: barcode,
        placedAt: serverTimestamp(),
        archived: false,
        status: "placed",
        statusHistory: [{ status: "placed", at: new Date().toISOString(), by: actorName }],
      });
    });
  } catch (e) {
    throw new Error(`Failed to place order: ${e.message}`);
  }

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
  try {
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } catch (e) {
    throw new Error(`Failed to update order ${id}: ${e.message}`);
  }
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
  try {
    await updateDoc(ref, payload);
  } catch (e) {
    throw new Error(`Failed to update order status: ${e.message}`);
  }
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
  try {
    await updateDoc(ref, { archived: true, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  } catch (e) {
    throw new Error(`Failed to archive order ${id}: ${e.message}`);
  }
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
  try {
    await updateDoc(ref, { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
  } catch (e) {
    throw new Error(`Failed to restore order ${id}: ${e.message}`);
  }
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
  try {
    await batch.commit();
  } catch (e) {
    throw new Error(`Failed to archive orders: ${e.message}`);
  }
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
