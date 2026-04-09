const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QTY = 10;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_ORDERS_PER_IP = 12;
const orderRateCounts = {};

function isRateLimited(ip) {
  const now = Date.now();
  if (!orderRateCounts[ip] || orderRateCounts[ip].reset < now) {
    orderRateCounts[ip] = { count: 1, reset: now + RATE_WINDOW_MS };
    return false;
  }

  orderRateCounts[ip].count += 1;
  return orderRateCounts[ip].count > MAX_ORDERS_PER_IP;
}

setInterval(() => {
  const now = Date.now();
  for (const ip in orderRateCounts) {
    if (orderRateCounts[ip].reset < now) delete orderRateCounts[ip];
  }
}, 5 * 60 * 1000);

function sendError(res, status, message) {
  res.status(status).json({ success: false, error: message });
}

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { status: 400, message: "Your cart is empty." };
  }
  if (items.length > MAX_ORDER_ITEMS) {
    throw { status: 400, message: "Too many items in this order." };
  }

  const quantities = new Map();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    const quantity = Number.parseInt(item?.quantity, 10);

    if (!id || !Number.isInteger(quantity) || quantity < 1) {
      throw { status: 400, message: "Invalid item in order." };
    }

    const nextQuantity = (quantities.get(id) || 0) + quantity;
    if (nextQuantity > MAX_ITEM_QTY) {
      throw { status: 400, message: "Item quantity exceeds the kiosk limit." };
    }

    quantities.set(id, nextQuantity);
  }

  return quantities;
}

function buildOrderNumber(nextNumber) {
  const year = new Date().getFullYear();
  return `CB-${year}-${String(nextNumber).padStart(4, "0")}`;
}

