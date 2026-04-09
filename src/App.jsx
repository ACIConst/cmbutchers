import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { useGlobalStyles } from "./hooks/useGlobalStyles";

const LandingPage = lazy(() => import("./views/landing/LandingPage"));
const KioskView = lazy(() => import("./views/kiosk/KioskView"));
const AdminRoute = lazy(() => import("./routes/AdminRoute"));
const LegalPages = lazy(() => import("./views/legal/LegalPages").then(m => ({ default: m.PrivacyPolicy })));
const TermsPage = lazy(() => import("./views/legal/LegalPages").then(m => ({ default: m.TermsOfService })));

export default function App() {
  useGlobalStyles();
  return (
    <ErrorBoundary>
      <Suspense fallback={<div role="status" aria-live="polite" style={{ minHeight: "100vh", background: "#111", color: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", letterSpacing: 1 }}>Loading Champs Meats...</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/kiosk" element={<KioskView />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="/delivery" element={<AdminRoute initialTab="delivery" />} />
          <Route path="/privacy" element={<LegalPages />} />
          <Route path="/terms" element={<TermsPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
