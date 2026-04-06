const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { qbQuery, qbGet } = require("./api");

/**
 * Fetch all inventory items from QuickBooks.
 * Returns them to the admin UI so the admin can select which ones to show on kiosk.
 */
async function fetchQBProducts(req, res) {
  try {
    const result = await qbQuery(
      "SELECT * FROM Item WHERE Active = true MAXRESULTS 1000"
    );

    const items = result.QueryResponse?.Item || [];

    // Map to a simpler format for the admin UI
    const products = items.map((item) => ({
      qbItemId: item.Id,
      name: item.Name,
      description: item.Description || "",
      price: item.UnitPrice || 0,
      stock: item.QtyOnHand ?? null,
      sku: item.Sku || "",
      type: item.Type,
      active: item.Active,
    }));

    res.json({ products, count: products.length });
  } catch (err) {
    console.error("QB fetch products error:", err);
    res.status(500).json({ error: "Failed to fetch products from QuickBooks" });
  }
}

/**
 * Fetch the product image from QB's Attachable API and upload to Firebase Storage.
 * Returns the public download URL, or "" if no image found.
 */
async function fetchQBItemImage(qbItemId) {
  try {
    // Query for attachables linked to this item
    const result = await qbQuery(
      `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Item' AND AttachableRef.EntityRef.value = '${qbItemId}'`
    );

    const attachables = result.QueryResponse?.Attachable || [];
    if (attachables.length === 0) return "";

    // Find the first image attachment
    const imageAttachment = attachables.find((a) =>
      a.ContentType && a.ContentType.startsWith("image/")
    );
    if (!imageAttachment) return "";

    const downloadUri = imageAttachment.TempDownloadUri;
    if (!downloadUri) return "";

    // Download the image
    const imageRes = await fetch(downloadUri);
    if (!imageRes.ok) return "";
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    // Upload to Firebase Storage
    const bucket = getStorage().bucket();
    const ext = imageAttachment.ContentType === "image/png" ? "png" : "jpg";
    const filePath = `menu-images/qb-${qbItemId}.${ext}`;
    const file = bucket.file(filePath);

    await file.save(imageBuffer, {
      metadata: { contentType: imageAttachment.ContentType },
    });
    await file.makePublic();

    return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
  } catch (err) {
    console.warn(`Failed to fetch image for QB item ${qbItemId}:`, err.message);
    return "";
  }
}

/**
 * Import admin-selected QB items into kioskMenu.
 * Expects POST body: { items: [{ qbItemId, name, price, description, sku, stock, category }] }
 */
async function importSelectedProducts(req, res) {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided" });
      return;
    }

    const db = getFirestore();
    const menuRef = db.collection("kioskMenu");

    let created = 0;
    let updated = 0;

    for (const item of items) {
      // Check if this QB item is already linked to a kiosk menu item
      const existing = await menuRef.where("qbItemId", "==", item.qbItemId).limit(1).get();

      // Try to fetch product image from QB
      let imageUrl = "";
      if (existing.empty || !existing.docs[0].data().image) {
        imageUrl = await fetchQBItemImage(item.qbItemId);
      }

      const data = {
        qbItemId: item.qbItemId,
        name: item.name,
        description: item.description || "",
        price: item.price || 0,
        stock: item.stock ?? null,
        inStock: item.stock === null ? true : item.stock > 0,
        sku: item.sku || "",
        category: item.category || "Uncategorized",
        showOnKiosk: true,
        qbSyncedAt: Date.now(),
        updatedAt: new Date(),
      };

      if (existing.empty) {
        // Create new menu item
        await menuRef.add({
          ...data,
          image: imageUrl,
          barcodeImage: "",
          isBundle: false,
          bundleItems: [],
          menuOrder: 999,
          createdAt: new Date(),
        });
        created++;
      } else {
        // Update existing linked item (preserve kiosk-only fields like image, menuOrder)
        const updateData = { ...data };
        // Only set image if we got one from QB and existing doesn't have one
        if (imageUrl && !existing.docs[0].data().image) {
          updateData.image = imageUrl;
        }
        await existing.docs[0].ref.update(updateData);
        updated++;
      }
    }

    res.json({ success: true, created, updated });
  } catch (err) {
    console.error("QB import products error:", err);
    res.status(500).json({ error: "Failed to import products from QuickBooks" });
  }
}

/**
 * Refresh all QB-managed fields for linked menu items.
 * Updates stock, price, name, description, and SKU from QuickBooks.
 */
