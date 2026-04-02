/**
 * src/views/admin/AdminView.jsx
 *
 * Monolithic admin panel — all tabs rendered inline.
 * Handles menu CRUD (SKU, barcode upload, DnD reorder), categories,
 * employees, orders, order board (pick tickets, chime), delivery,
 * admin accounts, inventory history, and audit log.
 *
 * Auth: Firebase Auth (OperatorGate) + kioskUsers role check (Super Admin / manager).
 * Inventory: SKU/barcode managed here; QuickBooks integration planned as external source of truth.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  C as C_DARK, F as F_DARK, ORDER_STATUSES, ADMIN_SESSION_MS,
  DELIVERY_LOCATIONS, normalizeStatus, canTransition, FONT_OPTIONS,
} from "../../styles/tokens";
import { AdminThemeProvider, useAdminTheme } from "../../context/AdminThemeContext";
import {
  useMenu, useUsers, useOrders, useCategories, useAdmins,
  createDbOps, runSeeds,
} from "../../hooks/useFirestore";
import { useInventoryAdjustments } from "../../hooks/useInventoryAdjustments";
import { useAuditLogs } from "../../hooks/useAuditLogs";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  Modal, ConfirmModal, Field, Btn, ModeLoadingScreen,
  StatusBadge, inputSt, smallBtn, openPrintWindow,
} from "../../components/ui";
import { Img } from "../../components/Img";
import { isOrderingOpen, getWeekOf, fmt$, fmtDate } from "../../utils";

import { collection, doc, addDoc, getDoc, setDoc, writeBatch } from "firebase/firestore"; import { getAuth, signOut } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../../config/firebase";

const storage = getStorage();

// ─── Main exported component ─────────────────────────────────────────────────
export default function AdminView() {
  const navigate = useNavigate();
  const { menu, ready: menuReady }           = useMenu();
  const { users, ready: usersReady }         = useUsers();
  const { orders, ready: ordersReady }       = useOrders();
  const { categories, ready: catsReady }     = useCategories();
  const { adminAccounts, ready: adminsReady } = useAdmins();
  const { adjustments, ready: adjustmentsReady } = useInventoryAdjustments();
  const { auditLogs, ready: auditReady } = useAuditLogs();
  const catNames = categories.map(c => c.name);
  const dbOps    = createDbOps(menu, categories);
  useEffect(() => { if (import.meta.env.DEV) runSeeds(); }, []);
  const allReady = menuReady && usersReady && ordersReady && catsReady && adminsReady && adjustmentsReady && auditReady;
  if (!allReady) return <ModeLoadingScreen label="Loading Admin Panel..." />;
  return <AdminThemeProvider><AdminApp menu={menu} users={users} orders={orders} adminAccounts={adminAccounts} categories={categories} catNames={catNames} dbOps={dbOps} adjustments={adjustments} auditLogs={auditLogs} onExit={() => navigate("/")} /></AdminThemeProvider>;
}

// ─── Responsive hook ─────────────────────────────────────────────────────────
function useWindowSize(){const [s,set]=useState({w:typeof window!=="undefined"?window.innerWidth:1200,h:typeof window!=="undefined"?window.innerHeight:800});useEffect(()=>{const h=()=>set({w:window.innerWidth,h:window.innerHeight});window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);return s;}

// ═══════════════════════════════════════════════════════════════════════════════
// AdminApp — responsive sidebar + tab routing
// ═══════════════════════════════════════════════════════════════════════════════
function AdminApp({ menu, users, orders, adminAccounts, categories, catNames, dbOps, adjustments, auditLogs, onExit }) {
  const { T: C, TF: F, theme, logoUrl, fontId } = useAdminTheme();
  const { user, setAdmin } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sessionTimerRef = useRef(null);
  const {w}=useWindowSize();
  const isMobile=w<768;
  const isTablet=w>=768&&w<1024;
  const showSidebarPermanent=w>=1024;

  // Load Google Fonts for selected font
  useEffect(()=>{
    if(fontId==="default")return;
    const families={"inter":"Inter:wght@400;600;700;900","roboto":"Roboto:wght@400;500;700;900","mono":"JetBrains+Mono:wght@400;600;700"};
    const family=families[fontId];if(!family)return;
    const id="gfont-"+fontId;if(document.getElementById(id))return;
    const link=document.createElement("link");link.id=id;link.rel="stylesheet";link.href="https://fonts.googleapis.com/css2?family="+family+"&display=swap";document.head.appendChild(link);
  },[fontId]);

  // Derive admin identity from Firebase Auth user + kioskUsers role
  const ADMIN_ROLES = ["Super Admin", "manager", "super_admin"];
  const kioskUser = users.find(u => u.email && u.email.toLowerCase() === user?.email?.toLowerCase());
  const loggedInAdmin = kioskUser && ADMIN_ROLES.includes(kioskUser.role)
    ? { id: kioskUser.id, name: ((kioskUser.firstName || "") + " " + (kioskUser.lastName || "")).trim() || user.email, role: kioskUser.role === "super_admin" ? "Super Admin" : kioskUser.role }
    : null;

  useEffect(()=>{ setAdmin(loggedInAdmin); return ()=>setAdmin(null); },[loggedInAdmin, setAdmin]);

  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }

  // ── New-order chime + toast (works across all tabs) ──
  const prevOrderIdsRef = useRef(null);
  useEffect(()=>{
    const currentIds = new Set(orders.filter(o=>!o.archived).map(o=>o.id));
    if(prevOrderIdsRef.current===null){prevOrderIdsRef.current=currentIds;return;}
    const newOrders=orders.filter(o=>!o.archived&&!prevOrderIdsRef.current.has(o.id));
    if(newOrders.length>0){
      // Play chime (respects notification settings)
      if(localStorage.getItem("admin-chime")!=="off"){const vol=parseInt(localStorage.getItem("admin-volume")||"70",10)/100*0.35;try{const ctx=new(window.AudioContext||window.webkitAudioContext)();[[660,0],[880,.12],[1100,.24]].forEach(([freq,t])=>{const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;gain.gain.setValueAtTime(vol,ctx.currentTime+t);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.3);osc.start(ctx.currentTime+t);osc.stop(ctx.currentTime+t+0.32);});}catch(e){console.warn("Audio notification failed:",e);}}
      // Toast for each new order
      const o=newOrders[0];
      const label=(o.orderNumber||o.barcode||"New")+" \u2014 "+(o.user||"Customer");
      showToast("\uD83D\uDD14 "+label+(newOrders.length>1?" (+"+( newOrders.length-1)+" more)":""),"order");
    }
    prevOrderIdsRef.current=currentIds;
  },[orders]);
  const handleLogout = useCallback(()=>{signOut(getAuth());},[]);
  const resetSessionTimer = useCallback(()=>{clearTimeout(sessionTimerRef.current);if(loggedInAdmin) sessionTimerRef.current=setTimeout(()=>{handleLogout();},ADMIN_SESSION_MS);},[loggedInAdmin,handleLogout]);
  useEffect(()=>{ resetSessionTimer(); return()=>clearTimeout(sessionTimerRef.current); },[resetSessionTimer]);
  useEffect(()=>{if(!loggedInAdmin)return;const events=["mousedown","keydown","touchstart"];events.forEach(e=>document.addEventListener(e,resetSessionTimer,{passive:true}));return()=>events.forEach(e=>document.removeEventListener(e,resetSessionTimer));},[resetSessionTimer,loggedInAdmin]);

  if(!loggedInAdmin) return <AccessDenied email={user?.email} onLogout={handleLogout} onExit={onExit} />;

  const isSuperAdmin=loggedInAdmin.role==="Super Admin";
  const deliveryCount=orders.filter(o=>!o.archived&&normalizeStatus(o.status)==="out_for_delivery").length;
  const pickingCount=orders.filter(o=>!o.archived&&["paid","picking"].includes(normalizeStatus(o.status))).length;
  const navItems=[
    {id:"dashboard",  label:"Dashboard"},
    {id:"menu",       label:"Menu Items"},
    {id:"categories", label:"Categories"},
    {id:"users",      label:"Customers"},
    {id:"orders",     label:"Orders"+(pickingCount>0?" ("+pickingCount+")":"")},
    {id:"delivery",   label:"Delivery"+(deliveryCount>0?" ("+deliveryCount+")":"")},
    ...(isSuperAdmin?[{id:"inventory",label:"Inventory History"},{id:"audit",label:"Audit Log"}]:[]),
    {id:"settings",  label:"Settings"},
  ];

  function navTo(id){setTab(id);if(!showSidebarPermanent)setSidebarOpen(false);}

  const sidebarContent=(
    <>
      <div style={{padding:isMobile?"16px 14px 10px":"20px 18px 14px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>{logoUrl?<img src={logoUrl} alt="Logo" style={{maxHeight:40,maxWidth:140,objectFit:"contain"}}/>:<><div style={{fontFamily:F.display,fontSize:isMobile?18:20,fontWeight:900,letterSpacing:3,color:C.cream,lineHeight:1}}>Champ's</div><div style={{fontSize:11,letterSpacing:3,color:C.muted,marginTop:4,textTransform:"uppercase"}}>Admin Panel</div></>}</div>
        {!showSidebarPermanent&&<button onClick={()=>setSidebarOpen(false)} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:22,lineHeight:1,padding:4}}>{"\u2715"}</button>}
      </div>
      <nav style={{flex:1,minHeight:0,padding:"10px 8px",overflowY:"auto"}}>
        {navItems.map(n=><button key={n.id} className="nav-btn" onClick={()=>navTo(n.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:tab===n.id?C.sidebarActive:"transparent",border:"1px solid "+(tab===n.id?C.borderMid:"transparent"),color:tab===n.id?C.cream:C.muted,borderRadius:10,padding:"10px 14px",cursor:"pointer",fontSize:15,fontFamily:F.body,marginBottom:4,textAlign:"left",transition:"all .15s"}}>{n.label}{tab===n.id&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:C.red}}/>}</button>)}
      </nav>
      <div style={{padding:"12px 14px",borderTop:"1px solid "+C.border,background:theme==="light"?"rgba(0,0,0,.04)":"rgba(0,0,0,.2)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:C.cream,flexShrink:0}}>{loggedInAdmin.name.charAt(0).toUpperCase()}</div>
          <div style={{overflow:"hidden"}}><div style={{fontSize:13,color:C.cream,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{loggedInAdmin.name}</div><div style={{fontSize:10,color:C.muted,letterSpacing:1}}>{loggedInAdmin.role}</div></div>
        </div>
        <button className="nav-btn" onClick={()=>{handleLogout();onExit();}} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"transparent",border:"1px solid "+C.border,color:C.muted,borderRadius:8,padding:"7px 10px",cursor:"pointer",fontSize:13,fontFamily:F.body,textAlign:"left",transition:"all .15s"}}>{"\u2B05"} Exit Admin</button>
      </div>
    </>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",fontFamily:F.body,color:C.cream}}>
      {/* Desktop/Tablet permanent sidebar */}
      {showSidebarPermanent&&(
        <aside style={{width:isTablet?200:220,background:C.sidebarBg,borderRight:"1px solid "+C.border,display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh"}}>
          {sidebarContent}
        </aside>
      )}

      {/* Mobile/Tablet overlay sidebar */}
      {!showSidebarPermanent&&sidebarOpen&&(
        <>
          <div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:998,animation:"fadeUp .15s ease"}}/>
          <aside style={{position:"fixed",top:0,left:0,bottom:0,width:260,background:C.sidebarBg,borderRight:"1px solid "+C.border,display:"flex",flexDirection:"column",zIndex:999,boxShadow:"4px 0 20px rgba(0,0,0,.5)",animation:"slideIn .2s ease"}}>
            {sidebarContent}
          </aside>
          <style>{`@keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}`}</style>
        </>
      )}

      <main style={{flex:1,overflow:"auto",minHeight:"100vh",minWidth:0}}>
        {/* Header */}
        <div style={{background:C.surface,borderBottom:"1px solid "+C.border,padding:isMobile?"10px 14px":"13px 26px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:30,gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {!showSidebarPermanent&&<button onClick={()=>setSidebarOpen(true)} style={{background:"transparent",border:"1px solid "+C.border,color:C.cream,cursor:"pointer",borderRadius:8,padding:"6px 8px",fontSize:18,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>{"\u2630"}</button>}
            <div style={{fontFamily:F.display,fontSize:isMobile?16:20,fontWeight:900,letterSpacing:2,color:C.cream}}>{navItems.find(n=>n.id===tab)?.label}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:isMobile?8:14}}>
            {!isMobile&&<div style={{fontSize:13,color:C.muted}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>}
            <div style={{background:isSuperAdmin?C.red:C.amber,color:isSuperAdmin?C.cream:C.amberText,borderRadius:6,padding:"3px 12px",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>{isMobile?(isSuperAdmin?"SA":"Admin"):loggedInAdmin.role}</div>
            <button onClick={()=>navTo("settings")} title="Settings" style={{background:tab==="settings"?C.sidebarActive:"transparent",border:"1px solid "+(tab==="settings"?C.borderMid:C.border),color:C.muted,cursor:"pointer",borderRadius:8,padding:"5px 7px",fontSize:16,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>{"\u2699"}</button>
          </div>
        </div>
        <div style={{padding:isMobile?"14px":isTablet?"20px":"26px"}}>
          {tab==="dashboard"  &&<AdminDashboard menu={menu} users={users} orders={orders} dbOps={dbOps} isMobile={isMobile} isTablet={isTablet}/>}
          {tab==="menu"       &&<MenuManager menu={menu} catNames={catNames} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="categories" &&<CategoriesManager categories={categories} menu={menu} dbOps={dbOps} showToast={showToast}/>}
          {tab==="users"      &&<UserManager users={users} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="orders"     &&<OrderHistory orders={orders} users={users} menu={menu} dbOps={dbOps} showToast={showToast}/>}
          {tab==="delivery"   &&<DeliveryPanel orders={orders} users={users} dbOps={dbOps} showToast={showToast}/>}
          {tab==="inventory"&&isSuperAdmin&&<InventoryHistoryPanel adjustments={adjustments}/>}
          {tab==="audit"&&isSuperAdmin&&<AuditLogPanel auditLogs={auditLogs}/>}
          {tab==="settings"&&<SettingsPanel showToast={showToast} adminAccounts={adminAccounts} dbOps={dbOps} currentAdmin={loggedInAdmin} isSuperAdmin={isSuperAdmin} categories={categories}/>}
        </div>
      </main>
      {toast&&<div style={{position:"fixed",bottom:isMobile?14:26,right:isMobile?14:26,left:isMobile?14:"auto",background:toast.type==="success"?C.green:toast.type==="order"?"#1e3a5f":C.errorBg,color:toast.type==="success"?C.greenText:toast.type==="order"?"#93c5fd":C.errorText,border:"1px solid "+(toast.type==="success"?C.greenText:toast.type==="order"?"#3b82f6":C.errorText),borderRadius:12,padding:"12px 20px",fontSize:14,fontWeight:600,animation:"fadeUp .3s ease",zIndex:999,boxShadow:"0 8px 24px rgba(0,0,0,.5)",display:"flex",alignItems:"center",gap:8}}>{toast.type==="success"?"\u2713":toast.type==="order"?"\uD83D\uDCE6":"\u2715"} {toast.msg}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Denied
// ═══════════════════════════════════════════════════════════════════════════════
function AccessDenied({ email, onLogout, onExit }) {
  const C=C_DARK,F=F_DARK;
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:F.body,color:C.cream,padding:40}}>
      <img src="/Champs%20Meats.svg" alt="Champs Meats" style={{height:"60px",width:"auto",objectFit:"contain",marginBottom:14}}/>
      <div style={{fontFamily:F.display,fontSize:26,fontWeight:900,letterSpacing:4,color:C.cream,marginBottom:4}}>ACCESS DENIED</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:32}}>Your account does not have admin privileges</div>
      <div style={{background:C.surface,border:"1px solid "+C.borderMid,borderRadius:18,padding:"34px 36px",width:420,maxWidth:"95vw",animation:"scaleIn .3s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)",textAlign:"center"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:C.errorBg,border:"2px solid "+C.errorText,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 18px"}}>&#x1F6AB;</div>
        <div style={{fontSize:15,color:C.cream,marginBottom:6}}>Signed in as</div>
        <div style={{fontFamily:F.mono,fontSize:14,color:C.muted,marginBottom:20,wordBreak:"break-all"}}>{email || "unknown"}</div>
        <div style={{background:C.errorBg,border:"1px solid "+C.red,borderRadius:10,padding:"12px 16px",fontSize:13,color:C.errorText,marginBottom:24,lineHeight:1.5}}>This account is not assigned a <strong>Super Admin</strong> or <strong>Manager</strong> role. Contact an administrator to request access.</div>
        <button onClick={onLogout} style={{width:"100%",background:C.red,border:"none",color:C.cream,borderRadius:10,padding:"14px",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:F.body,marginBottom:10}}>Sign Out &amp; Try Another Account</button>
        <button onClick={onExit} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",width:"100%",fontFamily:F.body,fontSize:14,padding:"8px 0"}}>{"\u2190"} Back to Mode Select</button>
      </div>
    </div>
  );
}

// ─── Receipt Modal ──────────────────────────────────────────────────────────
function ReceiptModal({ order, onClose }) {const{T:C,TF:F}=useAdminTheme();
  function printReceipt() {
    const items = order.items || [];
    const html = '<!DOCTYPE html><html><head><title>Receipt #'+(order.orderNumber||"")+'</title><style>@page{size:80mm auto;margin:4mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:13px;color:#000;padding:8px;max-width:80mm}.header{text-align:center;border-bottom:2px dashed #000;padding-bottom:10px;margin-bottom:10px}.shop-name{font-size:18px;font-weight:900;letter-spacing:2px;text-transform:uppercase}.receipt-label{font-size:14px;font-weight:700;margin-top:4px;letter-spacing:3px}.order-num{font-size:20px;font-weight:900;margin:6px 0}.info-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}.items{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:8px 0;margin:10px 0}.item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ccc}.item:last-child{border-bottom:none}.total-row{display:flex;justify-content:space-between;font-size:16px;font-weight:900;margin-top:8px;padding-top:8px;border-top:2px solid #000}.footer{text-align:center;font-size:10px;margin-top:12px;color:#666}@media print{body{padding:0}}</style></head><body><div class="header"><div class="shop-name">Champ\'s Butcher Shop</div><div class="receipt-label">\u2014 RECEIPT \u2014</div><div class="order-num">#'+(order.orderNumber||"")+'</div></div><div class="info-row"><span>Customer:</span><strong>'+(order.user||"Walk-in")+'</strong></div><div class="info-row"><span>Date:</span><span>'+(order.ts?new Date(order.ts).toLocaleString():"")+'</span></div>'+(order.deliveryLocation?'<div class="info-row"><span>Delivery:</span><span>'+order.deliveryLocation+'</span></div>':"")+'<div class="items">'+items.map(i=>'<div class="item"><span>'+i.name+' x'+i.quantity+'</span><span>$'+(i.price*i.quantity).toFixed(2)+'</span></div>').join("")+'</div><div class="total-row"><span>TOTAL</span><span>$'+(order.total||0).toFixed(2)+'</span></div><div class="footer">Thank you!<br>Champ\'s Meats \u2014 Halstead, KS<br>Printed '+new Date().toLocaleString()+'</div><script>window.onload=function(){window.print();}<\/script></body></html>';
    openPrintWindow(html);
  }
  const items = order.items || [];
  return (
    <Modal t={C} title={"Receipt #"+(order.orderNumber||"")} onClose={onClose}>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14,marginBottom:4}}><span style={{color:C.muted}}>Customer</span><span style={{color:C.cream,fontWeight:600}}>{order.user||"Walk-in"}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14,marginBottom:4}}><span style={{color:C.muted}}>Date</span><span style={{color:C.cream}}>{order.ts?new Date(order.ts).toLocaleString():""}</span></div>
        {order.deliveryLocation&&<div style={{display:"flex",justifyContent:"space-between",fontSize:14,marginBottom:4}}><span style={{color:C.muted}}>Delivery</span><span style={{color:C.cream}}>{order.deliveryLocation}</span></div>}
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Status</span><StatusBadge status={normalizeStatus(order.status)}/></div>
      </div>
      <div style={{borderTop:"1px solid "+C.border,borderBottom:"1px solid "+C.border,padding:"12px 0",marginBottom:16}}>
        {items.map((item,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i<items.length-1?"1px solid "+C.border:"none"}}><div><div style={{fontSize:14,color:C.cream}}>{item.name}</div><div style={{fontSize:12,color:C.muted}}>${item.price.toFixed(2)} x {item.quantity}</div></div><div style={{fontFamily:F.display,fontSize:15,color:C.cream,fontWeight:700}}>${(item.price*item.quantity).toFixed(2)}</div></div>)}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><span style={{fontFamily:F.display,fontSize:18,color:C.cream}}>Total</span><span style={{fontFamily:F.display,fontSize:24,fontWeight:900,color:C.red}}>${(order.total||0).toFixed(2)}</span></div>
      <div style={{display:"flex",gap:10}}><Btn t={C} ghost onClick={onClose}>Close</Btn><Btn t={C} primary onClick={printReceipt}>Print Receipt</Btn></div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
