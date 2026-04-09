const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {
  QB_CLIENT_SECRET,
  QB_ENCRYPTION_KEY,
} = require("./quickbooks/params");

admin.initializeApp();

// QuickBooks OAuth endpoints
const { authUri, callback, disconnect } = require("./quickbooks/auth");
const { refreshToken } = require("./quickbooks/tokens");

// CORS: restrict browser requests to our domain only
// Localhost origins only allowed in Firebase emulator (FUNCTIONS_EMULATOR=true)
const allowedOrigins = [
  "https://cmbutchers.app",
  "https://www.cmbutchers.app",
  ...(process.env.FUNCTIONS_EMULATOR === "true" ? ["http://localhost:5173", "http://localhost:5174"] : []),
];
const publicOpts = { invoker: "public", cors: allowedOrigins };
// Webhook needs open CORS (QB servers POST to it from any origin)
const webhookOpts = { invoker: "public", cors: true };
const qbRuntimeSecrets = [QB_CLIENT_SECRET, QB_ENCRYPTION_KEY];

// OAuth flow: browser redirects (not XHR), restricted CORS is fine
exports.qbAuth = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(authUri));

// OAuth callback: QuickBooks redirects here after admin approves
exports.qbCallback = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, callback);

// Disconnect: revokes tokens and cleans up
exports.qbDisconnect = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(disconnect));

// Token refresh: called automatically or manually to refresh access token
exports.qbRefreshToken = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(refreshToken));

// Webhook: receives notifications from QuickBooks servers, needs open CORS
const { handleWebhook } = require("./quickbooks/webhooks");
exports.qbWebhook = onRequest(webhookOpts, handleWebhook);

// Inventory sync: fetch QB products, import selected, refresh stock
const { fetchQBProducts, importSelectedProducts, refreshStock, testConnection } = require("./quickbooks/sync-inventory");
exports.qbTestConnection = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(testConnection));
exports.qbSyncProducts = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(fetchQBProducts));
exports.qbImportSelected = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(importSelectedProducts));
exports.qbRefreshStock = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(refreshStock));

// Order → Invoice: auto-create QB invoice when a kiosk order is placed
const { onOrderCreated } = require("./quickbooks/sync-orders");
exports.qbSyncOrder = onDocumentCreated({ document: "kioskOrders/{orderId}", secrets: qbRuntimeSecrets }, onOrderCreated);

// Scheduled auto-sync: refresh stock and prices from QB every 15 minutes
const { autoRefreshStock } = require("./quickbooks/sync-inventory");
exports.qbAutoSync = onSchedule({ schedule: "every 15 minutes", secrets: qbRuntimeSecrets }, autoRefreshStock);

const { placeKioskOrder } = require("./orders");
exports.kioskPlaceOrder = onRequest(publicOpts, placeKioskOrder);

// Kiosk auth: server-side password verification and hashing (bcrypt)
const {
  verifyPassword,
  hashPassword,
  registerUser,
  verifyResetIdentity,
  resetPassword,
  getOrderHistory,
  verifyCallerIsAdmin,
  syncAdminClaims,
  createStaff,
  updateStaff,
  deleteStaff,
} = require("./kiosk-auth");
function withAdminAuth(handler) {
  return async (req, res) => {
    try {
      await verifyCallerIsAdmin(req);
      return handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      const message = err.message || "Internal error";
      return res.status(status).json({ success: false, error: message });
    }
  };
}
exports.kioskVerifyPassword = onRequest(publicOpts, verifyPassword);
exports.kioskHashPassword = onRequest(publicOpts, hashPassword);
exports.kioskRegisterUser = onRequest(publicOpts, registerUser);
exports.kioskVerifyResetIdentity = onRequest(publicOpts, verifyResetIdentity);
exports.kioskResetPassword = onRequest(publicOpts, resetPassword);
exports.kioskGetOrderHistory = onRequest(publicOpts, getOrderHistory);
exports.kioskSyncAdminClaims = onRequest(publicOpts, syncAdminClaims);

// Staff management: creates Firebase Auth account + kioskUsers doc in one step
exports.kioskCreateStaff = onRequest(publicOpts, createStaff);
exports.kioskUpdateStaff = onRequest(publicOpts, updateStaff);
exports.kioskDeleteStaff = onRequest(publicOpts, deleteStaff);

// Send invoice via QuickBooks email
const { sendInvoice, retrySyncOrder } = require("./quickbooks/sync-orders");
exports.qbSendInvoice = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(sendInvoice));

// Retry QB invoice sync for orders that failed on creation
exports.qbRetrySyncOrder = onRequest({ ...publicOpts, secrets: qbRuntimeSecrets }, withAdminAuth(retrySyncOrder));
