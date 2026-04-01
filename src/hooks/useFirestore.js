import { useState, useEffect } from "react";
import {
  collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs,
  writeBatch, query, where,
  orderBy, limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { SEED_MENU, SEED_USERS, SEED_CATEGORIES, normalizeStatus } from "../styles/tokens";

// ─── API layer imports (audit-logged) ────────────────────────────────────────
import { addMenuItem, updateMenuItem, deleteMenuItem } from "../lib/api/menu";
import { addUser, updateUser, deleteUser } from "../lib/api/users";
import {
  placeOrder, updateOrder, archiveOrder,
  restoreArchivedOrder, archiveAllActiveOrders,
} from "../lib/api/orders";
import {
  addCategoryDoc, deleteCategoryDoc,
  renameCategoryWithMenu, reorderCategory as reorderCategoryApi,
} from "../lib/api/categories";

// ─── Password hashing (FNV-32a + suffix) ─────────────────────────────────────
export function hashPassword(raw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + "_champs_bk";
}

// ─── Seeding helpers (dev only) ───────────────────────────────────────────────
export function runSeeds() {
  if (!import.meta.env.DEV) return;

  async function runSeedOnce(key, seedFn) {
    const configRef = doc(db, "kioskConfig", key);
    try {
      const snap = await getDocs(query(collection(db, "kioskConfig"), where("__name__", "==", key)));
      if (!snap.empty) return;
      await seedFn();
      await setDoc(configRef, { seededAt: new Date().toISOString() });
    } catch (e) {
      console.warn("Seed check failed:", key, e);
    }
  }

  async function seedAdminsIfEmpty() {
    try {
      const snap = await getDocs(collection(db, "kioskAdmins"));
      if (!snap.empty) return;
      const defaultPw = import.meta.env.VITE_DEFAULT_ADMIN_PW;
      if (!defaultPw) { console.warn("Skipping admin seed: set VITE_DEFAULT_ADMIN_PW in .env"); return; }
      await addDoc(collection(db, "kioskAdmins"), {
        name: "Dev Admin",
        username: "admin",
        passwordHash: hashPassword(defaultPw),
        role: "Super Admin",
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Admin seed failed:", e);
    }
  }

  runSeedOnce("menu", () => { const b = writeBatch(db); SEED_MENU.forEach(i => { b.set(doc(collection(db, "kioskMenu")), i); }); return b.commit(); });
  runSeedOnce("users", () => { const b = writeBatch(db); SEED_USERS.forEach(i => { b.set(doc(collection(db, "kioskUsers")), i); }); return b.commit(); });
  runSeedOnce("categories", () => { const b = writeBatch(db); SEED_CATEGORIES.forEach(i => { b.set(doc(collection(db, "kioskCategories")), i); }); return b.commit(); });
  runSeedOnce("admins", () => seedAdminsIfEmpty());
}

// ─── Shared hooks ─────────────────────────────────────────────────────────────

export function useMenu() {
  const [menu, setMenu] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "kioskMenu"), snap => {
      setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, []);
  return { menu, ready };
}

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "kioskUsers"), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, []);
  return { users, ready };
}

export function useOrders(maxResults = 200) {
  const [orders, setOrders] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const q = query(
      collection(db, "kioskOrders"),
      orderBy("placedAt", "desc"),
      limit(maxResults)
    );
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, status: normalizeStatus(data.status) };
      }));
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, [maxResults]);
  return { orders, ready };
}

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "kioskCategories"), snap => {
      const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cats.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setCategories(cats);
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, []);
  return { categories, ready };
}

export function useAdmins() {
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "kioskAdmins"), snap => {
      setAdminAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setReady(true);
    }, () => setReady(true));
    return unsub;
  }, []);
  return { adminAccounts, ready };
}

// ─── Order ID generation (re-exported from API layer) ────────────────────────
export { generateOrderId } from "../lib/api/orderIds";

// ─── DB operations facade (audit-logged) ─────────────────────────────────────

export function createDbOps(menu, categories) {
  // Menu — delegates to audit-logged API
  const _addMenuItem = (data) => addMenuItem(data);
  const _updateMenuItem = (id, data) => updateMenuItem(id, data);
  const _deleteMenuItem = (id) => deleteMenuItem(id);

  // Users — delegates to audit-logged API
  const _addUser = (data) => addUser(data);
  const _updateUser = (id, data) => updateUser(id, data);
  const _deleteUser = (id) => deleteUser(id);

  // Orders — delegates to audit-logged API with stock decrement
  const _addOrder = (orderData) => placeOrder({ orderData, menu });
  const _updateOrder = (id, data) => updateOrder(id, data);
  const _deleteOrder = (id) => archiveOrder(id);
  const _clearOrders = () => archiveAllActiveOrders();

  // Admin accounts — kept as direct Firestore ops (FNV-1a hash auth)
  const addAdminAccount = data => addDoc(collection(db, "kioskAdmins"), { ...data, passwordHash: hashPassword(data.password), createdAt: serverTimestamp() });
  const updateAdminAccount = (id, data) => {
    const updates = { name: data.name, username: data.username, role: data.role };
    if (data.password && data.password.length >= 6) updates.passwordHash = hashPassword(data.password);
    return updateDoc(doc(db, "kioskAdmins", id), updates);
  };
  const deleteAdminAccount = id => deleteDoc(doc(db, "kioskAdmins", id));

  // Categories — delegates to audit-logged API
  const _addCategory = async (name) => {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    return addCategoryDoc({ name: name.trim(), sortOrder: maxOrder + 1 });
  };
  const _deleteCategory = (id) => deleteCategoryDoc(id);
  const _renameCategory = (id, newName) => renameCategoryWithMenu(menu, categories, id, newName);
  const _reorderCategory = (id, direction) => reorderCategoryApi(categories, id, direction);

  return {
    addMenuItem: _addMenuItem,
    updateMenuItem: _updateMenuItem,
    deleteMenuItem: _deleteMenuItem,
    addUser: _addUser,
    updateUser: _updateUser,
    deleteUser: _deleteUser,
    addOrder: _addOrder,
    updateOrder: _updateOrder,
    deleteOrder: _deleteOrder,
    clearOrders: _clearOrders,
    addAdminAccount,
    updateAdminAccount,
    deleteAdminAccount,
    addCategory: _addCategory,
    deleteCategory: _deleteCategory,
    renameCategory: _renameCategory,
    reorderCategory: _reorderCategory,
  };
}
