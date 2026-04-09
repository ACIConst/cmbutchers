import { useState, useEffect, useRef } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";

const RECONNECT_DELAY = 3000;

export function useAuditLogs(maxResults = 300, enabled = true) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [ready, setReady] = useState(false);
  const unsubRef = useRef(null);
  const mountedRef = useRef(true);
  const retryRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      clearTimeout(retryRef.current);
      return () => {
        mountedRef.current = false;
      };
    }

    const subscribe = () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      clearTimeout(retryRef.current);
      const q = query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(maxResults));
      unsubRef.current = onSnapshot(q, (snap) => {
        if (!mountedRef.current) return;
        setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setReady(true);
      }, (error) => {
        console.warn("auditLogs listener error, reconnecting:", error.message);
        if (mountedRef.current) {
          setReady(true);
          retryRef.current = setTimeout(subscribe, RECONNECT_DELAY);
        }
      });
    };

    subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") subscribe(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mountedRef.current = false; if (unsubRef.current) unsubRef.current(); clearTimeout(retryRef.current); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, maxResults]);

  return { auditLogs, ready: enabled ? ready : true };
}
