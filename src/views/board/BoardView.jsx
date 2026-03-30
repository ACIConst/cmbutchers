import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { C, F, ORDER_STATUSES, normalizeStatus, canTransition } from "../../styles/tokens";
import { useOrders, createDbOps, useMenu, useUsers } from "../../hooks/useFirestore";
import { useNavigate } from "react-router-dom";
import { ModeLoadingScreen, openPrintWindow } from "../../components/ui";
import { getWeekOf } from "../../utils";
import { useAuth } from "../../context/AuthContext";

// ─── Kanban column definitions (5 visible columns) ──────────────────────────
const COLUMNS = [
  {
    key: "picking",
    label: "Picking",
    statuses: ["paid", "picking"],
    headerBg: "#2563eb",
    headerColor: "#ffffff",
    cardBg: "#ffffff",
    cardBorder: "#e5e7eb",
    cardText: "#111827",
    cardMuted: "#6b7280",
    active: true,
  },
];

// ─── Week helpers ────────────────────────────────────────────────────────────
function addWeeks(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + 7 * n);
  return d.toISOString().split("T")[0];
}

function formatWeekLabel(isoMonday) {
  const mon = new Date(isoMonday + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const opts = { month: "short", day: "numeric" };
  return `${mon.toLocaleDateString("en-US", opts)} \u2013 ${sun.toLocaleDateString("en-US", opts)}`;
}

// ─── BoardView ───────────────────────────────────────────────────────────────
export default function BoardView() {
  const navigate = useNavigate();
  const { orders, ready: ordersReady } = useOrders(500);
  const { menu, ready: menuReady } = useMenu();
  const { users, ready: usersReady } = useUsers();
  const dbOps = useMemo(() => createDbOps(menu, []), [menu]);

  if (!ordersReady || !menuReady || !usersReady) {
    return <ModeLoadingScreen label="Loading Order Board..." />;
  }

  return (
    <OrderBoard
      orders={orders}
      dbOps={dbOps}
      onExit={() => navigate("/")}
    />
  );
}

// ─── Order Board (KDS) ──────────────────────────────────────────────────────
function OrderBoard({ orders, dbOps, onExit }) {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const operatorName = admin?.name || "Staff";

  // ── Week selector state ──
  const [selectedWeek, setSelectedWeek] = useState(() => getWeekOf());
  const prevWeek = () => setSelectedWeek(w => addWeeks(w, -1));
  const nextWeek = () => setSelectedWeek(w => addWeeks(w, 1));
  const isCurrentWeek = selectedWeek === getWeekOf();

  // ── Filter orders by weekOf field, normalize statuses ──
  const weekOrders = useMemo(() => {
    return orders.filter(o => {
      const orderWeek = o.weekOf || (o.ts ? getWeekOf(new Date(o.ts)) : (o.placedAt ? getWeekOf(new Date(o.placedAt.seconds ? o.placedAt.seconds * 1000 : o.placedAt)) : null));
      return orderWeek === selectedWeek;
    });
  }, [orders, selectedWeek]);

  const active = useMemo(() => {
    return weekOrders
      .filter(o => !o.archived)
      .sort((a, b) => new Date(a.ts || a.placedAt || 0) - new Date(b.ts || b.placedAt || 0));
  }, [weekOrders]);

  // ── New-order chime + flash ──
  const prevCountRef = useRef(active.length);
  const [flashBg, setFlashBg] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [, setTick] = useState(0);
  const [toast, setToast] = useState(null);
  const [boardTab, setBoardTab] = useState("picking");
  const [filledFilter, setFilledFilter] = useState("today");

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (active.length > prevCountRef.current) {
      playChime();
      setFlashBg(true);
      setTimeout(() => setFlashBg(false), 800);
    }
    prevCountRef.current = active.length;
  }, [active.length]);

  function showToast(msg, type = "info") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[880, 0], [1100, .15], [1320, .28]].forEach(([freq, t]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.22, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.28);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.3);
      });
    } catch (e) { }
  }

  // ── Status transitions ──
  async function advanceStatus(order, newStatus) {
    setSavingId(order.id);
    try {
      const history = [...(order.statusHistory || []), { status: newStatus, at: new Date().toISOString(), by: operatorName }];
      await dbOps.updateOrder(order.id, { status: newStatus, statusHistory: history });
    } catch (e) { console.error(e); }
    finally { setSavingId(null); }
  }

  async function toggleItem(order, idx) {
    const checked = [...(order.checkedItems || [])];
    const pos = checked.indexOf(idx);
    if (pos === -1) checked.push(idx); else checked.splice(pos, 1);
    try { await dbOps.updateOrder(order.id, { checkedItems: checked }); }
    catch (e) { console.error(e); }
  }

  // ── Print pick ticket ──
  function printPickTicket(order) {
    const items = order.items || [];
    const orderNum = String(order.orderNumber || "0000");
    const html = `<!DOCTYPE html>
<html><head><title>Pick Ticket #${order.orderNumber || "\u2014"}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
<style>
  @page{size:80mm auto;margin:4mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:"Courier New",monospace;font-size:13px;color:#000;padding:8px;max-width:80mm}
  .header{text-align:center;border-bottom:2px dashed #000;padding-bottom:10px;margin-bottom:10px}
  .shop-name{font-size:18px;font-weight:900;letter-spacing:2px;text-transform:uppercase}
  .ticket-label{font-size:14px;font-weight:700;margin-top:4px;letter-spacing:3px}
  .order-num{font-size:22px;font-weight:900;margin:6px 0}
  .codes-row{display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0}
  .order-barcode svg{width:160px;height:40px}
  .qr-box{width:70px;height:70px}
  .info-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px}
  .items{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:8px 0;margin:10px 0}
  .item{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px dotted #ccc}
  .item:last-child{border-bottom:none}
  .checkbox{width:16px;height:16px;border:2px solid #000;flex-shrink:0;margin-top:2px}
  .item-details{flex:1}
  .item-name{font-size:14px;font-weight:700}
  .item-sku{font-size:10px;color:#666;margin-top:1px}
  .item-barcode{margin-top:4px}
  .item-barcode svg{max-width:120px;height:28px}
  .item-barcode img{max-height:40px;max-width:120px}
  .item-qty{font-size:14px;font-weight:900;white-space:nowrap}
  .total-items{text-align:center;font-weight:700;font-size:13px;margin-top:6px}
  .footer{text-align:center;font-size:11px;margin-top:10px;color:#666}
  @media print{body{padding:0}}
</style></head><body>
<div class="header">
  <div class="shop-name">Champ's Butcher Shop</div>
  <div class="ticket-label">\u2014 PICK TICKET \u2014</div>
  <div class="order-num">#${order.orderNumber || "\u2014"}</div>
  <div class="codes-row">
    <div class="order-barcode"><svg id="order-bc"></svg></div>
    <canvas id="order-qr" class="qr-box"></canvas>
  </div>
</div>
<div class="info-row"><span>Customer:</span><strong>${order.user || "Walk-in"}</strong></div>
<div class="info-row"><span>Location:</span><span>${order.deliveryLocation || "N/A"}</span></div>
<div class="info-row"><span>Date:</span><span>${order.ts ? new Date(order.ts).toLocaleString() : "\u2014"}</span></div>
<div class="items">
${items.map((i, idx) => `  <div class="item">
    <div class="checkbox"></div>
    <div class="item-details">
      <div class="item-name">${i.name}</div>
      ${i.sku ? `<div class="item-sku">SKU: ${i.sku}</div>` : ""}
      ${i.barcodeImage ? `<div class="item-barcode"><img src="${i.barcodeImage}" /></div>` : (i.sku ? `<div class="item-barcode"><svg id="item-bc-${idx}"></svg></div>` : "")}
    </div>
    <div class="item-qty">\u00d7 ${i.quantity}</div>
  </div>`).join("\n")}
</div>
<div class="total-items">${items.reduce((s, i) => s + i.quantity, 0)} total items \u00b7 ${items.length} line${items.length !== 1 ? "s" : ""}</div>
<div class="footer">Printed ${new Date().toLocaleString()}</div>
<script>
  window.onload=function(){
    try{JsBarcode("#order-bc","${orderNum}",{format:"CODE128",width:1.8,height:36,displayValue:false});}catch(e){}
    try{QRCode.toCanvas(document.getElementById("order-qr"),"${orderNum}",{width:70,margin:1});}catch(e){}
    ${items.map((i, idx) => (i.sku && !i.barcodeImage) ? `try{JsBarcode("#item-bc-${idx}","${i.sku}",{format:"CODE128",width:1.4,height:26,displayValue:false});}catch(e){}` : "").join("\n    ")}
    window.print();
  };
<\/script>
</body></html>`;
    openPrintWindow(html, showToast);
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const mins = Math.floor((Date.now() - new Date(ts)) / 60_000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    return `${mins} min ago`;
  }

  // ── Count orders per column ──
  const columnOrders = useMemo(() => {
    const map = {};
    COLUMNS.forEach(col => {
      map[col.key] = active.filter(o => {
        const s = normalizeStatus(o.status);
        return col.statuses.includes(s);
      });
    });
    return map;
  }, [active]);

  const readyForDeliveryCount = active.filter(o => normalizeStatus(o.status) === "out_for_delivery").length;

  // ── Get valid next statuses for an order ──
  function getNextStatuses(order) {
    const cur = normalizeStatus(order.status);
    return ORDER_STATUSES.filter(s => canTransition(cur, s.id));
  }

  // ── Render a single order card ──
  function renderCard(order, column) {
    const checked = order.checkedItems || [];
    const totalItems = order.items?.length || 0;
    const allChecked = totalItems > 0 && checked.length >= totalItems;
    const curStatus = normalizeStatus(order.status);
    const ageMs = order.ts ? Date.now() - new Date(order.ts) : (order.placedAt ? Date.now() - new Date(order.placedAt.seconds ? order.placedAt.seconds * 1000 : order.placedAt) : 0);
    const isNew = ageMs < 120_000 && curStatus === "placed";
    const isOld = ageMs > 600_000;
    const cardGlow = isNew ? "0 0 28px rgba(155,28,28,.45)" : isOld ? "0 0 18px rgba(146,64,14,.3)" : "none";

    return (
      <div key={order.id} style={{
        background: column.cardBg || C.card,
        border: `2px solid ${isNew ? C.red : isOld ? C.amber : column.cardBorder || C.borderMid}`,
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: cardGlow,
        animation: "fadeUp .25s ease",
      }}>

        {/* Card header */}
        <div style={{
          padding: "14px 16px",
          background: isNew ? "#fef2f2" : "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 900, color: column.cardText, flex: 1 }}>#{order.orderNumber || "\u2014"}</div>
            {isNew && <span style={{ background: "#dc2626", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 900, letterSpacing: 2, animation: "pulse 1.4s infinite" }}>NEW</span>}
            {isOld && !isNew && <span style={{ background: "#ea580c", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>WAITING</span>}
          </div>
          <div style={{ fontSize: 16, color: column.cardText, fontWeight: 600 }}>{order.user || "Walk-in"}</div>
          <div style={{ fontSize: 12, color: column.cardMuted, marginTop: 2 }}>{timeAgo(order.ts || (order.placedAt?.seconds ? new Date(order.placedAt.seconds * 1000).toISOString() : order.placedAt))}</div>
        </div>

        {/* Item list - interactive checklist */}
        <div style={{ padding: "12px 14px" }}>
          {order.items?.map((item, i) => {
            const isChecked = checked.includes(i);
            return (
              <div key={i} onClick={() => toggleItem(order, i)} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 10px",
                borderRadius: 10,
                marginBottom: 6,
                cursor: "pointer",
                background: isChecked ? "#f0fdf4" : "#f9fafb",
                border: `1px solid ${isChecked ? "#86efac" : "#e5e7eb"}`,
                opacity: isChecked ? .55 : 1,
                transition: "all .15s",
                userSelect: "none",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  border: `2.5px solid ${isChecked ? "#16a34a" : "#d1d5db"}`,
                  background: isChecked ? "#16a34a" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all .15s",
                }}>
                  {isChecked && <span style={{ color: "#ffffff", fontSize: 16, fontWeight: 900 }}>{"\u2713"}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 600, lineHeight: 1.3,
                    color: isChecked ? "#9ca3af" : "#111827",
                    textDecoration: isChecked ? "line-through" : "none",
                  }}>{item.name}</div>
                  {item.sku && <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: F.mono, marginTop: 1 }}>SKU: {item.sku}</div>}
                </div>
                <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 900, color: isChecked ? "#d1d5db" : "#111827", flexShrink: 0 }}>{"\u00D7"}{item.quantity}</div>
              </div>
            );
          })}

          {/* Progress bar */}
          {totalItems > 0 && (
            <div style={{ marginTop: 10, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{checked.length}/{totalItems} packed</span>
                {allChecked && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>{"\u2713"} All packed — ready!</span>}
              </div>
              <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, transition: "width .35s ease", background: allChecked ? "#16a34a" : "#dc2626", width: `${(checked.length / totalItems) * 100}%` }} />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button onClick={() => printPickTicket(order)} style={{ flex: 1, padding: "12px 8px", background: "#f3f4f6", border: "1px solid #d1d5db", color: "#374151", borderRadius: 10, cursor: "pointer", fontFamily: F.body, fontSize: 13, fontWeight: 700, minWidth: 120 }}>
              Print Ticket
            </button>
            <button onClick={() => advanceStatus(order, "out_for_delivery")} disabled={savingId === order.id || !allChecked}
              style={{ flex: 2, padding: "12px", background: allChecked ? "#16a34a" : "#e5e7eb", border: "none", color: allChecked ? "#fff" : "#9ca3af", borderRadius: 10, cursor: (savingId === order.id || !allChecked) ? "default" : "pointer", fontFamily: F.display, fontSize: 14, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", opacity: savingId === order.id ? .6 : 1, minHeight: 48 }}>
              {savingId === order.id ? "Saving..." : "Send to Delivery"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: flashBg ? "#2d0a0a" : C.bg, fontFamily: F.body, color: C.cream, transition: "background .4s" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 999,
          background: toast.type === "error" ? C.errorBg : C.surface,
          color: toast.type === "error" ? C.errorText : C.cream,
          border: `1px solid ${toast.type === "error" ? "#7f1d1d" : C.borderMid}`,
          borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 600,
          boxShadow: "0 8px 32px rgba(0,0,0,.6)", animation: "fadeUp .25s ease",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header style={{
        background: C.surface,
        borderBottom: `2px solid ${C.red}`,
        padding: "8px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 50,
        boxShadow: "0 4px 20px rgba(0,0,0,.6)",
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/Champs%20Meats.svg" alt="Champs Meats" style={{ width: "140px", height: "auto", objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 900, letterSpacing: 5, color: C.cream, lineHeight: 1 }}>ORDER BOARD</div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: C.muted, marginTop: 2, textTransform: "uppercase" }}>Champ's Meats {"\u00B7"} Halstead, KS</div>
          </div>
        </div>

        {/* Week selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={prevWeek} style={{
            background: "transparent", border: `1px solid ${C.borderMid}`, color: C.mutedLight,
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: F.body, fontSize: 16, fontWeight: 700,
          }}>{"\u2190"}</button>
          <div style={{ textAlign: "center", minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.cream, letterSpacing: 1 }}>
              {formatWeekLabel(selectedWeek)}
            </div>
            {isCurrentWeek && <div style={{ fontSize: 10, color: C.greenText, letterSpacing: 2, textTransform: "uppercase" }}>This Week</div>}
          </div>
          <button onClick={nextWeek} style={{
            background: "transparent", border: `1px solid ${C.borderMid}`, color: C.mutedLight,
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: F.body, fontSize: 16, fontWeight: 700,
          }}>{"\u2192"}</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.cream }}>{active.length} order{active.length !== 1 ? "s" : ""} to pick</div>
          <button onClick={onExit} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontFamily: F.body, fontSize: 13 }}>{"\u2190"} Exit</button>
        </div>
      </header>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, padding: "12px 20px 0", background: C.bg }}>
        {[
          { id: "picking", label: `Picking (${(columnOrders.picking||[]).length})` },
          { id: "filled", label: "Filled Orders" },
        ].map(t => (
          <button key={t.id} onClick={() => setBoardTab(t.id)}
            style={{ background: boardTab === t.id ? "#2563eb" : C.surface, border: `1px solid ${boardTab === t.id ? "#2563eb" : C.borderMid}`, color: boardTab === t.id ? "#fff" : "#d4c4a8", borderRadius: "10px 10px 0 0", padding: "10px 24px", cursor: "pointer", fontFamily: F.body, fontSize: 15, fontWeight: 700, transition: "all .15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filled Orders tab */}
      {boardTab === "filled" && (
        <div style={{ padding: "20px", animation: "fadeUp .3s ease" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { id: "today", label: "Today" },
              { id: "week", label: "This Week" },
              { id: "month", label: "This Month" },
            ].map(f => (
              <button key={f.id} onClick={() => setFilledFilter(f.id)}
                style={{ background: filledFilter === f.id ? "#16a34a" : C.surface, border: `1px solid ${filledFilter === f.id ? "#16a34a" : C.borderMid}`, color: filledFilter === f.id ? "#fff" : "#d4c4a8", borderRadius: 20, padding: "6px 18px", cursor: "pointer", fontFamily: F.body, fontSize: 14, fontWeight: 600 }}>
                {f.label}
              </button>
            ))}
          </div>
          {(() => {
            const now = new Date();
            const filled = orders.filter(o => {
              const s = normalizeStatus(o.status);
              if (s !== "out_for_delivery" && s !== "delivered") return false;
              const ts = o.ts || (o.placedAt?.seconds ? new Date(o.placedAt.seconds * 1000).toISOString() : o.placedAt);
              if (!ts) return false;
              const d = new Date(ts);
              if (filledFilter === "today") return d.toDateString() === now.toDateString();
              if (filledFilter === "week") { const wa = new Date(now); wa.setDate(wa.getDate() - 7); return d >= wa; }
              if (filledFilter === "month") { const ma = new Date(now); ma.setDate(ma.getDate() - 30); return d >= ma; }
              return true;
            });
            const filledRev = filled.reduce((s, o) => s + (o.total || 0), 0);
            return <>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 16 }}>{filled.length} order{filled.length !== 1 ? "s" : ""} filled {"\u2014"} <span style={{ color: "#16a34a", fontFamily: F.display, fontWeight: 700 }}>${filledRev.toFixed(2)}</span></div>
              {filled.length === 0 ? (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "60px", textAlign: "center", color: C.muted }}>
                  No filled orders for this period
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                  {filled.map(o => (
                    <div key={o.id} style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 900, color: "#111827" }}>#{o.orderNumber || ""}</div>
                          <div style={{ fontSize: 14, color: "#111827", fontWeight: 600 }}>{o.user || "Unknown"}</div>
                        </div>
                        <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: "#16a34a" }}>${(o.total || 0).toFixed(2)}</div>
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                        {o.ts ? new Date(o.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""} {"\u2014"} {o.deliveryLocation || ""}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {o.items?.map((item, i) => (
                          <span key={i} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px", fontSize: 12, color: "#374151" }}>
                            {item.name} x{item.quantity}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>;
          })()}
        </div>
      )}

      {/* === Picking tab content === */}
      {boardTab === "picking" && <>

      {/* Delivery link banner */}
      {readyForDeliveryCount > 0 && (
        <div
          onClick={() => navigate("/delivery")}
          style={{
            background: "rgba(107,33,168,.15)",
            borderBottom: `1px solid rgba(107,33,168,.3)`,
            padding: "10px 24px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "background .2s",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "#d8b4fe", letterSpacing: 1 }}>
            {readyForDeliveryCount} order{readyForDeliveryCount !== 1 ? "s" : ""} ready for delivery {"\u2192"}
          </span>
        </div>
      )}

      {/* Empty state */}
      {active.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh", gap: 12, textAlign: "center" }}>
          <div style={{ fontSize: 64, opacity: .15 }}>{"\u{1F4E6}"}</div>
          <div style={{ fontFamily: F.display, fontSize: 26, color: C.muted }}>No active orders</div>
          <div style={{ fontSize: 14, color: C.border, maxWidth: 280 }}>New orders will appear here automatically and play a chime</div>
        </div>
      ) : (
        <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
          {(columnOrders.picking || []).map(order => renderCard(order, COLUMNS[0]))}
        </div>
      )}

      </>}

      {/* CSS animations */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
