import { createContext, useContext, useState, useCallback } from "react";

/**
 * AuthContext — lightweight operator identity for the whole app.
 *
 * - Board / Delivery views set the operator name via a simple prompt.
 * - Admin panel sets a full admin object (name, role, etc.).
 * - The operator name is persisted to sessionStorage so a page refresh
 *   doesn't lose it, but closing the tab does.
 */

const AuthContext = createContext(null);

const STORAGE_KEY = "champs_operator";
const ADMIN_STORAGE_KEY = "champs_admin";

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* private browsing */ }
}

export function AuthProvider({ children }) {
  // Operator name used by Board / Delivery (string)
  const [operator, setOperatorState] = useState(() => readSession(STORAGE_KEY));

  // Full admin object used by Admin panel ({ id, name, username, role, ... })
  const [admin, setAdminState] = useState(() => readSession(ADMIN_STORAGE_KEY));

  const setOperator = useCallback((name) => {
    setOperatorState(name);
    writeSession(STORAGE_KEY, name);
  }, []);

  const clearOperator = useCallback(() => {
    setOperatorState(null);
    writeSession(STORAGE_KEY, null);
  }, []);

  const setAdmin = useCallback((adminObj) => {
    setAdminState(adminObj);
    writeSession(ADMIN_STORAGE_KEY, adminObj);
  }, []);

  const clearAdmin = useCallback(() => {
    setAdminState(null);
    writeSession(ADMIN_STORAGE_KEY, null);
  }, []);

  return (
    <AuthContext.Provider value={{ operator, setOperator, clearOperator, admin, setAdmin, clearAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
