import { C, F } from "../styles/tokens";

export function inputSt(...args) {
  const t = args.length > 1 ? args[1] : args[0];
  const c = t || C;
  return { width: "100%", background: c.card, border: `1px solid ${c.borderMid}`, borderRadius: 10, padding: "10px 13px", color: c.cream, fontFamily: F.body, fontSize: 14, transition: "border .2s" };
}

export function smallBtn(danger = false, disabled = false, t) {
  const c = t || C;
  return { background: danger ? c.errorBg : c.surface, border: `1px solid ${danger ? c.errorBg : c.borderMid}`, color: danger ? c.errorText : c.cream, borderRadius: 7, padding: "5px 11px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: F.body, fontSize: 12, opacity: disabled ? .4 : 1 };
}

export function openPrintWindow(html, showToast) {
  const w = window.open("", "_blank", "width=400,height=600");
  if (!w) {
    if (showToast) showToast("Popup blocked - allow popups for this site to print.", "error");
    return null;
  }
  w.document.write(html);
  w.document.close();
  return w;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function toJsStringLiteral(value) {
  return JSON.stringify(String(value ?? ""));
}
