const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

// QuickBooks OAuth endpoints
const { authUri, callback, disconnect } = require("./quickbooks/auth");
const { refreshToken } = require("./quickbooks/tokens");

// CORS: restrict browser requests to our domain only
const allowedOrigins = [
  "https://cmbutchers.app",
  "https://www.cmbutchers.app",
  "http://localhost:5173",
  "http://localhost:5174",
];
const publicOpts = { invoker: "public", cors: allowedOrigins };
// Webhook needs open CORS (QB servers POST to it from any origin)
const webhookOpts = { invoker: "public", cors: true };

// OAuth flow: browser redirects (not XHR), restricted CORS is fine
exports.qbAuth = onRequest(publicOpts, authUri);

// OAuth callback: QuickBooks redirects here after admin approves
exports.qbCallback = onRequest(publicOpts, callback);

// Disconnect: revokes tokens and cleans up
exports.qbDisconnect = onRequest(publicOpts, disconnect);

// Token refresh: called automatically or manually to refresh access token
exports.qbRefreshToken = onRequest(publicOpts, refreshToken);

// Webhook: receives notifications from QuickBooks servers, needs open CORS
const { handleWebhook } = require("./quickbooks/webhooks");
exports.qbWebhook = onRequest(webhookOpts, handleWebhook);

// Inventory sync: fetch QB products, import selected, refresh stock
const { fetchQBProducts, importSelectedProducts, refreshStock, testConnection } = require("./quickbooks/sync-inventory");
exports.qbTestConnection = onRequest(publicOpts, testConnection);
exports.qbSyncProducts = onRequest(publicOpts, fetchQBProducts);
exports.qbImportSelected = onRequest(publicOpts, importSelectedProducts);
exports.qbRefreshStock = onRequest(publicOpts, refreshStock);

// Order → Invoice: auto-create QB invoice when a kiosk order is placed
const { onOrderCreated } = require("./quickbooks/sync-orders");
exports.qbSyncOrder = onDocumentCreated("kioskOrders/{orderId}", onOrderCreated);

// Scheduled auto-sync: refresh stock and prices from QB every 15 minutes
const { autoRefreshStock } = require("./quickbooks/sync-inventory");
exports.qbAutoSync = onSchedule("every 15 minutes", autoRefreshStock);

// Kiosk auth: server-side password verification and hashing (bcrypt)
const { verifyPassword, hashPassword, createStaff, updateStaff, deleteStaff } = require("./kiosk-auth");
exports.kioskVerifyPassword = onRequest(publicOpts, verifyPassword);
exports.kioskHashPassword = onRequest(publicOpts, hashPassword);

// Staff management: creates Firebase Auth account + kioskUsers doc in one step
exports.kioskCreateStaff = onRequest(publicOpts, createStaff);
exports.kioskUpdateStaff = onRequest(publicOpts, updateStaff);
exports.kioskDeleteStaff = onRequest(publicOpts, deleteStaff);

// Send invoice via QuickBooks email
const { sendInvoice } = require("./quickbooks/sync-orders");
exports.qbSendInvoice = onRequest(publicOpts, sendInvoice);