async function refreshStock(req, res) {
  try {
    const db = getFirestore();
    const menuSnap = await db.collection("kioskMenu").where("qbItemId", "!=", "").get();

    if (menuSnap.empty) {
      res.json({ success: true, updated: 0, message: "No QB-linked items found" });
      return;
    }

    const qbItemIds = menuSnap.docs.map((doc) => doc.data().qbItemId);
    const chunks = [];
    for (let i = 0; i < qbItemIds.length; i += 30) {
      chunks.push(qbItemIds.slice(i, i + 30));
    }

    const qbItems = {};
    for (const chunk of chunks) {
      const idList = chunk.map((id) => `'${id}'`).join(", ");
      const result = await qbQuery(`SELECT Id, Name, Description, QtyOnHand, UnitPrice, Sku FROM Item WHERE Id IN (${idList})`);
      const items = result.QueryResponse?.Item || [];
      for (const item of items) {
        qbItems[item.Id] = item;
      }
    }

    let updated = 0;
    for (const doc of menuSnap.docs) {
      const menuItem = doc.data();
      const qbItem = qbItems[menuItem.qbItemId];
      if (!qbItem) continue;

      const newStock = qbItem.QtyOnHand ?? null;
      const newInStock = newStock === null ? true : newStock > 0;
      const newPrice = qbItem.UnitPrice || 0;
      const newName = qbItem.Name || menuItem.name;
      const newDesc = qbItem.Description || "";
      const newSku = qbItem.Sku || "";

      // Update if ANY QB-managed field changed
      if (
        menuItem.stock !== newStock ||
        menuItem.inStock !== newInStock ||
        menuItem.price !== newPrice ||
        menuItem.name !== newName ||
        menuItem.description !== newDesc ||
        menuItem.sku !== newSku
      ) {
        await doc.ref.update({
          stock: newStock,
          inStock: newInStock,
          price: newPrice,
          name: newName,
          description: newDesc,
          sku: newSku,
          qbSyncedAt: Date.now(),
          updatedAt: new Date(),
        });
        updated++;
      }
    }

    res.json({ success: true, updated, total: menuSnap.size });
  } catch (err) {
    console.error("QB refresh stock error:", err);
    res.status(500).json({ error: "Failed to refresh stock from QuickBooks" });
  }
}

/**
 * Test the QB connection by fetching company info.
 */
async function testConnection(req, res) {
  try {
    const { getValidToken } = require("./tokens");
    const { realmId } = await getValidToken();
    const result = await qbGet(`companyinfo/${realmId}`);
    const info = result.CompanyInfo;

    res.json({
      success: true,
      companyName: info.CompanyName,
      country: info.Country,
      fiscalYearStartMonth: info.FiscalYearStartMonth,
    });
  } catch (err) {
    console.error("QB test connection error:", err);
    res.status(500).json({ error: "Failed to connect to QuickBooks" });
  }
}

/**
 * Scheduled auto-sync: runs every 15 minutes to keep kiosk in sync with QB.
 * Same logic as refreshStock but without HTTP req/res — runs as a Cloud Scheduler job.
 */
async function autoRefreshStock() {
  const db = getFirestore();

  // Check if QB is connected before trying to sync
  const connDoc = await db.collection("kioskConfig").doc("qbConnection").get();
  if (!connDoc.exists || !connDoc.data().connected) {
    console.log("QB auto-sync skipped: not connected");
    return;
  }

  const menuSnap = await db.collection("kioskMenu").where("qbItemId", "!=", "").get();
  if (menuSnap.empty) {
    console.log("QB auto-sync skipped: no linked items");
    return;
  }

  const qbItemIds = menuSnap.docs.map((doc) => doc.data().qbItemId);
  const chunks = [];
  for (let i = 0; i < qbItemIds.length; i += 30) {
    chunks.push(qbItemIds.slice(i, i + 30));
  }

  const qbItems = {};
  for (const chunk of chunks) {
    const idList = chunk.map((id) => `'${id}'`).join(", ");
    const result = await qbQuery(`SELECT Id, QtyOnHand, UnitPrice, Name, Description FROM Item WHERE Id IN (${idList})`);
    const items = result.QueryResponse?.Item || [];
    for (const item of items) {
      qbItems[item.Id] = item;
    }
  }

  let updated = 0;
  for (const doc of menuSnap.docs) {
    const menuItem = doc.data();
    const qbItem = qbItems[menuItem.qbItemId];
    if (!qbItem) continue;

    const newStock = qbItem.QtyOnHand ?? null;
    const newInStock = newStock === null ? true : newStock > 0;
    const newPrice = qbItem.UnitPrice || menuItem.price;
    const newName = qbItem.Name || menuItem.name;

    if (menuItem.stock !== newStock || menuItem.inStock !== newInStock || menuItem.price !== newPrice || menuItem.name !== newName) {
      await doc.ref.update({
        stock: newStock,
        inStock: newInStock,
        price: newPrice,
        name: newName,
        description: qbItem.Description || menuItem.description,
        qbSyncedAt: Date.now(),
        updatedAt: new Date(),
      });
      updated++;
    }
  }

  // Check payment status on recent orders with QB invoices
  let paidCount = 0;
  const recentOrders = await db.collection("kioskOrders")
    .where("qbInvoiceId", "!=", "")
    .where("archived", "==", false)
    .get();

  for (const orderDoc of recentOrders.docs) {
    const order = orderDoc.data();
    if (order.qbPaid) continue; // Already marked as paid

    try {
      const invoiceData = await qbGet(`invoice/${order.qbInvoiceId}`);
      const balance = invoiceData.Invoice?.Balance;

      if (balance !== undefined && balance === 0) {
        await orderDoc.ref.update({ qbPaid: true, qbPaidAt: Date.now() });
        paidCount++;
      }
    } catch (e) {
      // Skip if invoice read fails
    }
  }

  // Update last sync timestamp
  await db.collection("kioskConfig").doc("qbConnection").update({
    lastSyncAt: Date.now(),
  }).catch(() => {});

  console.log(`QB auto-sync complete: ${updated} items updated, ${paidCount} invoices marked paid`);
}

module.exports = { fetchQBProducts, importSelectedProducts, refreshStock, testConnection, autoRefreshStock };
