import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { writeAuditLog } from "./audit";

export async function logInventoryAdjustment({
  itemId,
  itemName,
  beforeQty,
  afterQty,
  delta,
  reason,
  actorId = "system",
  actorName = "system",
  relatedOrderId = null,
}) {
  try {
    await addDoc(collection(db, "inventoryAdjustments"), {
      itemId,
      itemName,
      beforeQty,
      afterQty,
      delta,
      reason,
      actorId,
      actorName,
      relatedOrderId,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Failed to log inventory adjustment: ${e.message}`);
  }

  await writeAuditLog({
    action: "inventory.adjusted",
    actorId,
    actorName,
    targetType: "inventory",
    targetId: itemId,
    summary: `${itemName || itemId} adjusted by ${delta}`,
    before: { stock: beforeQty },
    after: { stock: afterQty, reason, relatedOrderId },
  });
}

export async function adjustInventory({ itemId, itemName, beforeQty, afterQty, reason, actorId, actorName, relatedOrderId = null }) {
  try {
    await updateDoc(doc(db, "kioskMenu", itemId), {
      stock: afterQty,
      inStock: afterQty > 0,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Failed to adjust inventory for ${itemName || itemId}: ${e.message}`);
  }

  await logInventoryAdjustment({
    itemId,
    itemName,
    beforeQty,
    afterQty,
    delta: afterQty - beforeQty,
    reason,
    actorId,
    actorName,
    relatedOrderId,
  });
}
