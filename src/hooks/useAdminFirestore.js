import {
  collection, doc,
  setDoc,
  getDocs,
  writeBatch, query, where,
} from "firebase/firestore";
import { db, CF_BASE } from "../config/firebase";
import { auth } from "../config/firebase-auth";
import { SEED_MENU, SEED_USERS, SEED_CATEGORIES } from "../styles/tokens";
import { addMenuItem, updateMenuItem, deleteMenuItem } from "../lib/api/menu";
import { addUser, updateUser, deleteUser } from "../lib/api/users";
import {
  placeOrder, updateOrder, archiveOrder,
  archiveAllActiveOrders,
} from "../lib/api/orders";
import {
  addCategoryDoc, deleteCategoryDoc,
  renameCategoryWithMenu, reorderCategory as reorderCategoryApi,
} from "../lib/api/categories";

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

  runSeedOnce("menu", () => {
    const batch = writeBatch(db);
    SEED_MENU.forEach((item) => { batch.set(doc(collection(db, "kioskMenu")), item); });
    return batch.commit();
  });
  runSeedOnce("users", () => {
    const batch = writeBatch(db);
    SEED_USERS.forEach((item) => { batch.set(doc(collection(db, "kioskUsers")), item); });
    return batch.commit();
  });
  runSeedOnce("categories", () => {
    const batch = writeBatch(db);
    SEED_CATEGORIES.forEach((item) => { batch.set(doc(collection(db, "kioskCategories")), item); });
    return batch.commit();
  });
}

export function createDbOps(menu, categories, actor = {}) {
  const _addMenuItem = (data) => addMenuItem(data, actor);
  const _updateMenuItem = (id, data) => updateMenuItem(id, data, actor);
  const _deleteMenuItem = (id) => deleteMenuItem(id, actor);

  const _addUser = (data) => addUser(data, actor);
  const _updateUser = (id, data) => updateUser(id, data, actor);
  const _deleteUser = (id) => deleteUser(id, actor);

  const _addOrder = (orderData) => placeOrder({ orderData, menu, actor });
  const _updateOrder = (id, data) => updateOrder(id, data, actor);
  const _deleteOrder = (id) => archiveOrder(id, actor);
  const _clearOrders = () => archiveAllActiveOrders(actor);

  const getToken = async () => {
    const user = auth.currentUser;
    return user ? user.getIdToken() : null;
  };
  const staffHeaders = async () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getToken()}`,
  });
  const addAdminAccount = async (data) => {
    const res = await fetch(`${CF_BASE}/kioskCreateStaff`, {
      method: "POST",
      headers: await staffHeaders(),
      body: JSON.stringify({ name: data.name, email: data.email, password: data.password, role: data.role }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Failed to create staff");
    return result;
  };
  const updateAdminAccount = async (id, data) => {
    const res = await fetch(`${CF_BASE}/kioskUpdateStaff`, {
      method: "POST",
      headers: await staffHeaders(),
      body: JSON.stringify({ uid: id, name: data.name, email: data.email, role: data.role, password: data.password || undefined }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Failed to update staff");
    return result;
  };
  const deleteAdminAccount = async (id) => {
    const res = await fetch(`${CF_BASE}/kioskDeleteStaff`, {
      method: "POST",
      headers: await staffHeaders(),
      body: JSON.stringify({ uid: id }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Failed to delete staff");
    return result;
  };

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
