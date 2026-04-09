import { useState, useEffect, useRef } from "react";
import {
  collection,
  onSnapshot, query,
  orderBy, limit,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { normalizeStatus } from "../styles/tokens";

const RECONNECT_DELAY = 3000;

function useResilientSnapshot(queryOrRef, mapFn, enabled = true) {
  const [data, setData] = useState([]);
  const [ready, setReady] = useState(false);
  const unsubRef = useRef(null);
  const mountedRef = useRef(true);
  const retryTimeoutRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      clearTimeout(retryTimeoutRef.current);
      return () => {
        mountedRef.current = false;
      };
    }

    const subscribe = () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      clearTimeout(retryTimeoutRef.current);

      unsubRef.current = onSnapshot(
        queryOrRef,
        (snap) => {
          if (!mountedRef.current) return;
          setData(snap.docs.map(mapFn));
          setReady(true);
        },
        (error) => {
          console.warn("Firestore listener error, reconnecting in 3s:", error.message);
          if (!mountedRef.current) return;
          setReady(true);
          retryTimeoutRef.current = setTimeout(subscribe, RECONNECT_DELAY);
        }
      );
    };

    subscribe();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("Tab visible - refreshing Firestore listeners");
        subscribe();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      if (unsubRef.current) unsubRef.current();
      clearTimeout(retryTimeoutRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, queryOrRef, mapFn]);

  return { data, ready: enabled ? ready : true };
}

const menuQuery = collection(db, "kioskMenu");
const menuMap = (d) => ({ id: d.id, ...d.data() });
export function useMenu(enabled = true) {
  const { data: menu, ready } = useResilientSnapshot(menuQuery, menuMap, enabled);
  return { menu, ready };
}

const usersQuery = collection(db, "kioskUsers");
const usersMap = (d) => ({ id: d.id, ...d.data() });
export function useUsers(enabled = true) {
  const { data: users, ready } = useResilientSnapshot(usersQuery, usersMap, enabled);
  return { users, ready };
}

const ordersQuery = query(collection(db, "kioskOrders"), orderBy("placedAt", "desc"), limit(500));
const ordersMap = (d) => {
  const data = d.data();
  return { id: d.id, ...data, status: normalizeStatus(data.status) };
};
export function useOrders(enabled = true) {
  const { data: orders, ready } = useResilientSnapshot(ordersQuery, ordersMap, enabled);
  return { orders, ready };
}

const catsQuery = collection(db, "kioskCategories");
const catsMap = (d) => ({ id: d.id, ...d.data() });
export function useCategories(enabled = true) {
  const { data, ready } = useResilientSnapshot(catsQuery, catsMap, enabled);
  const categories = [...data].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return { categories, ready };
}
