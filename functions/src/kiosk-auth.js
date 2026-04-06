const bcrypt = require("bcrypt");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const BCRYPT_ROUNDS = 12;
const ADMIN_ROLES = ["Super Admin", "manager", "super_admin"];
const VALID_STAFF_ROLES = ["Employee", "Manager", "Admin", "Super Admin"];
const MAX_STAFF_OPS_PER_IP = 10;

// --- Rate limiting (in-memory, per Cloud Function instance) ---
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_VERIFY_PER_IP = 10;     // 10 login attempts per minute
const MAX_HASH_PER_IP = 15;       // 15 registrations per minute
const rateCounts = {};

function isRateLimited(ip, limit) {
  const now = Date.now();
  if (!rateCounts[ip] || rateCounts[ip].reset < now) {
    rateCounts[ip] = { count: 1, reset: now + RATE_WINDOW_MS };
    return false;
  }
  rateCounts[ip].count++;
  return rateCounts[ip].count > limit;
}
// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in rateCounts) {
    if (rateCounts[ip].reset < now) delete rateCounts[ip];
  }
}, 5 * 60 * 1000);

// Old FNV-1a hash for migration detection
function legacyHash(raw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + "_champs_bk";
}

function isLegacyHash(hash) {
  return hash && hash.endsWith("_champs_bk") && hash.length === 19;
}

/**
 * Verify a kiosk user's password server-side.
 * Handles both legacy FNV-1a hashes and new bcrypt hashes.
 * If a legacy hash matches, auto-migrates to bcrypt.
 *
 * POST body: { email, password }
 * Returns: { success, user } or { success: false, error }
 */
async function verifyPassword(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_VERIFY_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many attempts. Please wait a minute." });
    return;
  }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: "Email and password required" });
    return;
  }

  const db = getFirestore();
  const snap = await db.collection("kioskUsers")
    .where("email", "==", email.toLowerCase().trim())
    .limit(1)
    .get();

  if (snap.empty) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();
  const storedHash = userData.passwordHash;

  let valid = false;

  if (isLegacyHash(storedHash)) {
    // Compare against old FNV-1a hash
    valid = legacyHash(password) === storedHash;

    if (valid) {
      // Auto-migrate to bcrypt on successful login
      const bcryptHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await userDoc.ref.update({ passwordHash: bcryptHash });
      console.log(`Migrated user ${email} from FNV-1a to bcrypt`);
    }
  } else {
    // Compare against bcrypt hash
    valid = await bcrypt.compare(password, storedHash);
  }

  if (!valid) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  // Return user data (without passwordHash)
  const { passwordHash, ...safeUser } = userData;
  res.json({ success: true, user: { id: userDoc.id, ...safeUser } });
}

/**
 * Hash a password with bcrypt for new user registration.
 *
 * POST body: { password }
 * Returns: { hash }
 */
async function hashPassword(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_HASH_PER_IP)) {
    res.status(429).json({ error: "Too many attempts. Please wait a minute." });
    return;
  }

  const { password } = req.body;

  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  res.json({ hash });
}

// ─── Staff management (Firebase Auth + kioskUsers) ──────────────────────────

/**
 * Verify the caller is an authenticated admin.
 * Extracts Bearer token, verifies it, and checks kioskUsers role.
 * Returns { uid, role } or throws.
 */
async function verifyCallerIsAdmin(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { status: 401, message: "Authentication required" };
  }
  const token = authHeader.split("Bearer ")[1];
  const decoded = await getAuth().verifyIdToken(token);
  const db = getFirestore();
  const userDoc = await db.collection("kioskUsers").doc(decoded.uid).get();
  if (!userDoc.exists) {
    throw { status: 403, message: "No admin profile found" };
  }
  const role = userDoc.data().role;
  if (!ADMIN_ROLES.includes(role)) {
    throw { status: 403, message: "Insufficient permissions" };
  }
  return { uid: decoded.uid, role };
}

function sendError(res, err) {
  const status = err.status || 500;
  const message = err.message || "Internal error";
  res.status(status).json({ success: false, error: message });
}

/**
 * Create a staff member: Firebase Auth account + kioskUsers doc.
 * POST body: { name, email, password, role }
 * Requires: caller must be admin (Super Admin to assign Super Admin role).
 */
