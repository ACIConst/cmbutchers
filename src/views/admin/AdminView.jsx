/**
 * src/views/admin/AdminView.jsx
 *
 * Admin panel shell — sidebar navigation + tab routing.
 * All tab components have been extracted to separate files.
 *
 * Auth: Firebase Auth (OperatorGate) + custom admin claims issued by backend.
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  C as C_DARK, F as F_DARK, ADMIN_SESSION_MS,
  normalizeStatus,
} from "../../styles/tokens";
import { AdminThemeProvider, useAdminTheme } from "../../context/AdminThemeContext";
import {
  useMenu, useUsers, useOrders, useCategories,
} from "../../hooks/useFirestore";
import { createDbOps, runSeeds } from "../../hooks/useAdminFirestore";
import { useInventoryAdjustments } from "../../hooks/useInventoryAdjustments";
import { useAuditLogs } from "../../hooks/useAuditLogs";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { ModeLoadingScreen, ErrorBoundary } from "../../components/ui";

import { getAuth, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../config/firebase";

// ─── Extracted tab components ────────────────────────────────────────────────
const AccessDenied = lazy(() => import("./AccessDenied").then((m) => ({ default: m.AccessDenied })));
const AdminDashboard = lazy(() => import("./AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const MenuManager = lazy(() => import("./MenuManager").then((m) => ({ default: m.MenuManager })));
const CategoriesManager = lazy(() => import("./CategoriesManager").then((m) => ({ default: m.CategoriesManager })));
const UserManager = lazy(() => import("./UserManager").then((m) => ({ default: m.UserManager })));
const OrderHistory = lazy(() => import("./OrderHistory").then((m) => ({ default: m.OrderHistory })));
const DeliveryPanel = lazy(() => import("./DeliveryPanel").then((m) => ({ default: m.DeliveryPanel })));
const InventoryHistoryPanel = lazy(() => import("./InventoryHistoryPanel").then((m) => ({ default: m.InventoryHistoryPanel })));
const AuditLogPanel = lazy(() => import("./AuditLogPanel").then((m) => ({ default: m.AuditLogPanel })));
const SettingsPanel = lazy(() => import("./SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

// ─── Responsive hook ─────────────────────────────────────────────────────────
function useWindowSize(){const [s,set]=useState({w:typeof window!=="undefined"?window.innerWidth:1200,h:typeof window!=="undefined"?window.innerHeight:800});useEffect(()=>{const h=()=>set({w:window.innerWidth,h:window.innerHeight});window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);return s;}

// ─── Main exported component ─────────────────────────────────────────────────
export default function AdminView({ initialTab = "dashboard" }) {
  const navigate = useNavigate();
  useEffect(() => { if (import.meta.env.DEV) runSeeds(); }, []);
  return <AdminThemeProvider><AdminApp initialTab={initialTab} onExit={() => navigate("/")} /></AdminThemeProvider>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AdminApp — responsive sidebar + tab routing
// ═══════════════════════════════════════════════════════════════════════════════
function AdminApp({ initialTab, onExit }) {
  const { T: C, TF: F, theme, logoUrl, fontId } = useAdminTheme();
  const { user, admin: loggedInAdmin } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sessionTimerRef = useRef(null);
  const [storeInfo, setStoreInfo] = useState(null);
  const {w}=useWindowSize();
  const isMobile=w<768;
  const isTablet=w>=768&&w<1024;
  const showSidebarPermanent=w>=1024;
  const tabFallback = <div style={{padding:isMobile?"24px 12px":"32px 20px",color:C.muted,fontFamily:F.body}}>Loading panel...</div>;
  const needsMenu = ["dashboard", "menu", "categories", "orders"].includes(tab);
  const needsUsers = ["dashboard", "users", "settings"].includes(tab);
  const needsOrders = ["dashboard", "orders", "delivery"].includes(tab);
  const needsCategories = ["menu", "categories", "settings"].includes(tab);
  const needsAdjustments = tab === "inventory";
  const needsAuditLogs = tab === "audit";
  const { menu, ready: menuReady } = useMenu(needsMenu);
  const { users, ready: usersReady } = useUsers(needsUsers);
  const { orders, ready: ordersReady } = useOrders(needsOrders);
  const { categories, ready: catsReady } = useCategories(needsCategories);
  const { adjustments, ready: adjustmentsReady } = useInventoryAdjustments(300, needsAdjustments);
  const { auditLogs, ready: auditReady } = useAuditLogs(300, needsAuditLogs);
  const catNames = categories.map(c => c.name);
  const STAFF_ROLES = ["Super Admin", "Manager", "Admin", "Employee", "manager", "super_admin"];
  const seen = new Set();
  const adminAccounts = users
    .filter(u => STAFF_ROLES.includes(u.role))
    .map(u => ({ ...u, name: ((u.firstName || "") + " " + (u.lastName || "")).trim() || u.email || "Unknown" }))
    .filter(u => { const k = (u.email || u.id).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const allReady = (!needsMenu || menuReady) && (!needsUsers || usersReady) && (!needsOrders || ordersReady) && (!needsCategories || catsReady) && (!needsAdjustments || adjustmentsReady) && (!needsAuditLogs || auditReady);

  // Load store info for dynamic shop name in pick tickets etc.
  useEffect(()=>{getDoc(doc(db,"kioskConfig","storeInfo")).then(snap=>{if(snap.exists())setStoreInfo(snap.data());}).catch(()=>{});},[]);

  // Load Google Fonts for selected font (clean up previous font links)
  useEffect(()=>{
    if(fontId==="default")return;
    const families={"inter":"Inter:wght@400;600;700;900","roboto":"Roboto:wght@400;500;700;900","mono":"JetBrains+Mono:wght@400;600;700"};
    const family=families[fontId];if(!family)return;
    const id="gfont-"+fontId;if(document.getElementById(id))return;
    // Remove other font links to prevent accumulation
    Object.keys(families).forEach(fid=>{if(fid!==fontId){const old=document.getElementById("gfont-"+fid);if(old)old.remove();}});
    const link=document.createElement("link");link.id=id;link.rel="stylesheet";link.href="https://fonts.googleapis.com/css2?family="+family+"&display=swap";document.head.appendChild(link);
  },[fontId]);

  const actor = loggedInAdmin ? { actorId: loggedInAdmin.id, actorName: loggedInAdmin.name } : {};
  const dbOps = createDbOps(menu, categories, actor);

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
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  if (!allReady) return <ModeLoadingScreen label="Loading Admin Panel..." />;

  if(!loggedInAdmin) return <Suspense fallback={tabFallback}><AccessDenied email={user?.email} onLogout={handleLogout} onExit={onExit} /></Suspense>;

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
          <ErrorBoundary key={tab} t={C}>
          <Suspense fallback={tabFallback}>
          {tab==="dashboard"  &&<AdminDashboard menu={menu} users={users} orders={orders} dbOps={dbOps} isMobile={isMobile} isTablet={isTablet}/>}
          {tab==="menu"       &&<MenuManager menu={menu} catNames={catNames} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="categories" &&<CategoriesManager categories={categories} menu={menu} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="users"      &&<UserManager users={users} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="orders"     &&<OrderHistory orders={orders} menu={menu} dbOps={dbOps} showToast={showToast} shopName={storeInfo?.name}/>}
          {tab==="delivery"   &&<DeliveryPanel orders={orders} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="inventory"&&isSuperAdmin&&<InventoryHistoryPanel adjustments={adjustments}/>}
          {tab==="audit"&&isSuperAdmin&&<AuditLogPanel auditLogs={auditLogs}/>}
          {tab==="settings"&&<SettingsPanel showToast={showToast} adminAccounts={adminAccounts} dbOps={dbOps} currentAdmin={loggedInAdmin} isSuperAdmin={isSuperAdmin} categories={categories}/>}
          </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {toast&&<div style={{position:"fixed",bottom:isMobile?14:26,right:isMobile?14:26,left:isMobile?14:"auto",background:toast.type==="success"?C.green:toast.type==="order"?"#1e3a5f":C.errorBg,color:toast.type==="success"?C.greenText:toast.type==="order"?"#93c5fd":C.errorText,border:"1px solid "+(toast.type==="success"?C.greenText:toast.type==="order"?"#3b82f6":C.errorText),borderRadius:12,padding:"12px 20px",fontSize:14,fontWeight:600,animation:"fadeUp .3s ease",zIndex:999,boxShadow:"0 8px 24px rgba(0,0,0,.5)",display:"flex",alignItems:"center",gap:8}}>{toast.type==="success"?"\u2713":toast.type==="order"?"\uD83D\uDCE6":"\u2715"} {toast.msg}</div>}
    </div>
  );
}
