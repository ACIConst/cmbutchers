import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, F } from "../../styles/tokens";

function ModeCard({ title, desc, accent, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="touch-active"
      style={{
        background: C.card,
        border: `1px solid ${hov ? accent : C.borderMid}`,
        borderRadius: 16,
        padding: "36px 32px",
        width: 240,
        display: "flex",
        flexDirection: "column",
        textAlign: "center",
        cursor: "pointer",
        transform: hov ? "translateY(-5px)" : "none",
        transition: "all .2s ease",
        boxShadow: hov ? `0 16px 40px rgba(0,0,0,.5), 0 0 0 1px ${accent}44` : "0 4px 16px rgba(0,0,0,.35)",
        animation: "fadeUp .35s ease",
        appearance: "none",
      }}
    >
      <div style={{ width: 32, height: 3, background: accent, borderRadius: 2, margin: "0 auto 20px" }} />
      <div style={{ fontFamily: F.display, fontSize: 21, fontWeight: 900, color: C.cream, letterSpacing: 1, marginBottom: 10, lineHeight: 1.2 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, flex: 1, marginBottom: 24 }}>{desc}</div>
      <div style={{ background: accent, color: C.cream, borderRadius: 9, padding: "11px 0", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
        Enter {"->"}
      </div>
    </button>
  );
}

export default function LandingPage() {
  const nav = useNavigate();
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: F.body, padding: "40px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontFamily: F.display, fontSize: 56, fontWeight: 900, color: C.cream, letterSpacing: 8, lineHeight: 1 }}>CHAMP'S MEATS</div>
        <div style={{ letterSpacing: 10, color: C.muted, fontSize: 11, textTransform: "uppercase", marginTop: 8 }}>Halstead, KS</div>
        <div style={{ width: 40, height: 2, background: C.red, margin: "18px auto 0" }} />
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", alignItems: "stretch" }}>
        <ModeCard title="Employee Kiosk" desc="Browse items & place orders" accent={C.red} onClick={() => nav("/kiosk")} />
        <ModeCard title="Admin Panel" desc="Manage menu, orders & delivery" accent="#b45309" onClick={() => nav("/admin")} />
      </div>
    </div>
  );
}
