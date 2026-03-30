import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import OperatorGate from "./components/OperatorGate";

const LandingPage = lazy(() => import("./views/landing/LandingPage"));
const KioskView = lazy(() => import("./views/kiosk/KioskView"));
const BoardView = lazy(() => import("./views/board/BoardView"));
const AdminView = lazy(() => import("./views/admin/AdminView"));

export default function App() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#111" }} />}>
      <Routes>
        <Route path="/kiosk" element={<KioskView />} />
        <Route path="/*" element={
          <OperatorGate>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/board" element={<BoardView />} />
              <Route path="/admin" element={<AdminView />} />
            </Routes>
          </OperatorGate>
        } />
      </Routes>
    </Suspense>
  );
}
