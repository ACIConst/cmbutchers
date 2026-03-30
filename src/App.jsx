import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import OperatorGate from "./components/OperatorGate";

const LandingPage = lazy(() => import("./views/landing/LandingPage"));
const KioskView = lazy(() => import("./views/kiosk/KioskView"));
const BoardView = lazy(() => import("./views/board/BoardView"));
const AdminView = lazy(() => import("./views/admin/AdminView"));

export default function App() {
  const { user, logout } = useAuth();

  return (
    <OperatorGate>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#111" }} />}>
        <div style={{ position: "fixed", top: 10, right: 10, zIndex: 9999 }}>
          <button
            onClick={logout}
            style={{
              background: "#333", border: "1px solid #555", color: "#ccc",
              borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13,
            }}
          >
            Sign Out
          </button>
        </div>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/kiosk" element={<KioskView />} />
          <Route path="/board" element={<BoardView />} />
          <Route path="/admin" element={<AdminView />} />
        </Routes>
      </Suspense>
    </OperatorGate>
  );
}import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { useGlobalStyles } from "./hooks/useGlobalStyles";
import { useEffect } from "react";
import { runSeeds } from "./hooks/useFirestore";
import ErrorBoundary from "./components/ErrorBoundary";

const LandingPage = lazy(() => import("./views/landing/LandingPage"));
const KioskView = lazy(() => import("./views/kiosk/KioskView"));
const BoardView = lazy(() => import("./views/board/BoardView"));
const AdminView = lazy(() => import("./views/admin/AdminView"));
const DevReset = import.meta.env.DEV ? lazy(() => import("./views/dev/DevReset")) : null;

export default function App() {
  useGlobalStyles();
  useEffect(() => { if (import.meta.env.DEV) runSeeds(); }, []);

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/kiosk" element={<KioskView />} />
        <Route path="/board" element={<BoardView />} />
        <Route path="/admin" element={<AdminView />} />
        {DevReset && <Route path="/reset" element={<DevReset />} />}
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
