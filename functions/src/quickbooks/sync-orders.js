const { getFirestore } = require("firebase-admin/firestore");
const { qbQuery, qbPost } = require("./api");

/**
 * Firestore onCreate trigger: when a kiosk order is placed, create an Invoice in QuickBooks.
 *
 * @param {object} event - Firestore event with data snapshot and params
 */
async function onOrderCreated(event) {
  const order = event.data.data();
  const orderId = event.params.orderId;
  const db = getFirestore();

  // Skip if order already has a QB invoice (idempotency)
  if (order.qbInvoiceId) return;

  try {
    // 1. Find or create customer in QuickBooks
    const customerRef = await findOrCreateCustomer(db, order);

    // 2. Build invoice lines from cart items
    const lines = [];
    for (const item of order.items || []) {
      const line = {
        DetailType: "SalesItemLineDetail",
        Amount: (item.price || 0) * (item.quantity || 1),
        SalesItemLineDetail: {
          Qty: item.quantity || 1,
          UnitPrice: item.price || 0,
        },
      };

      // If the menu item has a QB item ID, reference it
      if (item.qbItemId) {
        line.SalesItemLineDetail.ItemRef = { value: item.qbItemId };
      } else {
        // Fallback: include item name as description (no QB item link)
        line.Description = item.name || "Kiosk item";
      }

      lines.push(line);
    }

    // 3. Create the invoice in QuickBooks
    const invoice = {
      CustomerRef: customerRef,
      DocNumber: order.orderNumber || "",
      Line: lines,
      PrivateNote: `Kiosk order ${order.orderNumber || orderId}`,
    };

    const result = await qbPost("invoice", invoice);
    const qbInvoiceId = result.Invoice?.Id;

    // 4. Store the QB invoice ID back on the order
    if (qbInvoiceId) {
      await db.collection("kioskOrders").doc(orderId).update({
        qbInvoiceId: qbInvoiceId,
        qbSyncedAt: Date.now(),
      });
    }

    console.log(`Order ${order.orderNumber} → QB Invoice ${qbInvoiceId}`);
  } catch (err) {
    console.error(`Failed to sync order ${orderId} to QB:`, err);

    // Store error on the order so admin can see it
    await db.collection("kioskOrders").doc(orderId).update({
      qbSyncError: err.message,
      qbSyncAttemptedAt: Date.now(),
    }).catch(() => {});
  }
}

/**
 * Find a customer in QB by email, or create one if not found.
 * Returns a CustomerRef object: { value: "QB_CUSTOMER_ID" }
 */
async function findOrCreateCustomer(db, order) {
  const email = order.email || "";
  const name = order.user || "Kiosk Customer";

  // Try to find existing customer by email
  if (email) {
    const result = await qbQuery(
      `SELECT Id, DisplayName FROM Customer WHERE PrimaryEmailAddr = '${email.replace(/'/g, "\\'")}'`
    );
    const customers = result.QueryResponse?.Customer || [];
    if (customers.length > 0) {
      return { value: customers[0].Id };
    }
  }

  // Not found — create a new customer
  const nameParts = name.split(" ");
  const newCustomer = {
    DisplayName: `${name} (Kiosk)`,
    GivenName: nameParts[0] || "Kiosk",
    FamilyName: nameParts.slice(1).join(" ") || "Customer",
  };

  if (email) {
    newCustomer.PrimaryEmailAddr = { Address: email };
  }

  // Look up phone from kioskUsers if we have a userId
  if (order.userId) {
    const userDoc = await db.collection("kioskUsers").doc(order.userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.phone) {
        newCustomer.PrimaryPhone = { FreeFormNumber: userData.phone };
      }
    }
  }

  const result = await qbPost("customer", newCustomer);
  const qbCustomerId = result.Customer?.Id;

  // Store QB customer ID on the kioskUsers doc for future lookups
  if (qbCustomerId && order.userId) {
    await db.collection("kioskUsers").doc(order.userId).update({
      qbCustomerId: qbCustomerId,
    }).catch(() => {});
  }

  return { value: qbCustomerId };
}

/**
 * Send an invoice via QuickBooks email.
 * POST body: { orderId } — looks up the qbInvoiceId from the order doc.
 * QB sends the invoice email to the customer's email on file.
 */
async function sendInvoice(req, res) {
  const { orderId } = req.body;

  if (!orderId) {
    res.status(400).json({ error: "orderId required" });
    return;
  }

  const db = getFirestore();

  try {
    const orderDoc = await db.collection("kioskOrders").doc(orderId).get();
    if (!orderDoc.exists) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const order = orderDoc.data();
    if (!order.qbInvoiceId) {
      res.status(400).json({ error: "No QuickBooks invoice linked to this order" });
      return;
    }

    // Get customer email from the order or kioskUsers
    let email = order.email || "";
    if (!email && order.userId) {
      const userDoc = await db.collection("kioskUsers").doc(order.userId).get();
      if (userDoc.exists) email = userDoc.data().email || "";
    }
    if (!email) {
      res.status(400).json({ error: "No customer email found for this order" });
      return;
    }

    // QB /send endpoint requires email as query parameter
    const result = await qbPost(`invoice/${order.qbInvoiceId}/send?sendTo=${encodeURIComponent(email)}`, {});

    // Mark as sent on the order
    await orderDoc.ref.update({
      qbInvoiceSent: true,
      qbInvoiceSentAt: Date.now(),
    });

    res.json({ success: true, invoiceId: order.qbInvoiceId });
  } catch (err) {
    console.error("Send invoice error:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { onOrderCreated, sendInvoice };
