const { getFirestore } = require("firebase-admin/firestore");
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
    res.status(500).json({ error: err.message });
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
          image: "",
          barcodeImage: "",
          isBundle: false,
          bundleItems: [],
          menuOrder: 999,
          createdAt: new Date(),
        });
        created++;
      } else {
        // Update existing linked item (preserve kiosk-only fields like image, menuOrder)
        await existing.docs[0].ref.update(data);
        updated++;
      }
    }

    res.json({ success: true, created, updated });
  } catch (err) {
    console.error("QB import products error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Refresh stock levels for all QB-linked menu items.
 * Only updates stock and inStock — doesn't change name, price, or other fields.
 */
async function refreshStock(req, res) {
  try {
    const db = getFirestore();
    const menuSnap = await db.collection("kioskMenu").where("qbItemId", "!=", "").get();

    if (menuSnap.empty) {
      res.json({ success: true, updated: 0, message: "No QB-linked items found" });
      return;
    }

    // Collect all QB item IDs we need to look up
    const qbItemIds = menuSnap.docs.map((doc) => doc.data().qbItemId);

    // Query QB for current stock levels (batch in chunks of 30 for query length limits)
    const chunks = [];
    for (let i = 0; i < qbItemIds.length; i += 30) {
      chunks.push(qbItemIds.slice(i, i + 30));
    }

    const qbItems = {};
    for (const chunk of chunks) {
      const idList = chunk.map((id) => `'${id}'`).join(", ");
      const result = await qbQuery(`SELECT Id, QtyOnHand, UnitPrice FROM Item WHERE Id IN (${idList})`);
      const items = result.QueryResponse?.Item || [];
      for (const item of items) {
        qbItems[item.Id] = item;
      }
    }

    // Update each menu item's stock
    let updated = 0;
    for (const doc of menuSnap.docs) {
      const menuItem = doc.data();
      const qbItem = qbItems[menuItem.qbItemId];
      if (!qbItem) continue;

      const newStock = qbItem.QtyOnHand ?? null;
      const newInStock = newStock === null ? true : newStock > 0;

      // Only update if stock actually changed
      if (menuItem.stock !== newStock || menuItem.inStock !== newInStock) {
        await doc.ref.update({
          stock: newStock,
          inStock: newInStock,
          price: qbItem.UnitPrice || menuItem.price,
          qbSyncedAt: Date.now(),
          updatedAt: new Date(),
        });
        updated++;
      }
    }

    res.json({ success: true, updated, total: menuSnap.size });
  } catch (err) {
    console.error("QB refresh stock error:", err);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
}

module.exports = { fetchQBProducts, importSelectedProducts, refreshStock, testConnection };
