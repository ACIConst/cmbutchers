const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const BCRYPT_ROUNDS = 12;
const ADMIN_ROLES = ["Super Admin", "Manager", "Admin", "manager", "super_admin"];
const VALID_STAFF_ROLES = ["Employee", "Manager", "Admin", "Super Admin"];
const MAX_STAFF_OPS_PER_IP = 10;
const MAX_REGISTER_PER_IP = 10;
const MAX_RESET_PER_IP = 10;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

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

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeStaffRole(role) {
  if (role === "super_admin") return "Super Admin";
  if (role === "manager") return "Manager";
  return String(role || "").trim();
}

function buildStaffClaims(role) {
  const normalizedRole = normalizeStaffRole(role);
  const isStaff = VALID_STAFF_ROLES.includes(normalizedRole);
  const isAdmin = ADMIN_ROLES.includes(normalizedRole);
  return {
    role: normalizedRole || null,
    isStaff,
    isAdmin,
    isSuperAdmin: normalizedRole === "Super Admin",
  };
}

async function applyStaffClaims(uid, role) {
  await getAuth().setCustomUserClaims(uid, buildStaffClaims(role));
}

async function findUserByEmail(db, email) {
  const snap = await db.collection("kioskUsers")
    .where("email", "==", normalizeEmail(email))
    .limit(1)
    .get();

  return snap.empty ? null : snap.docs[0];
}

async function createKioskSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.collection("kioskSessions").doc(token).set({
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

async function validateKioskSession(db, userId, sessionToken) {
  if (!userId || !sessionToken) {
    throw { status: 401, message: "Session required." };
  }

  const sessionRef = db.collection("kioskSessions").doc(String(sessionToken));
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw { status: 401, message: "Session expired. Please sign in again." };
  }

  const session = sessionSnap.data();
  if (session.userId !== String(userId) || session.expiresAt < Date.now()) {
    await sessionRef.delete().catch(() => {});
    throw { status: 401, message: "Session expired. Please sign in again." };
  }

  return session;
}

async function findStaffProfileForAuthUser(db, decoded) {
  let userDoc = await db.collection("kioskUsers").doc(decoded.uid).get();

  if (!userDoc.exists && decoded.email) {
    const snap = await db.collection("kioskUsers")
      .where("email", "==", decoded.email.toLowerCase().trim())
      .limit(1)
      .get();
    if (!snap.empty) {
      userDoc = snap.docs[0];
    }
  }

  return userDoc.exists ? userDoc : null;
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

  const { email, password } = req.body || {};

  if (!email || !password) {
    res.status(400).json({ success: false, error: "Email and password required" });
    return;
  }

  const db = getFirestore();
  const userDoc = await findUserByEmail(db, email);

  if (!userDoc) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }
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
  const sessionToken = await createKioskSession(db, userDoc.id);
  res.json({ success: true, user: { id: userDoc.id, ...safeUser, sessionToken } });
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

  const { password } = req.body || {};

  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  res.json({ hash });
}

