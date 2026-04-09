import { useState, useEffect } from "react";
import { CF_BASE } from "../config/firebase";
import { auth } from "../config/firebase-auth";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { AuthContext } from "./auth-context";
const ADMIN_ROLES = ["Super Admin", "Manager", "Admin"];

function normalizeRole(role) {
  if (role === "super_admin") return "Super Admin";
  if (role === "manager") return "Manager";
  return String(role || "").trim();
}

function buildAdminProfile(firebaseUser, claims) {
  const role = normalizeRole(claims?.role);
  if (!claims?.isAdmin || !ADMIN_ROLES.includes(role)) return null;
  return {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email || "Admin",
    role,
    isSuperAdmin: claims?.isSuperAdmin === true || role === "Super Admin",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (!firebaseUser) {
        setUser(null);
        setAdmin(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);

      try {
        let tokenResult = await firebaseUser.getIdTokenResult();
        let adminProfile = buildAdminProfile(firebaseUser, tokenResult.claims);

        if (!adminProfile) {
          const token = await firebaseUser.getIdToken();
          const response = await fetch(`${CF_BASE}/kioskSyncAdminClaims`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            await firebaseUser.getIdToken(true);
            tokenResult = await firebaseUser.getIdTokenResult(true);
            adminProfile = buildAdminProfile(firebaseUser, tokenResult.claims);
          } else if (response.status !== 401 && response.status !== 403) {
            throw new Error(`Failed to sync admin claims (${response.status})`);
          }
        }

        setAdmin(adminProfile);
      } catch (error) {
        console.warn("Failed to load admin claims:", error);
        setAdmin(null);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  async function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    return signOut(auth);
  }

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, admin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
