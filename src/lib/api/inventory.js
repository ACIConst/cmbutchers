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
  await updateDoc(doc(db, "kioskMenu", itemId), {
    stock: afterQty,
    inStock: afterQty > 0,
    updatedAt: serverTimestamp(),
  });

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