async function createStaff(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_STAFF_OPS_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many requests. Please wait." });
    return;
  }
  let caller;
  try { caller = await verifyCallerIsAdmin(req); }
  catch (e) { return sendError(res, e); }

  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return sendError(res, { status: 400, message: "Name, email, password, and role are required" });
  }
  if (password.length < 8) {
    return sendError(res, { status: 400, message: "Password must be at least 8 characters" });
  }
  if (!VALID_STAFF_ROLES.includes(role)) {
    return sendError(res, { status: 400, message: "Invalid role" });
  }
  if (role === "Super Admin" && caller.role !== "Super Admin") {
    return sendError(res, { status: 403, message: "Only Super Admins can assign Super Admin role" });
  }

  const trimmedEmail = email.toLowerCase().trim();
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  let authUser;
  try {
    authUser = await getAuth().createUser({
      email: trimmedEmail,
      password,
      displayName: name.trim(),
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      return sendError(res, { status: 409, message: "An account with this email already exists" });
    }
    console.error("Firebase Auth createUser failed:", e);
    return sendError(res, { status: 500, message: "Failed to create account" });
  }

  // Write kioskUsers doc keyed by Auth UID (required for Firestore security rules)
  try {
    const db = getFirestore();
    await db.collection("kioskUsers").doc(authUser.uid).set({
      firstName,
      lastName,
      email: trimmedEmail,
      role,
      phone: "",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
    });
  } catch (e) {
    // Rollback: delete the orphaned Firebase Auth account
    console.error("Firestore write failed, rolling back Auth account:", e);
    await getAuth().deleteUser(authUser.uid).catch(() => {});
    return sendError(res, { status: 500, message: "Failed to save staff profile" });
  }

  res.json({ success: true, uid: authUser.uid });
}

/**
 * Update a staff member: Firebase Auth + kioskUsers doc.
 * POST body: { uid, name, email, role, password? }
 */
async function updateStaff(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_STAFF_OPS_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many requests. Please wait." });
    return;
  }
  let caller;
  try { caller = await verifyCallerIsAdmin(req); }
  catch (e) { return sendError(res, e); }

  const { uid, name, email, role, password } = req.body;
  if (!uid || !name || !email || !role) {
    return sendError(res, { status: 400, message: "uid, name, email, and role are required" });
  }
  if (!VALID_STAFF_ROLES.includes(role)) {
    return sendError(res, { status: 400, message: "Invalid role" });
  }
  if (role === "Super Admin" && caller.role !== "Super Admin") {
    return sendError(res, { status: 403, message: "Only Super Admins can assign Super Admin role" });
  }
  if (password && password.length < 8) {
    return sendError(res, { status: 400, message: "Password must be at least 8 characters" });
  }

  const trimmedEmail = email.toLowerCase().trim();
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  // Update Firebase Auth
  const authUpdates = { displayName: name.trim(), email: trimmedEmail };
  if (password) authUpdates.password = password;
  try {
    await getAuth().updateUser(uid, authUpdates);
  } catch (e) {
    console.error("Firebase Auth updateUser failed:", e);
    return sendError(res, { status: 500, message: "Failed to update account: " + e.message });
  }

  // Update kioskUsers doc
  try {
    const db = getFirestore();
    await db.collection("kioskUsers").doc(uid).update({
      firstName,
      lastName,
      email: trimmedEmail,
      role,
    });
  } catch (e) {
    console.error("Firestore update failed:", e);
    return sendError(res, { status: 500, message: "Account updated but profile save failed" });
  }

  res.json({ success: true });
}

/**
 * Delete a staff member: Firebase Auth + kioskUsers doc.
 * POST body: { uid }
 */
async function deleteStaff(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_STAFF_OPS_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many requests. Please wait." });
    return;
  }
  let caller;
  try { caller = await verifyCallerIsAdmin(req); }
  catch (e) { return sendError(res, e); }

  const { uid } = req.body;
  if (!uid) {
    return sendError(res, { status: 400, message: "uid is required" });
  }
  if (uid === caller.uid) {
    return sendError(res, { status: 400, message: "Cannot delete your own account" });
  }

  // Check target's role — only Super Admins can delete other Super Admins
  const db = getFirestore();
  const targetDoc = await db.collection("kioskUsers").doc(uid).get();
  if (targetDoc.exists && targetDoc.data().role === "Super Admin" && caller.role !== "Super Admin") {
    return sendError(res, { status: 403, message: "Only Super Admins can remove other Super Admins" });
  }

  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") {
      console.error("Firebase Auth deleteUser failed:", e);
      return sendError(res, { status: 500, message: "Failed to delete account" });
    }
  }

  try {
    await db.collection("kioskUsers").doc(uid).delete();
  } catch (e) {
    console.error("Firestore delete failed:", e);
  }

  res.json({ success: true });
}

module.exports = { verifyPassword, hashPassword, createStaff, updateStaff, deleteStaff };