function AdminDashboard({ menu, users, orders, dbOps, isMobile, isTablet }) {const{T:C,TF:F}=useAdminTheme();
  const validOrders=orders.filter(o=>normalizeStatus(o.status)!=="cancelled");
  const totalRev=validOrders.reduce((s,o)=>s+(o.total||0),0);
  const onMenu=menu.filter(i=>i.showOnKiosk!==false).length;
  const itemCounts={};validOrders.forEach(o=>o.items?.forEach(i=>{itemCounts[i.name]=(itemCounts[i.name]||0)+(i.quantity||0);}));
  const topItems=Object.entries(itemCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const todayStr=new Date().toDateString();
  const todayOrders=validOrders.filter(o=>o.ts&&new Date(o.ts).toDateString()===todayStr);
  const todayRev=todayOrders.reduce((s,o)=>s+(o.total||0),0);
  const [hoveredStat,setHoveredStat]=useState(null);const [deletingId,setDeletingId]=useState(null);const [receiptOrder,setReceiptOrder]=useState(null);const [orderTimeFilter,setOrderTimeFilter]=useState("all");const [orderPage,setOrderPage]=useState(0);
  const [ordersOpen,setOrdersOpen]=useState(!isMobile);const [topItemsOpen,setTopItemsOpen]=useState(!isMobile);
  const ORDER_PAGE_SIZE=10;
  async function deleteOrder(id){setDeletingId(id);try{await dbOps.deleteOrder(id);}catch(e){console.error(e);}finally{setDeletingId(null);}}

  const stats=[
    {label:"Total Orders",  value:validOrders.length,        accent:C.red},
    {label:"Revenue",       value:"$"+totalRev.toFixed(2),  accent:"#b45309"},
    {label:"Menu Items",    value:menu.length,              accent:"#1d4ed8"},
    {label:"On Kiosk",      value:onMenu,                   accent:"#16a34a"},
  ];
  return (
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:isMobile?10:14,marginBottom:22}}>
        {stats.map(s=>(
          <div key={s.label} onMouseEnter={()=>setHoveredStat(s.label)} onMouseLeave={()=>setHoveredStat(null)} style={{background:C.card,border:"1px solid "+(hoveredStat===s.label?s.accent:C.border),borderRadius:14,padding:isMobile?"12px 14px":"16px 18px",position:"relative",cursor:"default",transition:"border .2s"}}>
            <div style={{fontSize:isMobile?10:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:isMobile?6:10}}>{s.label}</div>
            <div style={{fontFamily:F.display,fontSize:isMobile?22:28,fontWeight:900,color:s.accent}}>{s.value}</div>
            {!isMobile&&hoveredStat==="Revenue"&&s.label==="Revenue"&&(
              <div style={{position:"absolute",top:"100%",left:0,zIndex:100,marginTop:6,background:C.surface,border:"1px solid "+C.borderMid,borderRadius:12,padding:"14px 16px",minWidth:320,boxShadow:"0 12px 40px rgba(0,0,0,.7)",animation:"fadeUp .15s ease"}}>
                <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:10}}>Today's Revenue {"\u2014"} {todayOrders.length} order{todayOrders.length!==1?"s":""}</div>
                <div style={{fontFamily:F.display,fontSize:22,fontWeight:900,color:"#b45309",marginBottom:12}}>${todayRev.toFixed(2)}</div>
                {todayOrders.length===0?<div style={{fontSize:13,color:C.muted}}>No orders today yet</div>:(
                  <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto"}}>
                    {todayOrders.map(o=><div key={o.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",background:C.card,borderRadius:8,border:"1px solid "+C.border}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:C.cream,fontWeight:600}}>#{o.orderNumber||"\u2014"} {"\u2014"} {o.user}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{o.items?.map(i=>i.name+" \u00D7"+i.quantity).join(", ")}</div></div><div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}><div style={{fontFamily:F.display,fontSize:14,color:"#b45309",fontWeight:700}}>${(o.total||0).toFixed(2)}</div><button onClick={e=>{e.stopPropagation();deleteOrder(o.id);}} disabled={deletingId===o.id} style={{background:C.errorBg,border:"none",color:C.errorText,borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",opacity:deletingId===o.id?.5:1}}>{"\u2715"}</button></div></div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?12:18,marginBottom:18}}>
        <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:isMobile?"14px 16px":"18px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:ordersOpen?14:0,cursor:isMobile?"pointer":"default"}} onClick={()=>isMobile&&setOrdersOpen(p=>!p)}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {isMobile&&<span style={{color:C.muted,fontSize:14,display:"inline-block",transform:ordersOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>{"\u203A"}</span>}
              <div style={{fontFamily:F.display,fontSize:isMobile?15:17,fontWeight:700,letterSpacing:1}}>Orders</div>
            </div>
            {ordersOpen&&<select value={orderTimeFilter} onClick={e=>e.stopPropagation()} onChange={e=>{setOrderTimeFilter(e.target.value);setOrderPage(0);}} style={{background:C.surface,border:"1px solid "+C.borderMid,borderRadius:8,padding:"5px 10px",color:C.cream,fontFamily:F.body,fontSize:12,cursor:"pointer"}}><option value="all">All Time</option><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select>}
          </div>
          {ordersOpen&&(()=>{const now=new Date();const filtered=validOrders.filter(o=>{if(orderTimeFilter==="all")return true;if(!o.ts)return false;const d=new Date(o.ts);if(orderTimeFilter==="today")return d.toDateString()===now.toDateString();if(orderTimeFilter==="week"){const wa=new Date(now);wa.setDate(wa.getDate()-7);return d>=wa;}if(orderTimeFilter==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true;});const filteredRev=filtered.reduce((s,o)=>s+(o.total||0),0);
            return <><div style={{fontSize:12,color:C.muted,marginBottom:10}}>{filtered.length} order{filtered.length!==1?"s":""} — <span style={{color:C.red,fontFamily:F.display,fontWeight:700}}>${filteredRev.toFixed(2)}</span></div>
              {filtered.length===0?<div style={{color:C.muted,fontSize:14,textAlign:"center",padding:"20px 0"}}>No orders for this period</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>{filtered.slice(orderPage*ORDER_PAGE_SIZE,(orderPage+1)*ORDER_PAGE_SIZE).map(o=><div key={o.id} className="row-hover" onClick={()=>setReceiptOrder(o)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 9px",borderRadius:8,transition:"background .15s",cursor:"pointer"}}><div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>#{o.orderNumber||"\u2014"} — {o.user}</div><div style={{fontSize:12,color:C.muted}}>{o.ts?new Date(o.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):""}</div></div><div style={{fontFamily:F.display,fontSize:15,color:C.red,fontWeight:700}}>${(o.total||0).toFixed(2)}</div></div>)}</div>
              )}</>;
          })()}
        </div>
        {receiptOrder&&<ReceiptModal order={receiptOrder} onClose={()=>setReceiptOrder(null)}/>}
        <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:isMobile?"14px 16px":"18px 20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:topItemsOpen?14:0,cursor:isMobile?"pointer":"default"}} onClick={()=>isMobile&&setTopItemsOpen(p=>!p)}>
            {isMobile&&<span style={{color:C.muted,fontSize:14,display:"inline-block",transform:topItemsOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>{"\u203A"}</span>}
            <div style={{fontFamily:F.display,fontSize:isMobile?15:17,fontWeight:700,letterSpacing:1}}>Top Ordered Items</div>
          </div>
          {topItemsOpen&&(topItems.length===0?<div style={{color:C.muted,fontSize:14,textAlign:"center",padding:"20px 0"}}>No data yet</div>:(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>{topItems.map(([name,qty],i)=><div key={name} style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontFamily:F.display,fontSize:16,color:C.borderMid,fontWeight:900,minWidth:22}}>{i+1}</div><div style={{flex:1}}><div style={{fontSize:14,color:C.cream,marginBottom:3}}>{name}</div><div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:C.red,width:Math.min(100,(qty/topItems[0][1])*100)+"%",borderRadius:2}}/></div></div><div style={{fontSize:12,color:C.muted,minWidth:38,textAlign:"right"}}>{qty} sold</div></div>)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU MANAGER — Full CRUD + kiosk toggle + drag reorder (no stock/SKU)
// ═══════════════════════════════════════════════════════════════════════════════
function MenuManager({ menu, catNames, dbOps, showToast, isMobile }) {const{T:C,TF:F}=useAdminTheme();
  const blank={name:"",description:"",price:"",category:catNames[0]||"Other",image:"",isBundle:false,bundleItems:[],showOnKiosk:true,stock:"",inStock:true};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [search,setSearch]=useState("");const [filter,setFilter]=useState("All");const [viewFilter,setViewFilter]=useState("all");const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState({});const [dragIdx,setDragIdx]=useState(null);const [overIdx,setOverIdx]=useState(null);const dragNodeRef=useRef(null);
  const [selectMode,setSelectMode]=useState(false);const [selected,setSelected]=useState(new Set());const [confirmBulkDel,setConfirmBulkDel]=useState(false);
  const onCount=menu.filter(i=>i.showOnKiosk!==false).length;const offCount=menu.length-onCount;
  const onMenuSorted=menu.filter(i=>i.showOnKiosk!==false).sort((a,b)=>(a.menuOrder||999)-(b.menuOrder||999));
  const displayed=menu.filter(i=>{const matchCat=filter==="All"||i.category===filter;const matchSearch=i.name.toLowerCase().includes(search.toLowerCase());const matchView=viewFilter==="all"||(viewFilter==="on"&&i.showOnKiosk!==false)||(viewFilter==="off"&&i.showOnKiosk===false);return matchCat&&matchSearch&&matchView;}).sort((a,b)=>{const aOn=a.showOnKiosk!==false?0:1;const bOn=b.showOnKiosk!==false?0:1;if(aOn!==bOn)return aOn-bOn;return(a.menuOrder||999)-(b.menuOrder||999);});
  async function saveItem(item){if(saving._save)return;setSaving(prev=>({...prev,_save:true}));try{const data={name:item.name.trim(),description:item.description||"",price:parseFloat(item.price)||0,category:item.category,image:item.image||"",isBundle:!!item.isBundle,bundleItems:item.isBundle?(item.bundleItems||[]).filter(b=>b.itemId&&b.quantity>0):[],showOnKiosk:item.showOnKiosk!==false,menuOrder:item.menuOrder||999,sku:item.sku||"",barcodeImage:item.barcodeImage||"",stock:item.stock===""?null:parseInt(item.stock)||0,inStock:item.stock===""?true:(parseInt(item.stock)||0)>0};if(isNew){await dbOps.addMenuItem(data);showToast("Item added");}else{await dbOps.updateMenuItem(item.id,data);showToast("Item updated");}setEditing(null);}catch(e){console.error(e);showToast("Save failed","error");}finally{setSaving(prev=>{const n={...prev};delete n._save;return n;});}}
  async function deleteItem(id){try{await dbOps.deleteMenuItem(id);showToast("Item removed","error");setConfirmDel(null);}catch(e){console.error(e);showToast("Delete failed","error");}}
  async function toggleKiosk(item){const newVal=item.showOnKiosk===false;setSaving(prev=>({...prev,[item.id]:true}));try{await dbOps.updateMenuItem(item.id,{showOnKiosk:newVal});showToast(item.name+(newVal?" added to":" removed from")+" kiosk");}catch(e){console.error(e);showToast("Update failed","error");}finally{setSaving(prev=>{const n={...prev};delete n[item.id];return n;});}}
  function handleDragStart(e,idx){setDragIdx(idx);dragNodeRef.current=e.target.closest("[data-row]");e.dataTransfer.effectAllowed="move";setTimeout(()=>{if(dragNodeRef.current)dragNodeRef.current.style.opacity="0.35";},0);}
  function handleDragOver(e,idx){e.preventDefault();e.dataTransfer.dropEffect="move";if(idx!==overIdx)setOverIdx(idx);}
  async function handleDrop(e,dropIdx){e.preventDefault();if(dragIdx===null||dragIdx===dropIdx){setDragIdx(null);setOverIdx(null);return;}const dragItem=onMenuSorted[dragIdx];const dropItem=onMenuSorted[dropIdx];if(!dragItem||!dropItem)return;const orderA=dragItem.menuOrder??dragIdx;const orderB=dropItem.menuOrder??dropIdx;setSaving(prev=>({...prev,[dragItem.id]:true,[dropItem.id]:true}));try{await dbOps.updateMenuItem(dragItem.id,{menuOrder:orderB});await dbOps.updateMenuItem(dropItem.id,{menuOrder:orderA});}catch(e2){console.error(e2);showToast("Reorder failed","error");}finally{setSaving(prev=>{const n={...prev};delete n[dragItem.id];delete n[dropItem.id];return n;});}setDragIdx(null);setOverIdx(null);}
  function handleDragEnd(){if(dragNodeRef.current)dragNodeRef.current.style.opacity="1";setDragIdx(null);setOverIdx(null);dragNodeRef.current=null;}
  function toggleSelect(id){setSelected(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function toggleSelectAll(){const visibleIds=displayed.map(i=>i.id);const allSelected=visibleIds.length>0&&visibleIds.every(id=>selected.has(id));if(allSelected){setSelected(prev=>{const next=new Set(prev);visibleIds.forEach(id=>next.delete(id));return next;});}else{setSelected(prev=>{const next=new Set(prev);visibleIds.forEach(id=>next.add(id));return next;});}}
  async function deleteSelected(){if(selected.size===0)return;setSaving(prev=>({...prev,_bulk:true}));try{for(const id of selected){await dbOps.deleteMenuItem(id);}showToast(selected.size+" item"+(selected.size!==1?"s":"")+" deleted","error");setSelected(new Set());}catch(e){console.error(e);showToast("Delete failed","error");}finally{setSaving(prev=>{const n={...prev};delete n._bulk;return n;});}}
  return (
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr 1fr":"repeat(3,1fr)",gap:isMobile?8:12,marginBottom:20}}>
        {[{label:"Total Items",value:menu.length,color:C.cream},{label:"On Kiosk",value:onCount,color:C.greenText},{label:"Hidden",value:offCount,color:C.muted}].map(s=><div key={s.label} style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 16px"}}><div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:8}}>{s.label}</div><div style={{fontFamily:F.display,fontSize:26,fontWeight:900,color:s.color}}>{s.value}</div></div>)}
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items\u2026" style={{...inputSt(false,C),flex:1,minWidth:180}}/>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={inputSt(true,C)}><option value="All">All Categories</option>{catNames.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <div style={{display:"flex",gap:4,background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:3}}>{[{id:"all",label:"All ("+menu.length+")"},{id:"on",label:"On ("+onCount+")"},{id:"off",label:"Off ("+offCount+")"}].map(f=><button key={f.id} onClick={()=>setViewFilter(f.id)} style={{background:viewFilter===f.id?C.surface:"transparent",border:"1px solid "+(viewFilter===f.id?C.borderMid:"transparent"),color:viewFilter===f.id?C.cream:C.muted,borderRadius:7,padding:"5px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:600,transition:"all .15s"}}>{f.label}</button>)}</div>
        <Btn t={C} primary onClick={()=>{setEditing({...blank,category:catNames[0]||"Other"});setIsNew(true);}}>+ Add Item</Btn>
        <button onClick={()=>{setSelectMode(p=>!p);if(selectMode)setSelected(new Set());}} style={{background:selectMode?C.surface:"rgba(255,255,255,.03)",border:"1px solid "+(selectMode?C.red:C.border),color:selectMode?C.cream:C.muted,borderRadius:8,padding:"7px 14px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:700,transition:"all .15s"}}>{selectMode?"\u2717 Cancel":"\u2610 Select"}</button>
        {selectMode&&selected.size>0&&<button onClick={()=>setConfirmBulkDel(true)} disabled={saving._bulk} style={{background:C.red,border:"none",color:C.cream,borderRadius:8,padding:"7px 14px",cursor:saving._bulk?"wait":"pointer",fontFamily:F.body,fontSize:12,fontWeight:700,opacity:saving._bulk?.5:1}}>Delete Selected ({selected.size})</button>}
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}><div style={{overflowX:"auto"}}><div style={{minWidth:750}}>
        <div style={{display:"grid",gridTemplateColumns:(selectMode?"36px ":"")+"44px 60px 1fr 130px 90px 100px 140px",borderBottom:"1px solid "+C.border,padding:"9px 16px",alignItems:"center"}}>{selectMode&&<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><input type="checkbox" checked={displayed.length>0&&displayed.every(i=>selected.has(i.id))} onChange={toggleSelectAll} style={{width:16,height:16,accentColor:C.red,cursor:"pointer"}}/></div>}{["","Image","Name","Category","Price","Kiosk","Actions"].map(h=><div key={h||"order"} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {displayed.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No items found</div>:displayed.map((item,dispIdx)=>{const isOn=item.showOnKiosk!==false;const isSavingThis=saving[item.id];const onIdx=onMenuSorted.indexOf(item);return(
          <div key={item.id} data-row className="row-hover" draggable={isOn&&!selectMode} onDragStart={e=>isOn&&!selectMode&&handleDragStart(e,onIdx)} onDragOver={e=>isOn&&!selectMode&&handleDragOver(e,onIdx)} onDrop={e=>isOn&&!selectMode&&handleDrop(e,onIdx)} onDragEnd={handleDragEnd} style={{display:"grid",gridTemplateColumns:(selectMode?"36px ":"")+"44px 60px 1fr 130px 90px 100px 140px",borderBottom:"1px solid "+C.border,padding:"10px 16px",alignItems:"center",transition:"background .15s",opacity:isOn?1:.6,background:selected.has(item.id)?"rgba(155,28,28,.08)":overIdx===onIdx&&dragIdx!==onIdx?"rgba(155,28,28,.15)":"transparent",borderTop:overIdx===onIdx&&dragIdx!==onIdx?"2px solid "+C.red:"2px solid transparent"}}>
            {selectMode&&<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSelect(item.id)} style={{width:16,height:16,accentColor:C.red,cursor:"pointer"}}/></div>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:isOn&&!selectMode?"grab":"default",userSelect:"none"}}>{isOn&&!selectMode?<span style={{fontSize:18,color:isSavingThis?C.border:C.muted,lineHeight:1}} title="Drag to reorder">{"\u2801\u2801\u2801"}</span>:<span style={{fontSize:10,color:C.border}}>{isOn&&selectMode?"":"\u2014"}</span>}</div>
            <Img src={item.image} alt={item.name} style={{width:44,height:44,objectFit:"cover",borderRadius:7,border:"1px solid "+C.border}}/>
            <div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{item.name}{item.isBundle&&<span style={{background:"#1e40af",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,marginLeft:8,letterSpacing:1,verticalAlign:"middle"}}>BUNDLE</span>}{item.qbItemId&&<span style={{background:"#0b5e2b",color:"#7ee8a8",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,marginLeft:8,letterSpacing:1,verticalAlign:"middle"}}>QB</span>}</div><div style={{fontSize:12,color:C.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>{item.description}</div></div>
            <div><span style={{background:C.surface,border:"1px solid "+C.border,borderRadius:5,padding:"3px 9px",fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>{item.category}</span></div>
            <div style={{fontFamily:F.display,fontSize:15,color:C.red,fontWeight:700}}>${(item.price||0).toFixed(2)}</div>
            <div><button onClick={()=>toggleKiosk(item)} disabled={isSavingThis} style={{background:isOn?C.green:C.surface,color:isOn?C.greenText:C.muted,border:"1px solid "+(isOn?"rgba(74,222,128,.3)":C.border),borderRadius:20,padding:"6px 14px",cursor:isSavingThis?"wait":"pointer",fontFamily:F.body,fontSize:12,fontWeight:700,transition:"all .2s",opacity:isSavingThis?.5:1,minWidth:80,textAlign:"center"}}>{isSavingThis?"\u2026":isOn?"\u25CF On":"\u25CB Off"}</button></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button onClick={()=>{setEditing({...item,price:String(item.price),showOnKiosk:item.showOnKiosk!==false});setIsNew(false);}} style={smallBtn(false,false,C)}>Edit</button><button onClick={()=>setConfirmDel(item.id)} style={smallBtn(true,false,C)}>Del</button></div>
          </div>);})}
      </div></div></div>
      {editing&&<ItemModal item={editing} isNew={isNew} saving={saving._save} catNames={catNames} menu={menu} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveItem(editing)} onClose={()=>setEditing(null)}/>}
      {confirmDel&&<ConfirmModal t={C}message={"Delete \""+((menu.find(m=>m.id===confirmDel)||{}).name||"")+"\"? This cannot be undone."} confirmLabel="Delete Item" danger onConfirm={()=>deleteItem(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
      {confirmBulkDel&&<ConfirmModal t={C}message={"Delete "+selected.size+" selected item"+(selected.size!==1?"s":"")+"? This cannot be undone."} confirmLabel={"Delete "+selected.size+" Item"+(selected.size!==1?"s":"")} danger onConfirm={()=>{setConfirmBulkDel(false);deleteSelected();}} onClose={()=>setConfirmBulkDel(false)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Item Modal
// ═══════════════════════════════════════════════════════════════════════════════
function ItemModal({item,isNew,saving,catNames,onChange,onSave,onClose,menu}){const{T:C,TF:F}=useAdminTheme();const isQB=!!item.qbItemId;
  const invalid=!item.name.trim()||!item.price||isNaN(parseFloat(item.price));const nonBundleItems=(menu||[]).filter(m=>!m.isBundle&&m.id!==item.id);const bundleItems=item.bundleItems||[];
  const [uploading,setUploading]=useState(false);const [uploadingBarcode,setUploadingBarcode]=useState(false);
  function addBundleItem(){onChange({bundleItems:[...bundleItems,{itemId:nonBundleItems[0]?.id||"",quantity:1}]});}
  function updateBundleItem(idx,field,val){const updated=[...bundleItems];updated[idx]={...updated[idx],[field]:val};onChange({bundleItems:updated});}
  function removeBundleItem(idx){onChange({bundleItems:bundleItems.filter((_,i)=>i!==idx)});}
  async function handlePhotoUpload(e){const file=e.target.files?.[0];if(!file)return;setUploading(true);try{const path="menu-images/"+Date.now()+"_"+file.name;const storageRef=ref(storage,path);await uploadBytes(storageRef,file);const url=await getDownloadURL(storageRef);onChange({image:url});}catch(err){console.error(err);}finally{setUploading(false);}}
  async function handleBarcodeUpload(e){const file=e.target.files?.[0];if(!file)return;setUploadingBarcode(true);try{const path="barcode-images/"+Date.now()+"_"+file.name;const storageRef=ref(storage,path);await uploadBytes(storageRef,file);const url=await getDownloadURL(storageRef);onChange({barcodeImage:url});}catch(err){console.error(err);}finally{setUploadingBarcode(false);}}
  const readOnlySt={...inputSt(false,C),opacity:0.6,cursor:"not-allowed",background:C.surface};
  return(<Modal t={C} title={isNew?"Add Menu Item":"Edit Menu Item"} onClose={onClose} wide>
    {isQB&&<div style={{background:"#0b5e2b",border:"1px solid #2CA01C",borderRadius:10,padding:"10px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10,fontSize:13,color:"#7ee8a8"}}><span style={{fontWeight:700}}>QB</span> Synced from QuickBooks — name, price, SKU, and stock are managed in QB. Use "Refresh Stock" to update.</div>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}><Field t={C} label="Item Name *"><input value={item.name} onChange={isQB?undefined:e=>onChange({name:e.target.value})} readOnly={isQB} placeholder="e.g. Ribeye Steak" style={isQB?readOnlySt:inputSt(false,C)}/></Field><Field t={C} label="Price ($) *"><input value={item.price} onChange={isQB?undefined:e=>onChange({price:e.target.value})} readOnly={isQB} placeholder="0.00" type="number" step="0.01" style={isQB?readOnlySt:inputSt(false,C)}/></Field></div>
    <Field t={C} label="Description" style={{marginBottom:14}}><textarea value={item.description||""} onChange={e=>onChange({description:e.target.value})} rows={3} placeholder="Brief description" style={{...inputSt(false,C),resize:"vertical"}}/></Field>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}><Field t={C} label="Category"><select value={item.category} onChange={e=>onChange({category:e.target.value})} style={inputSt(true,C)}>{(catNames||[]).map(c=><option key={c} value={c}>{c}</option>)}</select></Field><Field t={C} label="SKU"><input value={item.sku||""} onChange={isQB?undefined:e=>onChange({sku:e.target.value})} readOnly={isQB} placeholder="e.g. RIB-001, GB-5LB" style={isQB?readOnlySt:inputSt(false,C)}/></Field><Field t={C} label="Stock Qty"><input value={item.stock===null||item.stock===undefined?"":item.stock} onChange={isQB?undefined:e=>onChange({stock:e.target.value})} readOnly={isQB} placeholder="Leave blank = unlimited" type="number" min="0" style={isQB?readOnlySt:inputSt(false,C)}/></Field></div>
    <Field t={C} label="Product Photo" style={{marginBottom:14}}>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <label style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{uploading?"Uploading\u2026":"Upload Photo"}<input type="file" accept="image/*" onChange={handlePhotoUpload} style={{display:"none"}}/></label>
        <div style={{fontSize:12,color:C.muted}}>or</div>
        <input value={item.image||""} onChange={e=>onChange({image:e.target.value})} placeholder="Paste image URL\u2026" style={{...inputSt(false,C),flex:1}}/>
      </div>
    </Field>
    {item.image&&<div style={{marginBottom:14}}><Img src={item.image} alt="preview" style={{height:110,width:"100%",objectFit:"cover",borderRadius:10,border:"1px solid "+C.border}}/></div>}
    <Field t={C} label="Barcode Image" style={{marginBottom:14}}>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <label style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{uploadingBarcode?"Uploading\u2026":"Upload Barcode"}<input type="file" accept="image/*" onChange={handleBarcodeUpload} style={{display:"none"}}/></label>
        {item.barcodeImage&&<button onClick={()=>onChange({barcodeImage:""})} style={{background:C.errorBg,border:"none",color:C.errorText,borderRadius:7,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>Remove</button>}
      </div>
    </Field>
    {item.barcodeImage&&<div style={{marginBottom:14,background:"#fff",borderRadius:10,padding:"10px",display:"flex",justifyContent:"center"}}><img src={item.barcodeImage} alt="barcode" style={{maxHeight:80,objectFit:"contain"}}/></div>}
    <Field t={C} label="Show on Kiosk" style={{marginBottom:14}}><button onClick={()=>onChange({showOnKiosk:!item.showOnKiosk})} style={{width:"100%",background:item.showOnKiosk?"rgba(22,101,52,.2)":"rgba(255,255,255,.03)",color:item.showOnKiosk?C.greenText:C.muted,border:"1px solid "+(item.showOnKiosk?"rgba(74,222,128,.3)":C.border),borderRadius:10,padding:"10px 13px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,textAlign:"left",transition:"all .2s"}}>{item.showOnKiosk?"\u25CF Visible on kiosk":"\u25CB Hidden from kiosk"}</button></Field>
    <Field t={C} label="Bundle" style={{marginBottom:14}}><button onClick={()=>onChange({isBundle:!item.isBundle,bundleItems:item.isBundle?[]:(item.bundleItems||[])})} style={{width:"100%",background:item.isBundle?"#1e40af":C.surface,color:item.isBundle?C.cream:C.muted,border:"1px solid "+(item.isBundle?"#3b82f6":C.border),borderRadius:10,padding:"10px 13px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,textAlign:"left",transition:"all .2s"}}>{item.isBundle?"\u25C6 This is a Bundle":"\u25CB Regular item \u2014 click to make a bundle"}</button></Field>
    {item.isBundle&&<Field t={C} label="Bundle Contents" style={{marginBottom:14}}><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:12}}>{bundleItems.length===0&&<div style={{fontSize:12,color:C.muted,padding:"8px 0",textAlign:"center"}}>No items added yet</div>}{bundleItems.map((bi,idx)=><div key={idx} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><select value={bi.itemId} onChange={e=>updateBundleItem(idx,"itemId",e.target.value)} style={{...inputSt(true),flex:1}}><option value="">Select item\u2026</option>{nonBundleItems.map(m=><option key={m.id} value={m.id}>{m.name} (${(m.price||0).toFixed(2)})</option>)}</select><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:C.muted}}>Qty:</span><input type="number" min="1" max="99" value={bi.quantity} onChange={e=>updateBundleItem(idx,"quantity",Math.max(1,parseInt(e.target.value)||1))} style={{...inputSt(false,C),width:55,textAlign:"center"}}/></div><button onClick={()=>removeBundleItem(idx)} style={{background:C.errorBg,border:"none",color:C.errorText,cursor:"pointer",fontSize:14,width:32,height:32,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{"\u2715"}</button></div>)}<button onClick={addBundleItem} disabled={nonBundleItems.length===0} style={{background:C.surface,border:"1px dashed "+C.border,color:C.muted,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:600,width:"100%",marginTop:4}}>+ Add Item to Bundle</button></div>{bundleItems.length>0&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Items value: ${bundleItems.reduce((sum,bi)=>{const m=nonBundleItems.find(x=>x.id===bi.itemId);return sum+(m?(m.price||0)*bi.quantity:0);},0).toFixed(2)} {"\u2014"} Bundle price: ${parseFloat(item.price||0).toFixed(2)}</div>}</Field>}
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn t={C} ghost onClick={onClose}>Cancel</Btn><Btn t={C} primary onClick={onSave} disabled={invalid||saving||uploading||uploadingBarcode}>{saving?"Saving\u2026":isNew?"Add Item":"Save Changes"}</Btn></div>
  </Modal>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Categories Manager
// ═══════════════════════════════════════════════════════════════════════════════
function CategoriesManager({ categories, menu, dbOps, showToast }) {const{T:C,TF:F}=useAdminTheme();
  const [newName,setNewName]=useState("");const [editingId,setEditingId]=useState(null);const [editName,setEditName]=useState("");const [saving,setSaving]=useState(false);const inputRef=useRef(null);
  const [dragIdx,setDragIdx]=useState(null);const [overIdx,setOverIdx]=useState(null);const dragNodeRef=useRef(null);const [reordering,setReordering]=useState(false);
  async function handleAdd(){const name=newName.trim();if(!name)return;if(categories.find(c=>c.name.toLowerCase()===name.toLowerCase())){showToast("That category already exists","error");return;}setSaving(true);try{await dbOps.addCategory(name);setNewName("");showToast('"'+name+'" category added');inputRef.current?.focus();}catch(e){console.error(e);showToast("Add failed","error");}finally{setSaving(false);}}
  async function handleRename(id){const name=editName.trim();if(!name)return;if(categories.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.id!==id)){showToast("That name is already taken","error");return;}setSaving(true);try{await dbOps.renameCategory(id,name);setEditingId(null);showToast("Category renamed");}catch(e){console.error(e);showToast("Rename failed","error");}finally{setSaving(false);}}
  async function handleDelete(cat){const inUse=menu.filter(i=>i.category===cat.name).length;if(inUse>0){try{const batch=writeBatch(db);menu.filter(i=>i.category===cat.name).forEach(item=>{batch.update(doc(db,"kioskMenu",item.id),{category:"Uncategorized"});});batch.delete(doc(db,"kioskCategories",cat.id));await batch.commit();showToast('"'+cat.name+'" deleted \u2014 '+inUse+' item'+(inUse!==1?"s":"")+" moved to Uncategorized");}catch(e){console.error(e);showToast("Delete failed","error");}}else{try{await dbOps.deleteCategory(cat.id);showToast('"'+cat.name+'" removed',"error");}catch(e){console.error(e);showToast("Delete failed","error");}}}
  function handleDragStart(e,idx){setDragIdx(idx);dragNodeRef.current=e.target.closest("[data-cat-row]");e.dataTransfer.effectAllowed="move";setTimeout(()=>{if(dragNodeRef.current)dragNodeRef.current.style.opacity="0.35";},0);}
  function handleDragOver(e,idx){e.preventDefault();e.dataTransfer.dropEffect="move";if(idx!==overIdx)setOverIdx(idx);}
  function handleDragEnd(){if(dragNodeRef.current)dragNodeRef.current.style.opacity="1";setDragIdx(null);setOverIdx(null);dragNodeRef.current=null;}
  async function handleDrop(e,dropIdx){e.preventDefault();if(dragIdx===null||dragIdx===dropIdx){handleDragEnd();return;}setReordering(true);try{const reordered=[...categories];const [moved]=reordered.splice(dragIdx,1);reordered.splice(dropIdx,0,moved);const batch=writeBatch(db);reordered.forEach((cat,i)=>{if(cat.sortOrder!==i)batch.update(doc(db,"kioskCategories",cat.id),{sortOrder:i});});await batch.commit();showToast("Categories reordered");}catch(e2){console.error(e2);showToast("Reorder failed","error");}finally{setReordering(false);handleDragEnd();}}
  return (
    <div style={{animation:"fadeUp .3s ease",maxWidth:580}}>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"18px 20px",marginBottom:18}}>
        <div style={{fontSize:12,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:12}}>Add New Category</div>
        <div style={{display:"flex",gap:10}}><input ref={inputRef} value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="e.g. BBQ, Spices, Seafood\u2026" style={{...inputSt(false,C),flex:1}}/><Btn t={C} primary onClick={handleAdd} disabled={!newName.trim()||saving}>{saving?"Adding\u2026":"+ Add"}</Btn></div>
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"44px 1fr 80px 110px",borderBottom:"1px solid "+C.border,padding:"9px 18px"}}>{["","Category Name","Items","Actions"].map(h=><div key={h||"drag"} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {categories.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No categories yet</div>:categories.map((cat,idx)=>{const itemCount=menu.filter(i=>i.category===cat.name).length;const isEditing=editingId===cat.id;return(
          <div key={cat.id} data-cat-row className="row-hover" draggable={!isEditing} onDragStart={e=>!isEditing&&handleDragStart(e,idx)} onDragOver={e=>!isEditing&&handleDragOver(e,idx)} onDrop={e=>handleDrop(e,idx)} onDragEnd={handleDragEnd} style={{display:"grid",gridTemplateColumns:"44px 1fr 80px 110px",borderBottom:"1px solid "+C.border,padding:"11px 18px",alignItems:"center",transition:"background .15s",background:overIdx===idx&&dragIdx!==idx?"rgba(155,28,28,.15)":"transparent",borderTop:overIdx===idx&&dragIdx!==idx?"2px solid "+C.red:"2px solid transparent",opacity:reordering?.5:1}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:isEditing?"default":"grab",userSelect:"none"}}><span style={{fontSize:18,color:reordering?C.border:C.muted,lineHeight:1}} title="Drag to reorder">{"\u2801\u2801\u2801"}</span></div>
            <div>{isEditing?<div style={{display:"flex",gap:8}}><input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleRename(cat.id);if(e.key==="Escape")setEditingId(null);}} autoFocus style={{...inputSt(false,C),padding:"6px 10px",fontSize:14}}/><button onClick={()=>handleRename(cat.id)} disabled={!editName.trim()||saving} style={{background:C.green,border:"none",color:C.greenText,borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:13,fontWeight:700}}>{"\u2713"}</button><button onClick={()=>setEditingId(null)} style={{background:C.border,border:"none",color:C.muted,borderRadius:7,padding:"5px 10px",cursor:"pointer",fontSize:13}}>{"\u2715"}</button></div>:<span style={{fontSize:15,color:C.cream,fontWeight:600}}>{cat.name}</span>}</div>
            <div><span style={{fontSize:13,color:itemCount>0?C.mutedLight:C.border}}>{itemCount} item{itemCount!==1?"s":""}</span></div>
            <div style={{display:"flex",gap:6}}>{!isEditing&&<><button onClick={()=>{setEditingId(cat.id);setEditName(cat.name);}} style={smallBtn(false,false,C)}>Rename</button><button onClick={()=>handleDelete(cat)} style={smallBtn(true,false,C)}>Del{itemCount>0?" ("+itemCount+")":""}</button></>}</div>
          </div>);})}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// User Manager
// ═══════════════════════════════════════════════════════════════════════════════
function UserManager({ users, dbOps, showToast, isMobile }) {const{T:C,TF:F}=useAdminTheme();
  const blank={firstName:"",lastName:"",email:"",phone:"",deliveryLocation:DELIVERY_LOCATIONS[0]};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState(false);const [viewing,setViewing]=useState(null);
  function displayName(u){return((u.firstName||"")+" "+(u.lastName||"")).trim()||u.name||"Unnamed";}
  function editUser(user){setEditing({...user,firstName:user.firstName||user.name||"",lastName:user.lastName||"",email:user.email||"",phone:user.phone||"",deliveryLocation:user.deliveryLocation||DELIVERY_LOCATIONS[0]});setIsNew(false);setViewing(null);}
  async function saveUser(user){if(saving)return;if(!(user.firstName||"").trim()||(!(user.email||"").trim()&&!(user.phone||"").trim())){showToast("First name and either email or phone required","error");return;}setSaving(true);try{const data={firstName:(user.firstName||"").trim(),lastName:(user.lastName||"").trim(),email:(user.email||"").trim().toLowerCase(),phone:(user.phone||"").trim(),deliveryLocation:user.deliveryLocation||DELIVERY_LOCATIONS[0]};if(isNew){await dbOps.addUser(data);showToast("Customer added");}else{await dbOps.updateUser(user.id,data);showToast("Customer updated");}setEditing(null);}catch(e){console.error(e);showToast("Save failed","error");}finally{setSaving(false);}}
  async function deleteUser(id){try{await dbOps.deleteUser(id);showToast("Customer removed","error");setConfirmDel(null);setViewing(null);}catch(e){console.error(e);showToast("Delete failed","error");}}
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><div style={{fontSize:13,color:C.muted}}>{users.length} customer{users.length!==1?"s":""} registered</div><Btn t={C} primary onClick={()=>{setEditing({...blank});setIsNew(true);}}>+ Add Customer</Btn></div>

      {/* Mobile: name-only card list */}
      {isMobile?(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {users.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"40px",textAlign:"center",color:C.muted}}>No customers yet</div>
        :users.map(user=>(
          <div key={user.id} onClick={()=>setViewing(user)} style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",transition:"background .15s"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:C.cream,flexShrink:0}}>{(user.firstName||user.name||"?").charAt(0).toUpperCase()}</div>
              <div><div style={{fontSize:15,color:C.cream,fontWeight:600}}>{displayName(user)}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{user.deliveryLocation||"No location"}</div></div>
            </div>
            <span style={{color:C.muted,fontSize:18}}>{"\u203A"}</span>
          </div>
        ))}
      </div>):(
      /* Desktop: full table */
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}><div style={{overflowX:"auto"}}><div style={{minWidth:700}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 180px 140px 160px 100px",borderBottom:"1px solid "+C.border,padding:"9px 18px"}}>{["First Name","Last Name","Email","Phone","Delivery Location","Actions"].map(h=><div key={h} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {users.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No customers yet</div>:users.map(user=><div key={user.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 1fr 180px 140px 160px 100px",borderBottom:"1px solid "+C.border,padding:"13px 18px",alignItems:"center",transition:"background .15s"}}>
          <div style={{fontSize:15,color:C.cream,fontWeight:600}}>{user.firstName||user.name||"—"}</div>
          <div style={{fontSize:15,color:C.cream}}>{user.lastName||""}</div>
          <div style={{fontSize:13,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email||"\u2014"}</div>
          <div style={{fontSize:13,color:C.muted,whiteSpace:"nowrap"}}>{user.phone||"\u2014"}</div>
          <div style={{fontSize:13,color:C.muted,whiteSpace:"nowrap"}}>{user.deliveryLocation||"\u2014"}</div>
          <div style={{display:"flex",gap:6}}><button onClick={()=>editUser(user)} style={smallBtn(false,false,C)}>Edit</button><button onClick={()=>setConfirmDel(user.id)} style={smallBtn(true,false,C)}>Del</button></div>
        </div>)}
      </div></div></div>
      )}

      {/* Mobile: View employee detail modal */}
      {viewing&&<Modal t={C} title={displayName(viewing)} onClose={()=>setViewing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>First Name</span><span style={{color:C.cream,fontWeight:600}}>{viewing.firstName||viewing.name||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Last Name</span><span style={{color:C.cream,fontWeight:600}}>{viewing.lastName||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Email</span><span style={{color:C.cream}}>{viewing.email||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Phone</span><span style={{color:C.cream}}>{viewing.phone||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Delivery Location</span><span style={{color:C.cream}}>{viewing.deliveryLocation||"\u2014"}</span></div>
        </div>
        <div style={{display:"flex",gap:10}}><Btn t={C} ghost onClick={()=>setViewing(null)}>Close</Btn><Btn t={C} primary onClick={()=>editUser(viewing)}>Edit</Btn><button onClick={()=>{setViewing(null);setConfirmDel(viewing.id);}} style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600}}>Delete</button></div>
      </Modal>}

      {editing&&<UserModal user={editing} isNew={isNew} saving={saving} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveUser(editing)} onClose={()=>setEditing(null)}/>}
      {confirmDel&&<ConfirmModal t={C}message={"Remove \""+displayName(users.find(u=>u.id===confirmDel)||{})+"\"?"} confirmLabel="Remove Customer" danger onConfirm={()=>deleteUser(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

function UserModal({user,isNew,saving,onChange,onSave,onClose}){const{T:C,TF:F}=useAdminTheme();
  const invalid=!(user.firstName||"").trim()||(!(user.email||"").trim()&&!(user.phone||"").trim());
  return(<Modal t={C} title={isNew?"Add Customer":"Edit Customer"} onClose={onClose}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
      <Field t={C} label="First Name *"><input value={user.firstName||""} onChange={e=>onChange({firstName:e.target.value})} placeholder="e.g. John" style={inputSt(false,C)}/></Field>
      <Field t={C} label="Last Name"><input value={user.lastName||""} onChange={e=>onChange({lastName:e.target.value})} placeholder="e.g. Smith" style={inputSt(false,C)}/></Field>
    </div>
    <Field t={C} label="Email" style={{marginBottom:14}}><input value={user.email||""} onChange={e=>onChange({email:e.target.value})} placeholder="john@example.com" type="email" style={inputSt(false,C)}/></Field>
    <Field t={C} label="Phone" style={{marginBottom:14}}><input value={user.phone||""} onChange={e=>onChange({phone:e.target.value})} placeholder="(316) 555-1234" type="tel" style={inputSt(false,C)}/></Field>
    <Field t={C} label="Delivery Location" style={{marginBottom:14}}><select value={user.deliveryLocation||DELIVERY_LOCATIONS[0]} onChange={e=>onChange({deliveryLocation:e.target.value})} style={inputSt(true,C)}>{DELIVERY_LOCATIONS.map(loc=><option key={loc} value={loc}>{loc}</option>)}</select></Field>
    <div style={{fontSize:12,color:C.muted,marginBottom:22}}>Email or phone required. Customers set their own password on the kiosk and can reset it using their email and phone number.</div>
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn t={C} ghost onClick={onClose}>Cancel</Btn><Btn t={C} primary onClick={onSave} disabled={invalid||saving}>{saving?"Saving\u2026":isNew?"Add Customer":"Save Changes"}</Btn></div>
  </Modal>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delivery Panel — grouped by location
// ═══════════════════════════════════════════════════════════════════════════════
function DeliveryPanel({ orders, users, dbOps, showToast }) {const{T:C,TF:F}=useAdminTheme();
  const [savingId,setSavingId]=useState(null);
  const deliveryOrders=orders.filter(o=>!o.archived&&normalizeStatus(o.status)==="out_for_delivery");
  const locations=[...new Set(deliveryOrders.map(o=>o.deliveryLocation||"No Location"))].sort();

  // Delivered this week
  const now=new Date();const weekStart=new Date(now);weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
  const deliveredThisWeek=orders.filter(o=>{const s=normalizeStatus(o.status);if(s!=="delivered")return false;const d=o.deliveredAt?new Date(o.deliveredAt):o.archivedAt?new Date(o.archivedAt):null;return d&&d>=weekStart;});
  const deliveredLocations=[...new Set(deliveredThisWeek.map(o=>o.deliveryLocation||"No Location"))].sort();
  const weekTotal=deliveredThisWeek.reduce((s,o)=>s+(o.total||0),0);

  async function markDelivered(order){setSavingId(order.id);try{const deliveredAt=new Date().toISOString();await dbOps.updateOrder(order.id,{status:"delivered",archived:true,archivedAt:deliveredAt,deliveredAt});if(order.user){const matchedUser=users.find(u=>u.name===order.user||((u.firstName||"")+" "+(u.lastName||"")).trim()===order.user);if(matchedUser){await addDoc(collection(db,"kioskUsers",matchedUser.id,"completedOrders"),{orderNumber:order.orderNumber||null,items:order.items||[],total:order.total||0,placedAt:order.ts||null,completedAt:deliveredAt});}}showToast("Delivered \u2713");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingId(null);}}
  async function markAllDelivered(loc){const locOrders=deliveryOrders.filter(o=>(o.deliveryLocation||"No Location")===loc);for(const order of locOrders){await markDelivered(order);}}

  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      {/* Pending Deliveries */}
      {deliveryOrders.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"60px",textAlign:"center",color:C.muted,marginBottom:30}}>No orders awaiting delivery</div>:(
        <>
          <div style={{fontSize:13,color:C.muted,marginBottom:18}}>{deliveryOrders.length} order{deliveryOrders.length!==1?"s":""} awaiting delivery across {locations.length} location{locations.length!==1?"s":""}</div>
          {locations.map(loc=>{const locOrders=deliveryOrders.filter(o=>(o.deliveryLocation||"No Location")===loc);const locTotal=locOrders.reduce((s,o)=>s+(o.total||0),0);return(
            <div key={loc} style={{marginBottom:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:1,color:C.cream}}>{loc}</div><span style={{background:"#6b21a8",color:"#d8b4fe",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{locOrders.length} order{locOrders.length!==1?"s":""}</span><span style={{fontSize:14,color:C.red,fontFamily:F.display,fontWeight:700}}>${locTotal.toFixed(2)}</span></div>
                <button onClick={()=>markAllDelivered(loc)} style={{background:"#6b21a8",color:"#d8b4fe",border:"1px solid #7c3aed",borderRadius:10,padding:"8px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Deliver All at {loc}</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>{locOrders.map(order=>(
                <div key={order.id} style={{background:C.card,border:"1px solid "+C.borderMid,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,color:C.cream,fontWeight:600}}>#{order.orderNumber||""} — {order.user||"Unknown"}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{order.items?.map(i=>i.name+" \u00D7"+i.quantity).join(", ")}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{order.ts?new Date(order.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</div></div>
                  <div style={{fontFamily:F.display,fontSize:20,fontWeight:900,color:C.red,flexShrink:0,marginRight:12}}>${(order.total||0).toFixed(2)}</div>
                  <button onClick={()=>markDelivered(order)} disabled={savingId===order.id} style={{background:"#6b21a8",color:"#d8b4fe",border:"1px solid #7c3aed",borderRadius:10,padding:"10px 20px",cursor:savingId===order.id?"wait":"pointer",fontFamily:F.display,fontSize:14,fontWeight:900,letterSpacing:1,textTransform:"uppercase",opacity:savingId===order.id?.6:1,whiteSpace:"nowrap"}}>{savingId===order.id?"...":"Delivered"}</button>
                </div>))}</div>
            </div>);})}
        </>
      )}

      {/* Delivered This Week */}
      {deliveredThisWeek.length>0&&(
        <div style={{marginTop:10,borderTop:"2px solid "+C.border,paddingTop:24}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:1,color:C.cream}}>Delivered This Week</div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:13,color:C.muted}}>{deliveredThisWeek.length} delivery{deliveredThisWeek.length!==1?"s":""}</span>
              <span style={{fontFamily:F.display,fontSize:16,color:C.greenText,fontWeight:700}}>${weekTotal.toFixed(2)}</span>
            </div>
          </div>
          {deliveredLocations.map(loc=>{const locOrders=deliveredThisWeek.filter(o=>(o.deliveryLocation||"No Location")===loc);const locTotal=locOrders.reduce((s,o)=>s+(o.total||0),0);return(
            <div key={loc} style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{fontFamily:F.display,fontSize:16,fontWeight:700,color:C.cream}}>{loc}</div>
                <span style={{background:C.green,color:C.greenText,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{locOrders.length} delivered</span>
                <span style={{fontSize:13,color:C.greenText,fontFamily:F.display,fontWeight:700}}>${locTotal.toFixed(2)}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>{locOrders.map(order=>(
                <div key={order.id} style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,opacity:.7}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:C.cream}}>#{order.orderNumber||""} — {order.user||"Unknown"}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{order.items?.map(i=>i.name+" \u00D7"+i.quantity).join(", ")}</div></div>
                  <div style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{order.deliveredAt?new Date(order.deliveredAt).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</div>
                  <div style={{fontFamily:F.display,fontSize:16,fontWeight:700,color:C.greenText,flexShrink:0}}>${(order.total||0).toFixed(2)}</div>
                </div>))}</div>
            </div>);})}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// Pick Ticket Printer
// ═══════════════════════════════════════════════════════════════════════════════
function printPickTicket(order, menu){
    const items=order.items||[];const orderNum=String(order.orderNumber||"0000");
    let itemsHtml="";let bcIdx=0;
    items.forEach((i,idx)=>{
      const mi=(menu||[]).find(m=>m.name===i.name);const isBundle=mi&&mi.isBundle;const subs=(isBundle&&mi.bundleItems)||[];
      let h='<tr class="item-row"><td class="cb-col"><div class="cb"></div></td>';
      h+='<td class="qty-col">'+i.quantity+'</td>';
      h+='<td class="name-col"><div class="item-name">'+i.name+(isBundle?' <span class="bundle-tag">BUNDLE</span>':'')+'</div>';
      if(i.sku)h+='<div class="item-sku">SKU: '+i.sku+'</div>';
      if(i.barcodeImage)h+='<div class="item-bc"><img src="'+i.barcodeImage+'" /></div>';
      else if(i.sku){h+='<div class="item-bc"><svg id="item-bc-'+bcIdx+'"></svg></div>';bcIdx++;}
      if(subs.length>0){h+='<div class="bundle-contents"><div class="bundle-hdr">Bundle contains:</div>';subs.forEach(b=>{const si=(menu||[]).find(m=>m.id===b.itemId);if(si){h+='<div class="sub-item"><span class="sub-name">'+si.name+'</span><span class="sub-qty"> x'+(b.quantity*i.quantity)+'</span></div>';if(si.sku)h+='<div class="sub-sku">SKU: '+si.sku+'</div>';}});h+='</div>';}
      h+='</td></tr>';
      itemsHtml+=h;
    });
    const skuBcJs=items.map((i,idx)=>{if(i.sku&&!i.barcodeImage){const id=items.slice(0,idx).filter(x=>x.sku&&!x.barcodeImage).length;return'try{JsBarcode("#item-bc-'+id+'","'+i.sku+'",{format:"CODE128",width:1.6,height:30,displayValue:false,margin:0});}catch(e){console.warn("Barcode render failed:",e);}';}return'';}).filter(Boolean).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pick Ticket #${order.orderNumber||""}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
@page{size:letter;margin:0.6in 0.75in}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#000;line-height:1.4}
.page{max-width:7in;margin:0 auto}
.header{text-align:center;padding-bottom:16px;border-bottom:3px solid #000;margin-bottom:20px}
.shop-name{font-size:28px;font-weight:900;letter-spacing:3px;text-transform:uppercase;margin-bottom:2px}
.shop-sub{font-size:11px;color:#666;letter-spacing:2px;margin-bottom:10px}
.ticket-label{font-size:18px;font-weight:800;letter-spacing:6px;text-transform:uppercase;background:#000;color:#fff;display:inline-block;padding:4px 20px;margin:8px 0}
.order-num{font-size:32px;font-weight:900;margin:8px 0 4px}
.order-barcode{margin:6px 0}
.order-barcode svg{height:50px}
.info{display:flex;gap:40px;margin-bottom:20px;padding:14px 18px;background:#f5f5f5;border-radius:8px;border:1px solid #ddd}
.info-item{display:flex;flex-direction:column}
.info-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#888;margin-bottom:3px}
.info-value{font-size:15px;font-weight:700;color:#000}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#888;padding:8px 6px;border-bottom:2px solid #000;text-align:left}
.cb-col{width:30px;vertical-align:top;padding:12px 6px}
.qty-col{width:40px;vertical-align:top;padding:12px 6px;font-size:18px;font-weight:900;text-align:center}
.name-col{padding:12px 6px;vertical-align:top}
.cb{width:18px;height:18px;border:2px solid #000;border-radius:3px}
.item-row{border-bottom:1px solid #ddd}
.item-row:last-child{border-bottom:2px solid #000}
.item-name{font-size:16px;font-weight:700;margin-bottom:2px}
.bundle-tag{background:#333;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:1px;vertical-align:middle;margin-left:4px}
.item-sku{font-size:12px;color:#555;margin-top:3px;font-family:"Courier New",monospace;font-weight:600}
.item-bc{margin-top:6px}
.item-bc svg{height:30px;max-width:180px}
.item-bc img{max-height:45px;max-width:180px}
.bundle-contents{margin:10px 0 4px;padding:10px 14px;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px}
.bundle-hdr{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#666;margin-bottom:8px}
.sub-item{padding:4px 0;font-size:14px;display:flex;justify-content:space-between;border-bottom:1px dotted #ddd}
.sub-item:last-of-type{border-bottom:none}
.sub-name{font-weight:600}
.sub-qty{font-weight:800;color:#333}
.sub-sku{font-size:11px;color:#777;font-family:"Courier New",monospace;margin:-2px 0 4px;padding-left:4px}
.summary{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:#f5f5f5;border-radius:8px;border:1px solid #ddd;margin-bottom:16px}
.summary-count{font-size:16px;font-weight:800}
.footer{text-align:center;font-size:11px;color:#aaa;padding-top:12px;border-top:1px solid #ddd}
@media print{body{padding:0}.page{max-width:100%}}
</style></head><body>
<div class="page">
<div class="header">
<div class="shop-name">Champ's Butcher Shop</div>
<div class="shop-sub">Halstead, KS</div>
<div class="ticket-label">Pick Ticket</div>
<div class="order-num">#${order.orderNumber||""}</div>
<div class="order-barcode"><svg id="order-bc"></svg></div>
</div>
<div class="info">
<div class="info-item"><div class="info-label">Customer</div><div class="info-value">${order.user||"Walk-in"}</div></div>
<div class="info-item"><div class="info-label">Location</div><div class="info-value">${order.deliveryLocation||"N/A"}</div></div>
<div class="info-item"><div class="info-label">Date</div><div class="info-value">${order.ts?new Date(order.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):""}</div></div>
<div class="info-item"><div class="info-label">Order Total</div><div class="info-value">$${(order.total||0).toFixed(2)}</div></div>
</div>
<table><thead><tr><th></th><th>Qty</th><th>Item</th></tr></thead><tbody>${itemsHtml}</tbody></table>
<div class="summary"><div class="summary-count">${items.reduce((s,i)=>s+i.quantity,0)} total items &middot; ${items.length} line${items.length!==1?"s":""}</div></div>
<div class="footer">Printed ${new Date().toLocaleString()}</div>
</div>
<script>window.onload=function(){try{JsBarcode("#order-bc","${orderNum}",{format:"CODE128",width:2.2,height:50,displayValue:false,margin:0});}catch(e){console.warn("Barcode render failed:",e);}${skuBcJs}window.print();};<\/script>
</body></html>`;
    openPrintWindow(html);
  }

function OrderBarcode({value,small}){
  const{theme}=useAdminTheme();
  const svgRef=useRef(null);
  useEffect(()=>{if(!svgRef.current||!value)return;const smallColor=theme==="light"?"#4a4540":"#e8dcc8";const opts={format:"CODE128",width:small?1.5:3,height:small?40:120,displayValue:true,fontSize:small?12:20,background:"transparent",lineColor:small?smallColor:"#000",textColor:small?smallColor:"#000",margin:small?4:10};const render=()=>{try{window.JsBarcode(svgRef.current,String(value),opts);}catch(e){console.error(e);}};if(!window.JsBarcode){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";s.onload=render;document.head.appendChild(s);}else{render();};},[value,small]);
  return <svg ref={svgRef}/>;
}

function OrderHistory({ orders, users, menu, dbOps, showToast }) {const{T:C,TF:F}=useAdminTheme();
  const [search,setSearch]=useState("");const [expanded,setExpanded]=useState(null);const [confirmClear,setConfirmClear]=useState(false);const [view,setView]=useState("active");const [statusFilter,setStatusFilter]=useState("all");const [savingStatus,setSavingStatus]=useState(null);const [customerFilter,setCustomerFilter]=useState("all");const [scanBarcode,setScanBarcode]=useState(null);const [confirmCancel,setConfirmCancel]=useState(null);
  const terminalStatus="delivered";
  function getStatus(order){return normalizeStatus(order.status);}
  const isCancelled=o=>getStatus(o)==="cancelled";
  const active=orders.filter(o=>!o.archived&&!isCancelled(o)&&getStatus(o)!=="out_for_delivery");
  const cancelled=orders.filter(o=>!o.archived&&isCancelled(o));
  const archived=orders.filter(o=>o.archived);
  const source=view==="active"?active:view==="cancelled"?cancelled:archived;
  const archivedCustomers=[...new Set(archived.map(o=>o.user).filter(Boolean))].sort();
  const filtered=source.filter(o=>{const ms=o.user?.toLowerCase().includes(search.toLowerCase())||String(o.orderNumber||"").includes(search);const mst=statusFilter==="all"||getStatus(o)===statusFilter;const mc=customerFilter==="all"||o.user===customerFilter;return ms&&mst&&mc;});
  const totalRev=filtered.reduce((s,o)=>s+(o.total||0),0);
  const counts=ORDER_STATUSES.reduce((acc,s)=>{acc[s.id]=active.filter(o=>getStatus(o)===s.id).length;return acc;},{});
  async function setStatus(orderId,newStatus){setSavingStatus(orderId);try{await dbOps.updateOrder(orderId,{status:newStatus});}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function printAndPick(order){
    printPickTicket(order,menu);
    if(getStatus(order)==="paid"){setSavingStatus(order.id);try{await dbOps.updateOrder(order.id,{status:"picking"});showToast("Status \u2192 Picking");}catch(e){console.error(e);showToast("Status update failed","error");}finally{setSavingStatus(null);}}
  }
  async function toggleItemChecked(order,itemIndex){const checked=[...(order.checkedItems||[])];const pos=checked.indexOf(itemIndex);if(pos===-1)checked.push(itemIndex);else checked.splice(pos,1);try{await dbOps.updateOrder(order.id,{checkedItems:checked});}catch(e){console.error(e);}}
  async function completeOrder(orderId){setSavingStatus(orderId);try{const order=orders.find(o=>o.id===orderId);const archivedAt=new Date().toISOString();await dbOps.updateOrder(orderId,{status:terminalStatus,archived:true,archivedAt});if(order?.user){const matchedUser=users.find(u=>u.name===order.user);if(matchedUser){await addDoc(collection(db,"kioskUsers",matchedUser.id,"completedOrders"),{orderNumber:order.orderNumber||null,items:order.items||[],total:order.total||0,placedAt:order.ts||null,completedAt:archivedAt});}}showToast("Order completed");if(expanded===orderId)setExpanded(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function restoreOrder(orderId){setSavingStatus(orderId);try{await dbOps.updateOrder(orderId,{status:"picking",archived:false,archivedAt:null,checkedItems:[]});showToast("Order restored");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function cancelOrder(id){setSavingStatus(id);try{await dbOps.updateOrder(id,{status:"cancelled",cancelledAt:new Date().toISOString(),cancelledBy:"admin"});showToast("Order cancelled");setConfirmCancel(null);if(expanded===id)setExpanded(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function restoreCancelled(id){setSavingStatus(id);try{await dbOps.updateOrder(id,{status:"placed",cancelledAt:null,cancelledBy:null});showToast("Order restored");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function handleClearAll(){try{await dbOps.clearOrders();showToast("Orders archived");setConfirmClear(false);setView("active");}catch(e){console.error(e);showToast("Failed","error");}}
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",gap:4,marginBottom:16,background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:4,width:"fit-content"}}>{[{id:"active",label:"Active ("+active.length+")"},{id:"cancelled",label:"Cancelled ("+cancelled.length+")",color:C.errorBg,activeColor:C.errorText},{id:"archived",label:"Archived ("+archived.length+")"}].map(t=><button key={t.id} onClick={()=>{setView(t.id);setExpanded(null);setSearch("");setStatusFilter("all");setCustomerFilter("all");}} style={{background:view===t.id?(t.color||C.red):"transparent",border:"none",color:view===t.id?(t.activeColor||C.cream):C.muted,borderRadius:8,padding:"8px 18px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600,transition:"all .15s"}}>{t.label}</button>)}</div>
      {view==="active"&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setStatusFilter("all")} style={{background:statusFilter==="all"?C.surface:"transparent",border:"1px solid "+(statusFilter==="all"?C.borderMid:C.border),color:statusFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({active.length})</button>{ORDER_STATUSES.filter(s=>s.id!==terminalStatus).map(s=><button key={s.id} onClick={()=>setStatusFilter(s.id)} style={{background:statusFilter===s.id?s.color:"transparent",color:statusFilter===s.id?s.text:C.muted,border:"1px solid "+(statusFilter===s.id?s.color:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:statusFilter===s.id?700:400}}>{s.label} ({counts[s.id]||0})</button>)}</div>}
      {view==="archived"&&archivedCustomers.length>0&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setCustomerFilter("all")} style={{background:customerFilter==="all"?C.surface:"transparent",border:"1px solid "+(customerFilter==="all"?C.borderMid:C.border),color:customerFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({archived.length})</button>{archivedCustomers.map(name=>{const count=archived.filter(o=>o.user===name).length;return<button key={name} onClick={()=>setCustomerFilter(name)} style={{background:customerFilter===name?C.red:"transparent",color:customerFilter===name?C.cream:C.muted,border:"1px solid "+(customerFilter===name?C.red:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:customerFilter===name?700:400}}>{name} ({count})</button>;})}</div>}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search\u2026" style={{...inputSt(false,C),flex:1,minWidth:200}}/><div style={{fontSize:13,color:C.muted}}>{filtered.length} order{filtered.length!==1?"s":""} {"\u00B7"} <span style={{color:C.red,fontFamily:F.display,fontSize:16}}>${totalRev.toFixed(2)}</span></div>{view==="active"&&active.length>0&&<button onClick={()=>setConfirmClear(true)} style={{background:C.amber,border:"1px solid "+C.amber,color:"#1c1400",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Archive All</button>}</div>
      {filtered.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"60px",textAlign:"center",color:C.muted}}>{view==="archived"?"No archived orders":view==="cancelled"?"No cancelled orders":"No orders match your filters"}</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{filtered.map(order=>{const isExpanded=expanded===order.id;const checkedItems=order.checkedItems||[];const totalItems=order.items?.length||0;const allChecked=totalItems>0&&checkedItems.length===totalItems;const curStatus=getStatus(order);const orderCancelled=curStatus==="cancelled";const nextStatuses=ORDER_STATUSES.filter(s=>canTransition(curStatus,s.id));return(
          <div key={order.id} style={{background:orderCancelled?"rgba(69,10,10,.15)":C.card,border:"2px solid "+(orderCancelled?C.red+"44":isExpanded?C.borderMid:C.border),borderRadius:12,overflow:"hidden",transition:"border .2s",opacity:orderCancelled?.75:1}}>
            <div style={{padding:"12px 16px"}}><div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setExpanded(isExpanded?null:order.id)}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:C.muted,fontSize:16,display:"inline-block",transform:isExpanded?"rotate(90deg)":"none",transition:"transform .2s"}}>{"\u203A"}</span><div><div style={{fontSize:14,color:orderCancelled?C.errorText:C.cream,fontWeight:600,textDecoration:orderCancelled?"line-through":"none"}}>{order.user} <span style={{fontFamily:F.mono,fontSize:12,color:C.muted,textDecoration:"none",display:"inline-block"}}>#{order.orderNumber||"\u2014"}</span></div><div style={{fontSize:12,color:C.muted}}>{order.ts?new Date(order.ts).toLocaleString():""}</div>{orderCancelled&&<div style={{fontSize:11,color:C.errorText,marginTop:2}}>Cancelled{order.cancelledBy?" by "+order.cancelledBy:""}{order.cancelledAt?" \u00B7 "+new Date(order.cancelledAt).toLocaleString():""}</div>}</div></div></div>
              {!order.archived&&!orderCancelled&&totalItems>0&&<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:allChecked?C.greenText:C.red,width:(checkedItems.length/totalItems)*100+"%",borderRadius:3,transition:"width .3s"}}/></div><span style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{checkedItems.length}/{totalItems}</span></div>}
              <div style={{fontFamily:F.display,fontSize:16,color:orderCancelled?C.muted:C.red,fontWeight:700,flexShrink:0,textDecoration:orderCancelled?"line-through":"none"}}>${(order.total||0).toFixed(2)}</div>
              {orderCancelled&&<div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>CANCELLED</span><button disabled={savingStatus===order.id} onClick={()=>restoreCancelled(order.id)} style={{background:C.amber,color:"#1c1400",border:"1px solid "+C.amber,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"\u21A9 Restore"}</button></div>}
              {!order.archived&&!orderCancelled&&<div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}><StatusBadge status={curStatus}/>{(curStatus==="placed"||curStatus==="paid")&&<button disabled={savingStatus===order.id} onClick={()=>printAndPick(order)} style={{background:"#1e3a5f",color:"#93c5fd",border:"1px solid #3b82f6",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{"\uD83D\uDDA8"} Print Pick Ticket</button>}{curStatus==="picking"&&<button disabled={savingStatus===order.id} onClick={()=>setStatus(order.id,"out_for_delivery")} style={{background:C.surface,color:"#67e8f9",border:"1px solid #0e7490",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{"\u2192"} Send to Delivery</button>}{nextStatuses.filter(s=>!(curStatus==="paid"&&s.id==="picking")&&!(curStatus==="picking"&&s.id==="out_for_delivery")).map(s=><button key={s.id} disabled={savingStatus===order.id} onClick={()=>setStatus(order.id,s.id)} style={{background:C.surface,color:s.text,border:"1px solid "+s.color,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{"\u2192"} {s.label}</button>)}{curStatus!==terminalStatus&&<button disabled={savingStatus===order.id} onClick={()=>completeOrder(order.id)} style={{background:"#166534",color:"#4ade80",border:"1px solid #22c55e",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"\u2713 Complete"}</button>}{curStatus!==terminalStatus&&<button onClick={()=>setConfirmCancel(order.id)} style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{"\u2715"} Cancel</button>}</div>}
              {order.archived&&<div style={{display:"flex",gap:6,alignItems:"center"}}><StatusBadge status={getStatus(order)}/><button disabled={savingStatus===order.id} onClick={()=>restoreOrder(order.id)} style={{background:C.amber,color:"#1c1400",border:"1px solid "+C.amber,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"\u21A9 Restore"}</button></div>}
            </div></div>
            {isExpanded&&<div style={{borderTop:"1px solid "+(orderCancelled?C.red+"44":C.border),padding:"14px 16px",background:orderCancelled?"rgba(69,10,10,.08)":C.surface}}>
              <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:12}}>{order.archived||orderCancelled?"Order Items":"Pack Checklist"}</div>
              {order.items?.map((item,i)=>{const isChecked=checkedItems.includes(i);const readOnly=order.archived||orderCancelled;return<div key={i} onClick={()=>!readOnly&&toggleItemChecked(order,i)} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 10px",borderRadius:10,marginBottom:6,cursor:readOnly?"default":"pointer",background:isChecked&&!orderCancelled?"rgba(22,101,52,.15)":"rgba(255,255,255,.02)",border:"1px solid "+(isChecked&&!orderCancelled?"rgba(74,222,128,.2)":C.border),opacity:orderCancelled?.5:isChecked?.75:1}}>
                {!readOnly&&<div style={{width:22,height:22,borderRadius:6,border:"2px solid "+(isChecked?C.greenText:C.borderMid),background:isChecked?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{isChecked&&<span style={{color:C.greenText,fontSize:13,fontWeight:900}}>{"\u2713"}</span>}</div>}
                {item.image&&<Img src={item.image} alt={item.name} style={{width:36,height:36,objectFit:"cover",borderRadius:6,flexShrink:0}}/>}
                <div style={{flex:1}}><div style={{fontSize:14,color:isChecked?C.muted:C.cream,fontWeight:600,textDecoration:isChecked?"line-through":"none"}}>{item.name}</div><div style={{fontSize:12,color:C.muted}}>{"\u00D7"} {item.quantity}</div></div>
                <div style={{fontSize:14,color:C.muted,flexShrink:0}}>${((item.price||0)*item.quantity).toFixed(2)}</div>
              </div>;})}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"1px solid "+C.border}}><span style={{fontSize:13,color:C.muted}}>{order.archived&&order.archivedAt?"Archived "+new Date(order.archivedAt).toLocaleString():""}</span><span style={{fontFamily:F.display,fontSize:17,color:C.red,fontWeight:700}}>Total: ${(order.total||0).toFixed(2)}</span></div>
              {order.orderNumber&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+C.border,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>Order Barcode</div>
                <div onClick={()=>setScanBarcode(order.orderNumber)} style={{cursor:"pointer",background:"rgba(255,255,255,.05)",borderRadius:10,padding:"8px 16px",border:"1px solid "+C.border,transition:"background .15s"}} title="Click to enlarge for scanning"><OrderBarcode value={order.orderNumber} small/></div>
                <div style={{fontSize:11,color:C.muted}}>Click barcode to enlarge for scanning</div>
              </div>}
            </div>}
          </div>);})}</div>
      )}
      {scanBarcode&&<div onClick={()=>setScanBarcode(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",animation:"fadeUp .2s ease"}}>
        <div style={{fontSize:12,letterSpacing:3,textTransform:"uppercase",color:C.muted,marginBottom:16}}>Scan Order #{scanBarcode}</div>
        <div style={{background:"#fff",borderRadius:16,padding:"30px 40px",display:"flex",alignItems:"center",justifyContent:"center"}}><OrderBarcode value={scanBarcode}/></div>
        <div style={{fontSize:14,color:C.muted,marginTop:20}}>Click anywhere to close</div>
      </div>}
      {confirmClear&&<ConfirmModal t={C}message={"Archive all "+active.length+" active order"+(active.length!==1?"s":"")+"?"} confirmLabel="Archive All" onConfirm={handleClearAll} onClose={()=>setConfirmClear(false)}/>}
      {confirmCancel&&<ConfirmModal t={C}message={"Cancel this order? It will be moved to the Cancelled tab and can be restored later."} confirmLabel="Cancel Order" danger onConfirm={()=>cancelOrder(confirmCancel)} onClose={()=>setConfirmCancel(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings Panel — tabbed: Appearance, Staff & Access, Store Info, Notifications
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsPanel({ showToast, adminAccounts, dbOps, currentAdmin, isSuperAdmin, categories }) {
  const { T: C, TF: F, theme, setTheme, fontId, setFontId, logoUrl, setLogoUrl } = useAdminTheme();
  const [stab, setStab] = useState("appearance");
  const tabs=[{id:"appearance",label:"Appearance"},{id:"staff",label:"Staff & Access"},{id:"store",label:"Store Info"},{id:"notifications",label:"Notifications"},{id:"quickbooks",label:"QuickBooks"}];
  const cardSt={background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"20px 22px",marginBottom:18};
  const secTitle={fontSize:12,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:14,fontWeight:700};
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",gap:4,marginBottom:20,background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:4,flexWrap:"wrap"}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setStab(t.id)} style={{background:stab===t.id?C.red:"transparent",border:"none",color:stab===t.id?"#fff":C.muted,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600,transition:"all .15s"}}>{t.label}</button>)}
      </div>
      {stab==="appearance"&&<SettingsAppearance C={C} F={F} theme={theme} setTheme={setTheme} fontId={fontId} setFontId={setFontId} logoUrl={logoUrl} setLogoUrl={setLogoUrl} showToast={showToast} cardSt={cardSt} secTitle={secTitle}/>}
      {stab==="staff"&&<SettingsStaff C={C} F={F} adminAccounts={adminAccounts} dbOps={dbOps} currentAdmin={currentAdmin} isSuperAdmin={isSuperAdmin} showToast={showToast} cardSt={cardSt} secTitle={secTitle}/>}
      {stab==="store"&&<SettingsStoreInfo C={C} F={F} showToast={showToast} cardSt={cardSt} secTitle={secTitle}/>}
      {stab==="notifications"&&<SettingsNotifications C={C} F={F} cardSt={cardSt} secTitle={secTitle}/>}
      {stab==="quickbooks"&&<SettingsQuickBooks C={C} F={F} showToast={showToast} cardSt={cardSt} secTitle={secTitle} isSuperAdmin={isSuperAdmin} categories={categories}/>}
    </div>
  );
}

function SettingsAppearance({C,F,theme,setTheme,fontId,setFontId,logoUrl,setLogoUrl,showToast,cardSt,secTitle}){
  const [uploading,setUploading]=useState(false);const fileRef=useRef(null);
  async function handleLogoUpload(e){const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("image/")){showToast("Please select an image file","error");return;}if(file.size>2*1024*1024){showToast("Logo must be under 2 MB","error");return;}setUploading(true);try{const storageRef=ref(storage,"company-config/logo-"+Date.now());await uploadBytes(storageRef,file);const url=await getDownloadURL(storageRef);await setLogoUrl(url);showToast("Logo uploaded");}catch(err){console.error(err);showToast("Upload failed","error");}finally{setUploading(false);if(fileRef.current)fileRef.current.value="";}}
  return(
    <div style={{maxWidth:560}}>
      <div style={cardSt}>
        <div style={secTitle}>Theme</div>
        <div style={{display:"flex",gap:10,marginBottom:12}}>{["dark","light"].map(t=><button key={t} onClick={()=>setTheme(t)} style={{flex:1,background:theme===t?C.red:C.surface,border:"1px solid "+(theme===t?C.red:C.borderMid),color:theme===t?"#fff":C.cream,borderRadius:10,padding:"12px 16px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:700,transition:"all .2s"}}>{t==="dark"?"\u{1F319} Dark":"\u2600 Light"}</button>)}</div>
        <div style={{fontSize:12,color:C.muted}}>Saved to your browser.</div>
      </div>
      <div style={cardSt}>
        <div style={secTitle}>Font</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{FONT_OPTIONS.map(f=><button key={f.id} onClick={()=>setFontId(f.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:fontId===f.id?C.sidebarActive:"transparent",border:"1px solid "+(fontId===f.id?C.borderMid:C.border),color:C.cream,borderRadius:10,padding:"12px 16px",cursor:"pointer",fontFamily:f.body,fontSize:14,fontWeight:fontId===f.id?700:400,transition:"all .15s",textAlign:"left"}}><span>{f.label}</span>{fontId===f.id&&<span style={{color:C.red,fontSize:16}}>{"\u2713"}</span>}</button>)}</div>
      </div>
      <div style={cardSt}>
        <div style={secTitle}>Company Logo</div>
        {logoUrl?(<div style={{marginBottom:16}}><div style={{background:C.surface,border:"1px solid "+C.borderMid,borderRadius:12,padding:20,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}><img src={logoUrl} alt="Logo" style={{maxHeight:60,maxWidth:240,objectFit:"contain"}}/></div><div style={{display:"flex",gap:10}}><button onClick={()=>fileRef.current?.click()} style={{flex:1,background:C.surface,border:"1px solid "+C.borderMid,color:C.cream,borderRadius:10,padding:"10px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600}}>Replace</button><button onClick={()=>{setLogoUrl(null);showToast("Logo removed");}} style={{background:C.errorBg,border:"1px solid "+C.errorText,color:C.errorText,borderRadius:10,padding:"10px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600}}>Remove</button></div></div>):(<div onClick={()=>!uploading&&fileRef.current?.click()} style={{border:"2px dashed "+C.borderMid,borderRadius:12,padding:"30px 20px",textAlign:"center",cursor:uploading?"wait":"pointer"}}><div style={{fontSize:32,opacity:.3,marginBottom:8}}>{"\u{1F4F7}"}</div><div style={{fontSize:14,color:C.cream,fontWeight:600,marginBottom:4}}>{uploading?"Uploading...":"Click to upload logo"}</div><div style={{fontSize:12,color:C.muted}}>PNG, JPG, or SVG \u2014 max 2 MB</div></div>)}
        <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{display:"none"}}/>
        <div style={{fontSize:12,color:C.muted,marginTop:10}}>Logo replaces the sidebar brand text.</div>
      </div>
    </div>
  );
}

function SettingsStaff({C,F,adminAccounts,dbOps,currentAdmin,isSuperAdmin,showToast,cardSt,secTitle}){
  const blank={name:"",username:"",password:"",role:"Admin"};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState(false);
  const ROLES=isSuperAdmin?["Employee","Manager","Admin","Super Admin"]:["Employee","Manager","Admin"];
  async function saveStaff(staff){if(saving)return;if(!staff.name.trim()||!staff.username.trim()){showToast("Name and username required","error");return;}if(isNew&&staff.password.length<6){showToast("Password must be at least 6 characters","error");return;}const taken=adminAccounts.find(a=>a.username.toLowerCase()===staff.username.trim().toLowerCase()&&a.id!==staff.id);if(taken){showToast("Username already taken","error");return;}if(!isSuperAdmin&&staff.role==="Super Admin"){showToast("Only Super Admins can assign that role","error");return;}setSaving(true);try{if(isNew){await dbOps.addAdminAccount({...staff,role:staff.role});showToast("Staff member added");}else{await dbOps.updateAdminAccount(staff.id,staff);showToast("Staff member updated");}setEditing(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSaving(false);}}
  async function deleteStaff(id){if(id===currentAdmin?.id){showToast("Cannot delete your own account","error");setConfirmDel(null);return;}const target=adminAccounts.find(a=>a.id===id);if(!isSuperAdmin&&target?.role==="Super Admin"){showToast("Cannot remove a Super Admin","error");setConfirmDel(null);return;}try{await dbOps.deleteAdminAccount(id);showToast("Staff member removed","error");setConfirmDel(null);}catch(e){console.error(e);showToast("Failed","error");}}
  const rc={"Super Admin":{bg:C.red,text:"#fff"},"Admin":{bg:C.amber,text:C.amberText},"Manager":{bg:"#1e40af",text:"#93c5fd"},"Employee":{bg:C.surface,text:C.muted}};
  return(
    <div style={{maxWidth:640}}>
      <div style={cardSt}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={secTitle}>Staff Accounts ({adminAccounts.length})</div>
          <Btn t={C} primary onClick={()=>{setEditing({...blank});setIsNew(true);}}>+ Add Staff</Btn>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Staff accounts can sign into the admin panel. Role determines what they can access.</div>
        <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 120px 140px 100px",borderBottom:"1px solid "+C.border,padding:"9px 16px"}}>{["Name","Role","Username",""].map(h=><div key={h||"act"} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
          {adminAccounts.length===0?<div style={{padding:"30px",textAlign:"center",color:C.muted}}>No staff accounts</div>:adminAccounts.map(staff=>{const isMe=staff.id===currentAdmin?.id;const isSA=staff.role==="Super Admin";const canEdit=isSuperAdmin||!isSA;const col=rc[staff.role]||rc["Employee"];return(
            <div key={staff.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 120px 140px 100px",borderBottom:"1px solid "+C.border,padding:"12px 16px",alignItems:"center",transition:"background .15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:30,height:30,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff",flexShrink:0}}>{staff.name.charAt(0).toUpperCase()}</div><div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{staff.name}{isMe&&<span style={{fontSize:11,color:C.muted,marginLeft:6}}>(you)</span>}</div></div></div>
              <div><span style={{background:col.bg,color:col.text,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>{staff.role}</span></div>
              <div style={{fontFamily:F.mono,fontSize:13,color:C.mutedLight}}>{staff.username}</div>
              <div style={{display:"flex",gap:6}}>{canEdit&&<button onClick={()=>{setEditing({...staff,password:""});setIsNew(false);}} style={smallBtn(false,false,C)}>Edit</button>}{canEdit&&!isMe&&<button onClick={()=>setConfirmDel(staff.id)} style={smallBtn(true,false,C)}>Del</button>}</div>
            </div>);})}
        </div>
      </div>
      {editing&&<StaffModal account={editing} isNew={isNew} saving={saving} roles={ROLES} isSuperAdmin={isSuperAdmin} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveStaff(editing)} onClose={()=>setEditing(null)} C={C} F={F}/>}
      {confirmDel&&<ConfirmModal t={C} message={"Remove \""+((adminAccounts.find(a=>a.id===confirmDel)||{}).name||"")+"\" from staff?"} confirmLabel="Remove Staff" danger onConfirm={()=>deleteStaff(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

function StaffModal({account,isNew,saving,roles,isSuperAdmin,onChange,onSave,onClose,C,F}){
  const [showPass,setShowPass]=useState(false);const invalid=!account.name.trim()||!account.username.trim()||(isNew&&account.password.length<6);
  const cantPromote=!isSuperAdmin&&account.role==="Super Admin";
  return(<Modal t={C} title={isNew?"Add Staff Member":"Edit Staff Member"} onClose={onClose}>
    <Field t={C} label="Full Name *" style={{marginBottom:14}}><input value={account.name} onChange={e=>onChange({name:e.target.value})} placeholder="e.g. Frank" style={inputSt(false,C)}/></Field>
    <Field t={C} label="Username *" style={{marginBottom:14}}><input value={account.username} onChange={e=>onChange({username:e.target.value.toLowerCase().replace(/\s/g,"")})} placeholder="e.g. frank" style={{...inputSt(false,C),fontFamily:F.mono}}/></Field>
    <Field t={C} label={isNew?"Password * (min 6 chars)":"New Password (leave blank to keep)"} style={{marginBottom:8}}><div style={{position:"relative"}}><input value={account.password} onChange={e=>onChange({password:e.target.value})} placeholder={isNew?"Set a password":"Leave blank to keep current"} type={showPass?"text":"password"} style={inputSt(false,C)}/><button onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:17}}>{showPass?"\u{1F648}":"\u{1F441}"}</button></div></Field>
    <div style={{fontSize:12,color:C.muted,marginBottom:18}}>Passwords are hashed before storing.</div>
    <Field t={C} label="Role" style={{marginBottom:22}}><select value={account.role} onChange={e=>onChange({role:e.target.value})} disabled={cantPromote} style={inputSt(true,C)}>{roles.map(r=><option key={r} value={r}>{r}</option>)}</select>{cantPromote&&<div style={{fontSize:11,color:C.errorText,marginTop:6}}>Only Super Admins can change this role.</div>}</Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn t={C} ghost onClick={onClose}>Cancel</Btn><Btn t={C} primary onClick={onSave} disabled={invalid||saving}>{saving?"Saving\u2026":isNew?"Add Staff Member":"Save Changes"}</Btn></div>
  </Modal>);
}

function SettingsStoreInfo({C,F,showToast,cardSt,secTitle}){
  const [info,setInfo]=useState({name:"",address:"",phone:"",hours:""});
  const [loaded,setLoaded]=useState(false);const [saving,setSaving]=useState(false);
  useEffect(()=>{getDoc(doc(db,"kioskConfig","storeInfo")).then(snap=>{if(snap.exists())setInfo(prev=>({...prev,...snap.data()}));}).catch(()=>{}).finally(()=>setLoaded(true));},[]);
  async function save(){setSaving(true);try{await setDoc(doc(db,"kioskConfig","storeInfo"),info,{merge:true});showToast("Store info saved");}catch(e){console.error(e);showToast("Failed to save","error");}finally{setSaving(false);}}
  if(!loaded)return<div style={{color:C.muted,padding:20}}>Loading...</div>;
  return(
    <div style={{maxWidth:560}}>
      <div style={cardSt}>
        <div style={secTitle}>Store Information</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>This information can be displayed on receipts and the kiosk.</div>
        <Field t={C} label="Store Name" style={{marginBottom:14}}><input value={info.name} onChange={e=>setInfo(p=>({...p,name:e.target.value}))} placeholder="Champ's Butcher Shop" style={inputSt(false,C)}/></Field>
        <Field t={C} label="Address" style={{marginBottom:14}}><input value={info.address} onChange={e=>setInfo(p=>({...p,address:e.target.value}))} placeholder="123 Main St, Halstead, KS" style={inputSt(false,C)}/></Field>
        <Field t={C} label="Phone" style={{marginBottom:14}}><input value={info.phone} onChange={e=>setInfo(p=>({...p,phone:e.target.value}))} placeholder="(316) 555-0100" style={inputSt(false,C)}/></Field>
        <Field t={C} label="Business Hours" style={{marginBottom:18}}><input value={info.hours} onChange={e=>setInfo(p=>({...p,hours:e.target.value}))} placeholder="Mon-Fri 8AM-6PM, Sat 9AM-3PM" style={inputSt(false,C)}/></Field>
        <Btn t={C} primary onClick={save} disabled={saving}>{saving?"Saving\u2026":"Save Store Info"}</Btn>
      </div>
    </div>
  );
}

function SettingsNotifications({C,F,cardSt,secTitle}){
  const [sound,setSound]=useState(()=>localStorage.getItem("admin-chime")!=="off");
  const [volume,setVolume]=useState(()=>parseInt(localStorage.getItem("admin-volume")||"70",10));
  function toggleSound(){const next=!sound;setSound(next);localStorage.setItem("admin-chime",next?"on":"off");}
  function changeVolume(v){setVolume(v);localStorage.setItem("admin-volume",String(v));}
  function testChime(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const vol=volume/100*0.35;[[660,0],[880,.12],[1100,.24]].forEach(([freq,t])=>{const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;gain.gain.setValueAtTime(vol,ctx.currentTime+t);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.3);osc.start(ctx.currentTime+t);osc.stop(ctx.currentTime+t+0.32);});}catch(e){console.warn("Audio failed:",e);}}
  return(
    <div style={{maxWidth:560}}>
      <div style={cardSt}>
        <div style={secTitle}>Order Notifications</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>New order chime</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>Play a sound when a new order arrives</div></div>
          <button onClick={toggleSound} style={{width:52,height:28,borderRadius:14,border:"none",cursor:"pointer",background:sound?C.green:C.border,position:"relative",transition:"background .2s"}}><div style={{width:22,height:22,borderRadius:11,background:"#fff",position:"absolute",top:3,left:sound?27:3,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.3)"}}/></button>
        </div>
        {sound&&<>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:13,color:C.muted}}>Volume</span><span style={{fontSize:13,color:C.cream,fontWeight:600}}>{volume}%</span></div>
            <input type="range" min="10" max="100" value={volume} onChange={e=>changeVolume(parseInt(e.target.value))} style={{width:"100%",accentColor:C.red}}/>
          </div>
          <button onClick={testChime} style={{background:C.surface,border:"1px solid "+C.borderMid,color:C.cream,borderRadius:10,padding:"10px 18px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600}}>{"\uD83D\uDD14"} Test Chime</button>
        </>}
      </div>
    </div>
  );
}

function SettingsQuickBooks({C,F,showToast,cardSt,secTitle,isSuperAdmin,categories}){
  const [status,setStatus]=useState(null);const [loading,setLoading]=useState(true);const [acting,setActing]=useState(false);
  const [companyName,setCompanyName]=useState(null);
  const [showProductPicker,setShowProductPicker]=useState(false);
  const [qbProducts,setQbProducts]=useState([]);const [selectedProducts,setSelectedProducts]=useState({});const [importing,setImporting]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const QB_BASE="https://us-central1-testing-and-development-f696f.cloudfunctions.net";
  const QB_AUTH_URL=QB_BASE+"/qbAuth";
  const QB_DISCONNECT_URL=QB_BASE+"/qbDisconnect";
  const QB_TEST_URL=QB_BASE+"/qbTestConnection";
  const QB_SYNC_URL=QB_BASE+"/qbSyncProducts";
  const QB_IMPORT_URL=QB_BASE+"/qbImportSelected";
  const QB_REFRESH_URL=QB_BASE+"/qbRefreshStock";

  useEffect(()=>{
    getDoc(doc(db,"kioskConfig","qbConnection")).then(snap=>{
      if(snap.exists())setStatus(snap.data());
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const qb=params.get("qb");
    if(qb==="connected"){showToast("QuickBooks connected successfully");window.history.replaceState({},"","/admin");}
    if(qb==="error"){showToast("QuickBooks connection failed","error");window.history.replaceState({},"","/admin");}
  },[]);

  async function handleConnect(){setActing(true);window.location.href=QB_AUTH_URL;}
  async function handleDisconnect(){
    setActing(true);
    try{
      const res=await fetch(QB_DISCONNECT_URL,{method:"POST"});
      if(!res.ok)throw new Error("Disconnect failed");
      await setDoc(doc(db,"kioskConfig","qbConnection"),{connected:false,disconnectedAt:Date.now()},{merge:true});
      setStatus({connected:false});setCompanyName(null);showToast("QuickBooks disconnected");
    }catch(e){console.error(e);showToast("Failed to disconnect","error");}finally{setActing(false);}
  }

  async function handleTestConnection(){
    setActing(true);
    try{
      const res=await fetch(QB_TEST_URL);
      const data=await res.json();
      if(data.success){setCompanyName(data.companyName);showToast("Connected to "+data.companyName);}
      else throw new Error(data.error);
    }catch(e){console.error(e);showToast("Connection test failed: "+e.message,"error");}finally{setActing(false);}
  }

  async function handleSyncProducts(){
    setActing(true);
    try{
      const res=await fetch(QB_SYNC_URL);
      const data=await res.json();
      if(data.products){setQbProducts(data.products);setShowProductPicker(true);showToast(`Found ${data.count} products in QuickBooks`);}
      else throw new Error(data.error);
    }catch(e){console.error(e);showToast("Failed to fetch products: "+e.message,"error");}finally{setActing(false);}
  }

  async function handleImportSelected(){
    const items=Object.values(selectedProducts).filter(p=>p.selected);
    if(items.length===0){showToast("No products selected","error");return;}
    setImporting(true);
    try{
      const res=await fetch(QB_IMPORT_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:items.map(p=>({qbItemId:p.qbItemId,name:p.name,price:p.price,description:p.description,sku:p.sku,stock:p.stock,category:p.category||"Uncategorized"}))})});
      const data=await res.json();
      if(data.success){showToast(`Imported ${data.created} new, updated ${data.updated} existing`);setShowProductPicker(false);setSelectedProducts({});}
      else throw new Error(data.error);
    }catch(e){console.error(e);showToast("Import failed: "+e.message,"error");}finally{setImporting(false);}
  }

  async function handleRefreshStock(){
    setRefreshing(true);
    try{
      const res=await fetch(QB_REFRESH_URL);
      const data=await res.json();
      if(data.success)showToast(`Stock refreshed: ${data.updated} of ${data.total} items updated`);
      else throw new Error(data.error);
    }catch(e){console.error(e);showToast("Stock refresh failed: "+e.message,"error");}finally{setRefreshing(false);}
  }

  function toggleProduct(p){
    setSelectedProducts(prev=>{
      const existing=prev[p.qbItemId]||{...p,selected:false,category:"Uncategorized"};
      return{...prev,[p.qbItemId]:{...existing,selected:!existing.selected}};
    });
  }
  function setCategoryFor(qbItemId,cat){
    setSelectedProducts(prev=>({...prev,[qbItemId]:{...prev[qbItemId],category:cat}}));
  }

  if(loading)return<div style={{color:C.muted,padding:20}}>Loading...</div>;
  const connected=status?.connected===true;
  const btnSt={background:C.surface,border:"1px solid "+C.borderMid,color:C.cream,borderRadius:10,padding:"12px 18px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600,transition:"opacity .2s",width:"100%",textAlign:"center"};

  return(
    <div style={{maxWidth:640}}>
      <div style={cardSt}>
        <div style={secTitle}>Connection</div>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 18px",background:C.surface,border:"1px solid "+C.border,borderRadius:12,marginBottom:16}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:connected?C.green:C.muted,flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:14,color:C.cream,fontWeight:600}}>{connected?"Connected"+(companyName?" to "+companyName:""):"Not Connected"}</div>
            {connected&&status?.connectedAt&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>Since {new Date(status.connectedAt).toLocaleDateString()}</div>}
          </div>
        </div>
        {!connected?(
          <button onClick={handleConnect} disabled={acting||!isSuperAdmin} style={{...btnSt,background:"#2CA01C",border:"none",color:"#fff",fontWeight:700}}>{acting?"Redirecting...":"Connect to QuickBooks"}</button>
        ):(
          <div style={{display:"flex",gap:10}}>
            <button onClick={handleTestConnection} disabled={acting} style={btnSt}>{acting?"Testing...":"Test Connection"}</button>
            <button onClick={handleDisconnect} disabled={acting||!isSuperAdmin} style={{...btnSt,background:C.errorBg,border:"1px solid "+C.errorText,color:C.errorText}}>{acting?"...":"Disconnect"}</button>
          </div>
        )}
        {!isSuperAdmin&&<div style={{fontSize:12,color:C.muted,marginTop:10}}>Only Super Admins can manage the QuickBooks connection.</div>}
      </div>

      {connected&&<div style={cardSt}>
        <div style={secTitle}>Inventory Sync</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Import products from QuickBooks and keep stock levels in sync.</div>
        <div style={{display:"flex",gap:10,marginBottom:12}}>
          <button onClick={handleSyncProducts} disabled={acting} style={btnSt}>{acting?"Fetching...":"Sync Products from QB"}</button>
          <button onClick={handleRefreshStock} disabled={refreshing} style={btnSt}>{refreshing?"Refreshing...":"Refresh Stock Levels"}</button>
        </div>
        {status?.lastSyncAt&&<div style={{fontSize:11,color:C.muted}}>Last synced: {new Date(status.lastSyncAt).toLocaleString()}</div>}
      </div>}

      {showProductPicker&&<Modal t={C} title={`QuickBooks Products (${qbProducts.length})`} onClose={()=>setShowProductPicker(false)} wide>
        <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Select products to show on the kiosk. Assign a category to each.</div>
        <div style={{maxHeight:400,overflowY:"auto",marginBottom:16}}>
          {qbProducts.filter(p=>p.active!==false).map(p=>{const sel=selectedProducts[p.qbItemId];const checked=sel?.selected||false;return(
            <div key={p.qbItemId} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:"1px solid "+C.border,background:checked?C.sidebarActive:"transparent",transition:"background .15s",cursor:"pointer"}} onClick={()=>toggleProduct(p)}>
              <input type="checkbox" checked={checked} readOnly style={{accentColor:C.red,width:18,height:18,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,color:C.cream,fontWeight:600}}>{p.name}</div>
                <div style={{fontSize:12,color:C.muted}}>{p.sku?p.sku+" \u00B7 ":""}${p.price?.toFixed(2)||"0.00"} \u00B7 Stock: {p.stock??"\u221E"} \u00B7 {p.type}</div>
              </div>
              {checked&&<select value={sel?.category||"Uncategorized"} onClick={e=>e.stopPropagation()} onChange={e=>setCategoryFor(p.qbItemId,e.target.value)} style={{...inputSt(true,C),width:140,fontSize:12,padding:"6px 10px"}}>
                <option>Uncategorized</option>
                {(categories||[]).map(c=><option key={c.id||c.name} value={c.name}>{c.name}</option>)}
              </select>}
            </div>);
          })}
          {qbProducts.length===0&&<div style={{padding:30,textAlign:"center",color:C.muted}}>No products found in QuickBooks</div>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:13,color:C.muted}}>{Object.values(selectedProducts).filter(p=>p.selected).length} selected</div>
          <div style={{display:"flex",gap:10}}>
            <Btn t={C} ghost onClick={()=>setShowProductPicker(false)}>Cancel</Btn>
            <Btn t={C} primary onClick={handleImportSelected} disabled={importing||Object.values(selectedProducts).filter(p=>p.selected).length===0}>{importing?"Importing...":"Import Selected"}</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inventory History Panel
// ═══════════════════════════════════════════════════════════════════════════════
function InventoryHistoryPanel({ adjustments }) {const{T:C,TF:F}=useAdminTheme();
  const [search, setSearch] = useState("");
  const filtered = adjustments.filter((entry) => {
    const haystack = `${entry.itemName || ""} ${entry.reason || ""} ${entry.actorName || ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  function fmtTs(ts) {
    if (!ts) return "\u2014";
    const d = typeof ts?.toDate === "function" ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
    return isNaN(d.getTime()) ? "\u2014" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return (
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,color:C.cream}}>Inventory Adjustment History</div>
          <div style={{fontSize:13,color:C.muted}}>{filtered.length} adjustment{filtered.length!==1?"s":""} shown</div>
        </div>
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search item, reason, or actor" style={{...inputSt(false,C),minWidth:280,maxWidth:"100%"}} />
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.3fr .8fr .7fr .9fr .8fr",padding:"10px 16px",borderBottom:"1px solid "+C.border,background:"rgba(255,255,255,.02)"}}>{["Item","Change","Reason","Actor","When"].map((h)=><div key={h} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {filtered.length===0 ? <div style={{padding:40,textAlign:"center",color:C.muted}}>No inventory adjustments found.</div> : filtered.slice(0,250).map((entry)=><div key={entry.id} style={{display:"grid",gridTemplateColumns:"1.3fr .8fr .7fr .9fr .8fr",padding:"12px 16px",borderBottom:"1px solid "+C.border,alignItems:"center",fontSize:13,color:C.cream}}>
          <div><div style={{fontWeight:700}}>{entry.itemName || entry.itemId}</div><div style={{fontSize:11,color:C.muted}}>{entry.itemId}</div></div>
          <div><span style={{color:entry.delta<0?C.errorText:C.greenText,fontWeight:700}}>{entry.delta>0?`+${entry.delta}`:entry.delta}</span><div style={{fontSize:11,color:C.muted}}>{entry.beforeQty} {"\u2192"} {entry.afterQty}</div></div>
          <div style={{fontSize:12,color:C.muted}}>{entry.reason || "\u2014"}</div>
          <div style={{fontSize:12}}>{entry.actorName || "system"}</div>
          <div style={{fontSize:12,color:C.muted}}>{fmtTs(entry.createdAt)}</div>
        </div>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Log Panel
// ═══════════════════════════════════════════════════════════════════════════════
function AuditLogPanel({ auditLogs }) {const{T:C,TF:F}=useAdminTheme();
  const [search, setSearch] = useState("");
  const filtered = auditLogs.filter((entry) => {
    const haystack = `${entry.action || ""} ${entry.summary || ""} ${entry.actorName || ""} ${entry.targetType || ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  function fmtTs(ts) {
    if (!ts) return "\u2014";
    const d = typeof ts?.toDate === "function" ? ts.toDate() : new Date(ts?.seconds ? ts.seconds * 1000 : ts);
    return isNaN(d.getTime()) ? "\u2014" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return (
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,color:C.cream}}>Audit Log</div>
          <div style={{fontSize:13,color:C.muted}}>{filtered.length} event{filtered.length!==1?"s":""} shown</div>
        </div>
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search action, actor, or summary" style={{...inputSt(false,C),minWidth:280,maxWidth:"100%"}} />
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.length===0 ? <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:40,textAlign:"center",color:C.muted}}>No audit events found.</div> : filtered.slice(0,200).map((entry)=><div key={entry.id} style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:6}}>{entry.action || "event"}</div>
              <div style={{fontSize:15,fontWeight:700,color:C.cream}}>{entry.summary || "\u2014"}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:6}}>{entry.actorName || "system"} {"\u00B7"} {entry.targetType || "record"} {"\u00B7"} {entry.targetId || "\u2014"}</div>
            </div>
            <div style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{fmtTs(entry.createdAt)}</div>
          </div>
        </div>)}
      </div>
    </div>
  );
}
