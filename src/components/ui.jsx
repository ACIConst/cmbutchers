import { useEffect, useId, Component } from "react";
import { C, F, ORDER_STATUSES } from "../styles/tokens";

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("Tab error:", error, info); }
  render() {
    if (this.state.hasError) {
      const c = this.props.t || C;
      return <div style={{background:c.card||"#1a1715",border:"1px solid "+(c.border||"#2a2520"),borderRadius:14,padding:"40px 30px",textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:700,color:c.errorText||"#fca5a5",marginBottom:8}}>Something went wrong</div>
        <div style={{fontSize:13,color:c.muted||"#9b958c",marginBottom:16}}>{this.state.error?.message||"An unexpected error occurred."}</div>
        <button type="button" onClick={()=>this.setState({hasError:false,error:null})} style={{background:c.red||"#9b1c1c",color:c.cream||"#e8dcc8",border:"none",borderRadius:8,padding:"8px 20px",cursor:"pointer",fontSize:13,fontWeight:700}}>Try Again</button>
      </div>;
    }
    return this.props.children;
  }
}

export function Modal({ title, children, onClose, wide, t }) {
  const c = t || C;
  const titleId = useId();
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.87)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()} style={{ background: c.surface, border: `1px solid ${c.borderMid}`, borderRadius: 18, padding: "26px 28px", width: wide ? 570 : 420, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", animation: "scaleIn .22s ease", boxShadow: "0 32px 80px rgba(0,0,0,.85)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div id={titleId} style={{ fontFamily: F.display, fontSize: 20, fontWeight: 900, letterSpacing: 2, color: c.cream }}>{title}</div>
          <button type="button" aria-label="Close dialog" onClick={onClose} style={{ background: "transparent", border: "none", color: c.muted, cursor: "pointer", fontSize: 22, lineHeight: 1, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>X</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ message, confirmLabel, danger, onConfirm, onClose, t }) {
  const c = t || C;
  return (
    <Modal title="Confirm Action" onClose={onClose} t={t}>
      <div style={{ fontSize: 15, color: c.mutedLight, lineHeight: 1.65, marginBottom: 24 }}>{message}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Btn ghost onClick={onClose} t={t}>Cancel</Btn>
        <button type="button" onClick={onConfirm} style={{ background: danger ? c.errorBg : c.red, border: `1px solid ${danger ? c.errorBg : c.red}`, color: danger ? c.errorText : c.cream, borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 600 }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Field({ label, children, style, t, htmlFor }) {
  const c = t || C;
  return (
    <div style={style}>
      <label htmlFor={htmlFor} style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: c.muted, display: "block", marginBottom: 7 }}>{label}</label>
      {children}
    </div>
  );
}

export function Btn({ children, primary, ghost, fullWidth, large, disabled, onClick, t }) {
  const c = t || C;
  const base = { border: "none", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", fontFamily: F.body, fontWeight: 600, letterSpacing: .5, padding: large ? "14px 22px" : "9px 16px", fontSize: large ? 16 : 14, transition: "all .2s", display: "inline-flex", alignItems: "center", justifyContent: "center", width: fullWidth ? "100%" : "auto", opacity: disabled ? .5 : 1 };
  if (primary) return <button type="button" onClick={!disabled ? onClick : undefined} style={{ ...base, background: c.red, color: "#fff" }}>{children}</button>;
  if (ghost) return <button type="button" onClick={onClick} style={{ ...base, background: "transparent", color: c.muted, border: `1px solid ${c.border}` }}>{children}</button>;
  return <button type="button" onClick={onClick} style={{ ...base, background: c.card, color: c.cream, border: `1px solid ${c.borderMid}` }}>{children}</button>;
}

export function KioskBtn({ children, primary, ghost, fullWidth, large, onClick, ...props }) {
  return (
    <button type="button" onClick={onClick} className="touch-active" style={{ background: primary ? C.red : ghost ? "transparent" : C.card, color: primary ? C.cream : C.muted, border: ghost ? `1px solid ${C.border}` : primary ? "none" : `1px solid ${C.borderMid}`, borderRadius: 12, padding: large ? "16px 28px" : "12px 20px", fontFamily: F.body, fontSize: large ? 18 : 15, fontWeight: 600, cursor: "pointer", transition: "all .2s", display: "inline-flex", alignItems: "center", justifyContent: "center", width: fullWidth ? "100%" : "auto", minHeight: large ? 56 : 48, letterSpacing: .5 }} {...props}>
      {children}
    </button>
  );
}

export function KQtyBtn({ children, large, onClick, disabled }) {
  return (
    <button type="button" onClick={!disabled ? onClick : undefined} className={disabled ? "" : "touch-active"} style={{ background: C.border, border: "none", color: disabled ? C.muted : C.cream, borderRadius: 9, width: large ? 52 : 38, height: large ? 52 : 38, fontSize: large ? 24 : 19, cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.display, opacity: disabled ? .4 : 1, transition: "opacity .15s" }}>
      {children}
    </button>
  );
}

export function StatusBadge({ status }) {
  const s = ORDER_STATUSES.find(x => x.id === status) || ORDER_STATUSES[0];
  return (
    <span style={{ background: s.color, color: s.text, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export function ModeLoadingScreen({ label }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, gap: 20 }}>
      <img src="/Champs%20Meats.svg" alt="Champs Meats" style={{ height: "48px", width: "auto", objectFit: "contain" }} />
      <div style={{ width: 36, height: 36, border: `3px solid ${C.borderMid}`, borderTop: `3px solid ${C.red}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontFamily: F.body, fontSize: 14, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
