import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import OperatorGate from "./components/OperatorGate";
import { useGlobalStyles } from "./hooks/useGlobalStyles";

const LandingPage = lazy(() => import("./views/landing/LandingPage"));
const KioskView = lazy(() => import("./views/kiosk/KioskView"));
const BoardView = lazy(() => import("./views/board/BoardView"));
const AdminView = lazy(() => import("./views/admin/AdminView"));

export default function App() {
  useGlobalStyles();
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#111" }} />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/kiosk" element={<KioskView />} />
        <Route path="/board" element={<OperatorGate><BoardView /></OperatorGate>} />
        <Route path="/admin" element={<OperatorGate><AdminView /></OperatorGate>} />
      </Routes>
    </Suspense>
  );
}
