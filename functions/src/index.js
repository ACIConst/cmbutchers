const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

// QuickBooks OAuth endpoints
const { authUri, callback, disconnect } = require("./quickbooks/auth");
const { refreshToken } = require("./quickbooks/tokens");

// Allow unauthenticated access with CORS for browser requests
const publicOpts = { invoker: "public", cors: true };

// OAuth flow: redirects admin to QuickBooks authorization page
exports.qbAuth = onRequest(publicOpts, authUri);

// OAuth callback: QuickBooks redirects here after admin approves
exports.qbCallback = onRequest(publicOpts, callback);

// Disconnect: revokes tokens and cleans up
exports.qbDisconnect = onRequest(publicOpts, disconnect);

// Token refresh: called automatically or manually to refresh access token
exports.qbRefreshToken = onRequest(publicOpts, refreshToken);

// Webhook: receives notifications from QuickBooks (invoice changes, etc.)
const { handleWebhook } = require("./quickbooks/webhooks");
exports.qbWebhook = onRequest(publicOpts, handleWebhook);

// Inventory sync: fetch QB products, import selected, refresh stock
const { fetchQBProducts, importSelectedProducts, refreshStock, testConnection } = require("./quickbooks/sync-inventory");
exports.qbTestConnection = onRequest(publicOpts, testConnection);
exports.qbSyncProducts = onRequest(publicOpts, fetchQBProducts);
exports.qbImportSelected = onRequest(publicOpts, importSelectedProducts);
exports.qbRefreshStock = onRequest(publicOpts, refreshStock);

// Order → Invoice: auto-create QB invoice when a kiosk order is placed
const { onOrderCreated } = require("./quickbooks/sync-orders");
exports.qbSyncOrder = onDocumentCreated("kioskOrders/{orderId}", onOrderCreated);