async function placeKioskOrder(req, res) {
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip)) {
    sendError(res, 429, "Too many order attempts. Please wait a minute.");
    return;
  }

  const { userId, items } = req.body || {};
  if (!userId) {
    sendError(res, 400, "Customer account required.");
    return;
  }

  let requestedItems;
  try {
    requestedItems = normalizeRequestedItems(items);
  } catch (err) {
    sendError(res, err.status || 400, err.message || "Invalid order.");
    return;
  }

  const db = getFirestore();
  const userRef = db.collection("kioskUsers").doc(String(userId));
  const counterRef = db.collection("kioskConfig").doc("orderCounter");
  const orderRef = db.collection("kioskOrders").doc();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw { status: 404, message: "Customer account not found." };
      }

      const primaryMenuRefs = [...requestedItems.keys()].map((id) => db.collection("kioskMenu").doc(id));
      const primaryMenuSnaps = await Promise.all(primaryMenuRefs.map((ref) => transaction.get(ref)));
      const menuDocs = new Map();
      primaryMenuSnaps.forEach((snap) => {
        if (snap.exists) menuDocs.set(snap.id, snap);
      });

      const bundleItemIds = new Set();
      primaryMenuSnaps.forEach((snap) => {
        if (!snap.exists) return;
        const data = snap.data();
        if (data.isBundle && Array.isArray(data.bundleItems)) {
          data.bundleItems.forEach((bundleItem) => {
            if (bundleItem?.itemId) bundleItemIds.add(String(bundleItem.itemId));
          });
        }
      });

      const missingBundleIds = [...bundleItemIds].filter((id) => !menuDocs.has(id));
      if (missingBundleIds.length > 0) {
        const bundleRefs = missingBundleIds.map((id) => db.collection("kioskMenu").doc(id));
        const bundleSnaps = await Promise.all(bundleRefs.map((ref) => transaction.get(ref)));
        bundleSnaps.forEach((snap) => {
          if (snap.exists) menuDocs.set(snap.id, snap);
        });
      }

      const stockDeductions = new Map();
      const orderItems = [];
      let total = 0;

      for (const [itemId, quantity] of requestedItems.entries()) {
        const menuSnap = menuDocs.get(itemId);
        if (!menuSnap || !menuSnap.exists) {
          throw { status: 409, message: "An item in your cart is no longer available." };
        }

        const menuItem = menuSnap.data();
        if (menuItem.showOnKiosk === false || menuItem.inStock === false) {
          throw { status: 409, message: `${menuItem.name || "An item"} is no longer available.` };
        }

        const price = Number(menuItem.price || 0);
        orderItems.push({
          id: menuSnap.id,
          name: menuItem.name || "Item",
          price,
          quantity,
          image: menuItem.image || "",
          sku: menuItem.sku || "",
          barcode: menuItem.barcode || "",
          barcodeImage: menuItem.barcodeImage || "",
          qbItemId: menuItem.qbItemId || "",
        });
        total += price * quantity;

        if (menuItem.isBundle && Array.isArray(menuItem.bundleItems) && menuItem.bundleItems.length > 0) {
          for (const bundleItem of menuItem.bundleItems) {
            const bundleQuantity = Number(bundleItem?.quantity || 0);
            if (!bundleItem?.itemId || bundleQuantity <= 0) continue;
            const childId = String(bundleItem.itemId);
            stockDeductions.set(childId, (stockDeductions.get(childId) || 0) + (bundleQuantity * quantity));
          }
        } else if (menuItem.stock != null) {
          stockDeductions.set(menuSnap.id, (stockDeductions.get(menuSnap.id) || 0) + quantity);
        }
      }

      for (const [stockItemId, deduction] of stockDeductions.entries()) {
        const stockSnap = menuDocs.get(stockItemId);
        if (!stockSnap || !stockSnap.exists) {
          throw { status: 409, message: "Inventory changed. Please review your cart and try again." };
        }

        const stockData = stockSnap.data();
        if (stockData.stock == null) continue;

        const currentStock = Number(stockData.stock || 0);
        if (currentStock < deduction) {
          throw {
            status: 409,
            message: `${stockData.name || "An item"} only has ${currentStock} left.`,
          };
        }

        const newStock = currentStock - deduction;
        transaction.update(stockSnap.ref, {
          stock: newStock,
          inStock: newStock > 0,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const counterSnap = await transaction.get(counterRef);
      const nextNumber = (counterSnap.exists ? (counterSnap.data().lastNumber || 0) : 0) + 1;
      const orderNumber = buildOrderNumber(nextNumber);
      transaction.set(counterRef, { lastNumber: nextNumber, prefix: "CB" }, { merge: true });

      const userData = userSnap.data();
      const userName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim()
        || userData.name
        || userData.email
        || "Customer";

      const placedAtIso = new Date().toISOString();
      const orderPayload = {
        user: userName,
        userId: userSnap.id,
        email: userData.email || "",
        deliveryLocation: userData.deliveryLocation || "",
        items: orderItems,
        total,
        barcode: orderNumber,
        orderNumber,
        placedAt: FieldValue.serverTimestamp(),
        archived: false,
        status: "placed",
        statusHistory: [{ status: "placed", at: placedAtIso, by: userName }],
      };

      transaction.set(orderRef, orderPayload);

      return {
        orderNumber,
        order: {
          id: orderRef.id,
          user: userName,
          userId: userSnap.id,
          email: userData.email || "",
          deliveryLocation: userData.deliveryLocation || "",
          items: orderItems,
          total,
          barcode: orderNumber,
          orderNumber,
          placedAt: placedAtIso,
          archived: false,
          status: "placed",
          statusHistory: [{ status: "placed", at: placedAtIso, by: userName }],
          displayId: orderNumber,
        },
      };
    });

    await db.collection("auditLogs").add({
      action: "order.placed",
      actorId: String(userId),
      actorName: result.order.user,
      targetType: "order",
      targetId: result.order.id,
      summary: `Placed order ${result.orderNumber}`,
      after: {
        orderNumber: result.orderNumber,
        total: result.order.total,
        itemCount: result.order.items.length,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ success: true, orderNumber: result.orderNumber, order: result.order });
  } catch (err) {
    console.error("kioskPlaceOrder failed:", err);
    sendError(res, err.status || 500, err.message || "Failed to place order.");
  }
}

module.exports = { placeKioskOrder };