async function registerUser(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_REGISTER_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many attempts. Please wait a minute." });
    return;
  }

  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    deliveryLocation = "",
  } = req.body || {};

  if (!firstName || !lastName) {
    res.status(400).json({ success: false, error: "First and last name are required" });
    return;
  }

  const trimmedEmail = normalizeEmail(email);
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    res.status(400).json({ success: false, error: "Valid email required" });
    return;
  }

  if (!password || password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    res.status(400).json({ success: false, error: "Phone number required" });
    return;
  }

  const db = getFirestore();
  const existingUser = await findUserByEmail(db, trimmedEmail);
  if (existingUser) {
    res.status(409).json({ success: false, error: "An account with this email already exists. Please log in." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userData = {
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    email: trimmedEmail,
    phone: normalizedPhone,
    passwordHash,
    role: "Customer",
    deliveryLocation: String(deliveryLocation || "").trim(),
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection("kioskUsers").add(userData);
  const safeUser = { ...userData };
  delete safeUser.passwordHash;
  delete safeUser.createdAt;
  const sessionToken = await createKioskSession(db, docRef.id);
  res.status(201).json({ success: true, user: { id: docRef.id, ...safeUser, sessionToken } });
}

async function verifyResetIdentity(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_RESET_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many attempts. Please wait a minute." });
    return;
  }

  const { email, phone } = req.body || {};
  if (!email || !phone) {
    res.status(400).json({ success: false, error: "Email and phone number are required" });
    return;
  }

  const db = getFirestore();
  const userDoc = await findUserByEmail(db, email);
  const normalizedPhone = normalizePhone(phone);
  const matchesPhone = userDoc && normalizePhone(userDoc.data().phone) === normalizedPhone;

  if (!matchesPhone) {
    res.status(404).json({ success: false, error: "Email and phone number do not match our records." });
    return;
  }

  res.json({ success: true });
}

async function resetPassword(req, res) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(ip, MAX_RESET_PER_IP)) {
    res.status(429).json({ success: false, error: "Too many attempts. Please wait a minute." });
    return;
  }

  const { email, phone, password } = req.body || {};
  if (!email || !phone || !password) {
    res.status(400).json({ success: false, error: "Email, phone number, and new password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    return;
  }

  const db = getFirestore();
  const userDoc = await findUserByEmail(db, email);
  const normalizedPhone = normalizePhone(phone);
  const matchesPhone = userDoc && normalizePhone(userDoc.data().phone) === normalizedPhone;

  if (!matchesPhone) {
    res.status(404).json({ success: false, error: "Email and phone number do not match our records." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await userDoc.ref.update({ passwordHash });
  res.json({ success: true });
}

async function getOrderHistory(req, res) {
  const { userId, sessionToken } = req.body || {};
  const db = getFirestore();

  try {
    await validateKioskSession(db, userId, sessionToken);
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const userSnap = await db.collection("kioskUsers").doc(String(userId)).get();
    if (!userSnap.exists) {
      return sendError(res, { status: 404, message: "Customer account not found." });
    }

    const userData = userSnap.data() || {};
    const userName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim()
      || userData.name
      || "";
    const userEmail = normalizeEmail(userData.email);

    const queries = [
      db.collection("kioskOrders").where("userId", "==", String(userId)).limit(50).get(),
    ];

    if (userEmail) {
      queries.push(
        db.collection("kioskOrders").where("email", "==", userEmail).limit(30).get()
      );
    }

    if (userName) {
      queries.push(
        db.collection("kioskOrders").where("user", "==", userName).limit(30).get()
      );
    }

    const snaps = await Promise.all(queries);
    const merged = new Map();
    snaps.forEach((snap) => {
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.archived) return;
        if (!merged.has(docSnap.id)) {
          merged.set(docSnap.id, {
            id: docSnap.id,
            ...data,
            completedAt: data.completedAt || data.deliveredAt || data.archivedAt || data.placedAt || null,
          });
        }
      });
    });

    const orders = [...merged.values()]
      .sort((a, b) => {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 20);

    res.json({
      success: true,
      orders,
    });
  } catch (err) {
    console.error("Failed to load kiosk order history:", err);
    sendError(res, { status: 500, message: "Failed to load order history." });
  }
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
  const claimRole = normalizeStaffRole(decoded.role);
  if (decoded.isAdmin === true && ADMIN_ROLES.includes(claimRole)) {
    return { uid: decoded.uid, role: claimRole };
  }

  const db = getFirestore();
  const userDoc = await findStaffProfileForAuthUser(db, decoded);
  if (!userDoc) {
    throw { status: 403, message: "No admin profile found" };
  }

  const role = normalizeStaffRole(userDoc.data().role);
  if (!ADMIN_ROLES.includes(role)) {
    throw { status: 403, message: "Insufficient permissions" };
  }

  await applyStaffClaims(decoded.uid, role);
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
    await applyStaffClaims(authUser.uid, role);
  } catch (e) {
    // Rollback: delete the orphaned Firebase Auth account
    console.error("Firestore write failed, rolling back Auth account:", e);
    await getFirestore().collection("kioskUsers").doc(authUser.uid).delete().catch(() => {});
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
    await applyStaffClaims(uid, role);
  } catch (e) {
    console.error("Firestore update failed:", e);
    return sendError(res, { status: 500, message: "Account updated but profile save failed" });
  }

  res.json({ success: true });
}

async function syncAdminClaims(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, { status: 401, message: "Authentication required" });
  }

  try {
    const token = authHeader.split("Bearer ")[1];
    const decoded = await getAuth().verifyIdToken(token);
    const claimRole = normalizeStaffRole(decoded.role);

    if (decoded.isAdmin === true && ADMIN_ROLES.includes(claimRole)) {
      return res.json({
        success: true,
        role: claimRole,
        isAdmin: true,
        isSuperAdmin: claimRole === "Super Admin",
      });
    }

    const db = getFirestore();
    const userDoc = await findStaffProfileForAuthUser(db, decoded);
    if (!userDoc) {
      return sendError(res, { status: 403, message: "No admin profile found" });
    }

    const role = normalizeStaffRole(userDoc.data().role);
    if (!ADMIN_ROLES.includes(role)) {
      return sendError(res, { status: 403, message: "Insufficient permissions" });
    }

    await applyStaffClaims(decoded.uid, role);
    return res.json({
      success: true,
      role,
      isAdmin: true,
      isSuperAdmin: role === "Super Admin",
    });
  } catch (err) {
    console.error("Failed to sync admin claims:", err);
    return sendError(res, { status: err.status || 500, message: err.message || "Failed to sync admin access" });
  }
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

module.exports = {
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
};
