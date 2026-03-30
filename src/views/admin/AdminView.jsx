/**
 * src/views/admin/AdminView.jsx
 *
 * Monolithic admin panel — all tabs rendered inline.
 * Handles menu CRUD (SKU, barcode upload, DnD reorder), categories,
 * employees, orders, order board (pick tickets, chime), delivery,
 * admin accounts, inventory history, and audit log.
 *
 * Auth: FNV-1a hash against kioskAdmins collection (Firebase Auth migration pending).
 * Inventory: SKU/barcode managed here; QuickBooks integration planned as external source of truth.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  C, F, ORDER_STATUSES, ADMIN_SESSION_MS,
  DELIVERY_LOCATIONS, normalizeStatus, canTransition,
} from "../../styles/tokens";
import {
  useMenu, useUsers, useOrders, useCategories, useAdmins,
  createDbOps, hashPassword, runSeeds,
} from "../../hooks/useFirestore";
import { useInventoryAdjustments } from "../../hooks/useInventoryAdjustments";
import { useAuditLogs } from "../../hooks/useAuditLogs";
import { useNavigate } from "react-router-dom";
import {
  Modal, ConfirmModal, Field, Btn, ModeLoadingScreen,
  StatusBadge, inputSt, smallBtn, openPrintWindow,
} from "../../components/ui";
import { Img } from "../../components/Img";
import { isOrderingOpen, getWeekOf, fmt$, fmtDate } from "../../utils";

import { collection, doc, addDoc, writeBatch } from "firebase/firestore"; import { getAuth, signOut } from "firebase/auth";
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
  return <AdminApp menu={menu} users={users} orders={orders} adminAccounts={adminAccounts} categories={categories} catNames={catNames} dbOps={dbOps} adjustments={adjustments} auditLogs={auditLogs} onExit={() => navigate("/")} />;
}

// ─── Responsive hook ─────────────────────────────────────────────────────────
function useWindowSize(){const [s,set]=useState({w:typeof window!=="undefined"?window.innerWidth:1200,h:typeof window!=="undefined"?window.innerHeight:800});useEffect(()=>{const h=()=>set({w:window.innerWidth,h:window.innerHeight});window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);return s;}

// ═══════════════════════════════════════════════════════════════════════════════
// AdminApp — responsive sidebar + tab routing
// ═══════════════════════════════════════════════════════════════════════════════
function AdminApp({ menu, users, orders, adminAccounts, categories, catNames, dbOps, adjustments, auditLogs, onExit }) {
  const [loggedInAdmin, setLoggedInAdmin] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sessionTimerRef = useRef(null);
  const {w}=useWindowSize();
  const isMobile=w<768;
  const isTablet=w>=768&&w<1024;
  const showSidebarPermanent=w>=1024;

  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }
  const resetSessionTimer = useCallback(()=>{clearTimeout(sessionTimerRef.current);if(loggedInAdmin) sessionTimerRef.current=setTimeout(()=>{setLoggedInAdmin(null);setTab("dashboard");},ADMIN_SESSION_MS);},[loggedInAdmin]);
  useEffect(()=>{ resetSessionTimer(); return()=>clearTimeout(sessionTimerRef.current); },[resetSessionTimer]);
  useEffect(()=>{if(!loggedInAdmin)return;const events=["mousedown","keydown","touchstart"];events.forEach(e=>document.addEventListener(e,resetSessionTimer,{passive:true}));return()=>events.forEach(e=>document.removeEventListener(e,resetSessionTimer));},[resetSessionTimer,loggedInAdmin]);

 if(!loggedInAdmin) { setLoggedInAdmin({ name: "Admin", role: "Super Admin" }); return null; }

  const isSuperAdmin=loggedInAdmin.role==="Super Admin";
  const deliveryCount=orders.filter(o=>!o.archived&&normalizeStatus(o.status)==="out_for_delivery").length;
  const pickingCount=orders.filter(o=>!o.archived&&["paid","picking"].includes(normalizeStatus(o.status))).length;
  const navItems=[
    {id:"dashboard",  label:"Dashboard"},
    {id:"menu",       label:"Menu Items"},
    {id:"categories", label:"Categories"},
    {id:"users",      label:"Employees"},
    {id:"orders",     label:"Orders"},
    {id:"board",      label:"Order Board"+(pickingCount>0?" ("+pickingCount+")":"")},
    {id:"delivery",   label:"Delivery"+(deliveryCount>0?" ("+deliveryCount+")":"")},
    ...(isSuperAdmin?[{id:"admins",label:"Admin Accounts"}]:[]),
    ...(isSuperAdmin?[{id:"inventory",label:"Inventory History"},{id:"audit",label:"Audit Log"}]:[]),
  ];

  function navTo(id){setTab(id);if(!showSidebarPermanent)setSidebarOpen(false);}

  const sidebarContent=(
    <>
      <div style={{padding:isMobile?"16px 14px 10px":"20px 18px 14px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:F.display,fontSize:isMobile?18:20,fontWeight:900,letterSpacing:3,color:C.cream,lineHeight:1}}>Champ's</div>
          <div style={{fontSize:11,letterSpacing:3,color:C.muted,marginTop:4,textTransform:"uppercase"}}>Admin Panel</div>
        </div>
        {!showSidebarPermanent&&<button onClick={()=>setSidebarOpen(false)} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:22,lineHeight:1,padding:4}}>{"\u2715"}</button>}
      </div>
      <nav style={{flex:1,minHeight:0,padding:"10px 8px",overflowY:"auto"}}>
        {navItems.map(n=><button key={n.id} className="nav-btn" onClick={()=>navTo(n.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:tab===n.id?C.sidebarActive:"transparent",border:"1px solid "+(tab===n.id?C.borderMid:"transparent"),color:tab===n.id?C.cream:"#d4c4a8",borderRadius:10,padding:"10px 14px",cursor:"pointer",fontSize:15,fontFamily:F.body,marginBottom:4,textAlign:"left",transition:"all .15s"}}>{n.label}{tab===n.id&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:C.red}}/>}</button>)}
      </nav>
      <div style={{padding:"12px 14px",borderTop:"1px solid "+C.border,background:"rgba(0,0,0,.2)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:C.cream,flexShrink:0}}>{loggedInAdmin.name.charAt(0).toUpperCase()}</div>
          <div style={{overflow:"hidden"}}><div style={{fontSize:13,color:C.cream,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{loggedInAdmin.name}</div><div style={{fontSize:10,color:C.muted,letterSpacing:1}}>{loggedInAdmin.role}</div></div>
        </div>
        <button className="nav-btn" onClick={()=>{setLoggedInAdmin(null);signOut(getAuth());}} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"transparent",border:"1px solid "+C.border,color:C.muted,borderRadius:8,padding:"7px 10px",cursor:"pointer",fontSize:13,fontFamily:F.body,marginBottom:4,textAlign:"left",transition:"all .15s"}}>{"\u{1F513}"} Log Out</button>
        <button className="nav-btn" onClick={onExit} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"transparent",border:"1px solid transparent",color:C.muted,borderRadius:8,padding:"7px 10px",cursor:"pointer",fontSize:13,fontFamily:F.body,textAlign:"left",transition:"all .15s"}}>{"\u2B05"} Exit Admin</button>
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
          </div>
        </div>
        <div style={{padding:isMobile?"14px":isTablet?"20px":"26px"}}>
          {tab==="dashboard"  &&<AdminDashboard menu={menu} users={users} orders={orders} dbOps={dbOps} isMobile={isMobile} isTablet={isTablet}/>}
          {tab==="menu"       &&<MenuManager menu={menu} catNames={catNames} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="categories" &&<CategoriesManager categories={categories} menu={menu} dbOps={dbOps} showToast={showToast}/>}
          {tab==="users"      &&<UserManager users={users} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="orders"     &&<OrderHistory orders={orders} users={users} dbOps={dbOps} showToast={showToast}/>}
          {tab==="board"      &&<OrderBoardPanel orders={orders} users={users} menu={menu} dbOps={dbOps} showToast={showToast} isMobile={isMobile}/>}
          {tab==="delivery"   &&<DeliveryPanel orders={orders} users={users} dbOps={dbOps} showToast={showToast}/>}
          {tab==="admins"&&isSuperAdmin&&<AdminAccountsManager adminAccounts={adminAccounts} dbOps={dbOps} currentAdmin={loggedInAdmin} showToast={showToast}/>}
          {tab==="inventory"&&isSuperAdmin&&<InventoryHistoryPanel adjustments={adjustments}/>}
          {tab==="audit"&&isSuperAdmin&&<AuditLogPanel auditLogs={auditLogs}/>}
        </div>
      </main>
      {toast&&<div style={{position:"fixed",bottom:isMobile?14:26,right:isMobile?14:26,left:isMobile?14:"auto",background:toast.type==="success"?C.green:C.errorBg,color:toast.type==="success"?C.greenText:C.errorText,border:"1px solid "+(toast.type==="success"?C.greenText:C.errorText),borderRadius:12,padding:"12px 20px",fontSize:14,fontWeight:600,animation:"fadeUp .3s ease",zIndex:999,boxShadow:"0 8px 24px rgba(0,0,0,.5)",display:"flex",alignItems:"center",gap:8}}>{toast.type==="success"?"\u2713":"\u2715"} {toast.msg}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Login
// ═══════════════════════════════════════════════════════════════════════════════
function AdminLogin({ adminAccounts, onAuth, onExit }) {
  const [username, setUsername]=useState("");const [password, setPassword]=useState("");const [showPass, setShowPass]=useState(false);const [error, setError]=useState("");const [shaking, setShaking]=useState(false);const [attempts, setAttempts]=useState(0);const [lockoutSecs, setLockoutSecs]=useState(0);const [loading, setLoading]=useState(false);
  const userRef = useRef();
  useEffect(()=>{userRef.current?.focus();},[]);
  useEffect(()=>{if(lockoutSecs<=0)return;const t=setTimeout(()=>setLockoutSecs(s=>s-1),1000);return()=>clearTimeout(t);},[lockoutSecs]);
  async function attempt() {
    if(lockoutSecs>0||loading)return;if(!username.trim()||!password){setError("Please enter your username and password.");return;}
    setLoading(true);setError("");
    try{const hash=hashPassword(password);const admin=adminAccounts.find(a=>a.username.toLowerCase()===username.trim().toLowerCase()&&a.passwordHash===hash);
      if(admin){onAuth(admin);}else{const next=attempts+1;setAttempts(next);const exists=adminAccounts.find(a=>a.username.toLowerCase()===username.trim().toLowerCase());setError(exists?"Incorrect password":"Username not found");setShaking(true);setPassword("");if(next>=5){setLockoutSecs(60);setAttempts(0);setError("Too many attempts. Locked for 60s.");}setTimeout(()=>setShaking(false),700);}
    }finally{setLoading(false);}
  }
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:F.body,color:C.cream,padding:40}}>
      <img src="/Champs%20Meats.svg" alt="Champs Meats" style={{height:"60px",width:"auto",objectFit:"contain",marginBottom:14}}/>
      <div style={{fontFamily:F.display,fontSize:26,fontWeight:900,letterSpacing:4,color:C.cream,marginBottom:4}}>ADMIN ACCESS</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:32}}>Sign in with your admin credentials</div>
      <div style={{background:C.surface,border:"1px solid "+C.borderMid,borderRadius:18,padding:"34px 36px",width:380,maxWidth:"95vw",animation:shaking?"shake .6s ease":"scaleIn .3s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)"}}>
        <div style={{marginBottom:16}}><label style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,display:"block",marginBottom:7}}>Username</label><input ref={userRef} type="text" value={username} onChange={e=>{setUsername(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder="Enter your username" autoCapitalize="none" autoCorrect="off" spellCheck="false" disabled={lockoutSecs>0} style={{width:"100%",background:C.card,border:"1px solid "+(error?C.red:C.borderMid),borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15,transition:"border .2s"}}/></div>
        <div style={{marginBottom:20}}><label style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,display:"block",marginBottom:7}}>Password</label><div style={{position:"relative"}}><input type={showPass?"text":"password"} value={password} onChange={e=>{setPassword(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder="Enter your password" disabled={lockoutSecs>0} style={{width:"100%",background:C.card,border:"1px solid "+(error?C.red:C.borderMid),borderRadius:10,padding:"12px 44px 12px 14px",color:C.cream,fontFamily:F.body,fontSize:15,transition:"border .2s"}}/><button onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:17,lineHeight:1}}>{showPass?"\u{1F648}":"\u{1F441}"}</button></div></div>
        {error&&<div style={{background:C.errorBg,color:C.errorText,borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:14}}>{error}{lockoutSecs>0?" ("+lockoutSecs+"s)":""}</div>}
        <button onClick={attempt} disabled={lockoutSecs>0||!username.trim()||!password||loading} style={{width:"100%",background:lockoutSecs>0||!username.trim()||!password?C.border:C.red,border:"none",color:C.cream,borderRadius:10,padding:"14px",fontSize:16,fontWeight:700,cursor:lockoutSecs>0?"not-allowed":"pointer",fontFamily:F.body,transition:"background .2s",opacity:lockoutSecs>0?.6:1}}>{loading?"Signing in\u2026":lockoutSecs>0?"Locked \u2014 wait "+lockoutSecs+"s":"Sign In to Admin Panel"}</button>
        <button onClick={onExit} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",width:"100%",marginTop:12,fontFamily:F.body,fontSize:14,padding:"8px 0"}}>{"\u2190"} Back to Mode Select</button>
      </div>
    </div>
  );
}

// ─── Receipt Modal ──────────────────────────────────────────────────────────
function ReceiptModal({ order, onClose }) {
  function printReceipt() {
    const items = order.items || [];
    const html = '<!DOCTYPE html><html><head><title>Receipt #'+(order.orderNumber||"")+'</title><style>@page{size:80mm auto;margin:4mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:13px;color:#000;padding:8px;max-width:80mm}.header{text-align:center;border-bottom:2px dashed #000;padding-bottom:10px;margin-bottom:10px}.shop-name{font-size:18px;font-weight:900;letter-spacing:2px;text-transform:uppercase}.receipt-label{font-size:14px;font-weight:700;margin-top:4px;letter-spacing:3px}.order-num{font-size:20px;font-weight:900;margin:6px 0}.info-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}.items{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:8px 0;margin:10px 0}.item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ccc}.item:last-child{border-bottom:none}.total-row{display:flex;justify-content:space-between;font-size:16px;font-weight:900;margin-top:8px;padding-top:8px;border-top:2px solid #000}.footer{text-align:center;font-size:10px;margin-top:12px;color:#666}@media print{body{padding:0}}</style></head><body><div class="header"><div class="shop-name">Champ\'s Butcher Shop</div><div class="receipt-label">\u2014 RECEIPT \u2014</div><div class="order-num">#'+(order.orderNumber||"")+'</div></div><div class="info-row"><span>Customer:</span><strong>'+(order.user||"Walk-in")+'</strong></div><div class="info-row"><span>Date:</span><span>'+(order.ts?new Date(order.ts).toLocaleString():"")+'</span></div>'+(order.deliveryLocation?'<div class="info-row"><span>Delivery:</span><span>'+order.deliveryLocation+'</span></div>':"")+'<div class="items">'+items.map(i=>'<div class="item"><span>'+i.name+' x'+i.quantity+'</span><span>$'+(i.price*i.quantity).toFixed(2)+'</span></div>').join("")+'</div><div class="total-row"><span>TOTAL</span><span>$'+(order.total||0).toFixed(2)+'</span></div><div class="footer">Thank you!<br>Champ\'s Meats \u2014 Halstead, KS<br>Printed '+new Date().toLocaleString()+'</div><script>window.onload=function(){window.print();}<\/script></body></html>';
    openPrintWindow(html);
  }
  const items = order.items || [];
  return (
    <Modal title={"Receipt #"+(order.orderNumber||"")} onClose={onClose}>
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
      <div style={{display:"flex",gap:10}}><Btn ghost onClick={onClose}>Close</Btn><Btn primary onClick={printReceipt}>Print Receipt</Btn></div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
function AdminDashboard({ menu, users, orders, dbOps, isMobile, isTablet }) {
  const totalRev=orders.reduce((s,o)=>s+(o.total||0),0);
  const onMenu=menu.filter(i=>i.showOnKiosk!==false).length;
  const itemCounts={};orders.forEach(o=>o.items?.forEach(i=>{itemCounts[i.name]=(itemCounts[i.name]||0)+(i.quantity||0);}));
  const topItems=Object.entries(itemCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const todayStr=new Date().toDateString();
  const todayOrders=orders.filter(o=>o.ts&&new Date(o.ts).toDateString()===todayStr);
  const todayRev=todayOrders.reduce((s,o)=>s+(o.total||0),0);
  const [hoveredStat,setHoveredStat]=useState(null);const [deletingId,setDeletingId]=useState(null);const [receiptOrder,setReceiptOrder]=useState(null);const [orderTimeFilter,setOrderTimeFilter]=useState("all");const [orderPage,setOrderPage]=useState(0);
  const [ordersOpen,setOrdersOpen]=useState(!isMobile);const [topItemsOpen,setTopItemsOpen]=useState(!isMobile);
  const ORDER_PAGE_SIZE=10;
  async function deleteOrder(id){setDeletingId(id);try{await dbOps.deleteOrder(id);}catch(e){console.error(e);}finally{setDeletingId(null);}}

  const stats=[
    {label:"Total Orders",  value:orders.length,            accent:C.red},
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
          {ordersOpen&&(()=>{const now=new Date();const filtered=orders.filter(o=>{if(orderTimeFilter==="all")return true;if(!o.ts)return false;const d=new Date(o.ts);if(orderTimeFilter==="today")return d.toDateString()===now.toDateString();if(orderTimeFilter==="week"){const wa=new Date(now);wa.setDate(wa.getDate()-7);return d>=wa;}if(orderTimeFilter==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true;});const filteredRev=filtered.reduce((s,o)=>s+(o.total||0),0);
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
function MenuManager({ menu, catNames, dbOps, showToast, isMobile }) {
  const blank={name:"",description:"",price:"",category:catNames[0]||"Other",image:"",isBundle:false,bundleItems:[],showOnKiosk:true,stock:"",inStock:true};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [search,setSearch]=useState("");const [filter,setFilter]=useState("All");const [viewFilter,setViewFilter]=useState("all");const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState({});const [dragIdx,setDragIdx]=useState(null);const [overIdx,setOverIdx]=useState(null);const dragNodeRef=useRef(null);
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
  async function autoNumberAll(){setSaving(prev=>({...prev,_bulk:true}));try{for(let i=0;i<onMenuSorted.length;i++){if(onMenuSorted[i].menuOrder!==i)await dbOps.updateMenuItem(onMenuSorted[i].id,{menuOrder:i});}showToast("Menu order saved");}catch(e){console.error(e);showToast("Reorder failed","error");}finally{setSaving(prev=>{const n={...prev};delete n._bulk;return n;});}}
  return (
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr 1fr":"repeat(3,1fr)",gap:isMobile?8:12,marginBottom:20}}>
        {[{label:"Total Items",value:menu.length,color:C.cream},{label:"On Kiosk",value:onCount,color:C.greenText},{label:"Hidden",value:offCount,color:C.muted}].map(s=><div key={s.label} style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 16px"}}><div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:8}}>{s.label}</div><div style={{fontFamily:F.display,fontSize:26,fontWeight:900,color:s.color}}>{s.value}</div></div>)}
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items\u2026" style={{...inputSt(),flex:1,minWidth:180}}/>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={inputSt(true)}><option value="All">All Categories</option>{catNames.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <div style={{display:"flex",gap:4,background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:3}}>{[{id:"all",label:"All ("+menu.length+")"},{id:"on",label:"On ("+onCount+")"},{id:"off",label:"Off ("+offCount+")"}].map(f=><button key={f.id} onClick={()=>setViewFilter(f.id)} style={{background:viewFilter===f.id?C.surface:"transparent",border:"1px solid "+(viewFilter===f.id?C.borderMid:"transparent"),color:viewFilter===f.id?C.cream:C.muted,borderRadius:7,padding:"5px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:600,transition:"all .15s"}}>{f.label}</button>)}</div>
        <Btn primary onClick={()=>{setEditing({...blank,category:catNames[0]||"Other"});setIsNew(true);}}>+ Add Item</Btn>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}><button onClick={autoNumberAll} disabled={saving._bulk} style={{background:"rgba(255,255,255,.03)",border:"1px solid "+C.border,color:C.muted,borderRadius:8,padding:"7px 14px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:700,opacity:saving._bulk?.5:1}}>{saving._bulk?"Saving...":"\u2195 Re-number Order"}</button></div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}><div style={{overflowX:"auto"}}><div style={{minWidth:750}}>
        <div style={{display:"grid",gridTemplateColumns:"44px 60px 1fr 130px 90px 100px 140px",borderBottom:"1px solid "+C.border,padding:"9px 16px"}}>{["","Image","Name","Category","Price","Kiosk","Actions"].map(h=><div key={h||"order"} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {displayed.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No items found</div>:displayed.map((item,dispIdx)=>{const isOn=item.showOnKiosk!==false;const isSavingThis=saving[item.id];const onIdx=onMenuSorted.indexOf(item);return(
          <div key={item.id} data-row className="row-hover" draggable={isOn} onDragStart={e=>isOn&&handleDragStart(e,onIdx)} onDragOver={e=>isOn&&handleDragOver(e,onIdx)} onDrop={e=>isOn&&handleDrop(e,onIdx)} onDragEnd={handleDragEnd} style={{display:"grid",gridTemplateColumns:"44px 60px 1fr 130px 90px 100px 140px",borderBottom:"1px solid "+C.border,padding:"10px 16px",alignItems:"center",transition:"background .15s",opacity:isOn?1:.6,background:overIdx===onIdx&&dragIdx!==onIdx?"rgba(155,28,28,.15)":"transparent",borderTop:overIdx===onIdx&&dragIdx!==onIdx?"2px solid "+C.red:"2px solid transparent"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:isOn?"grab":"default",userSelect:"none"}}>{isOn?<span style={{fontSize:18,color:isSavingThis?C.border:C.muted,lineHeight:1}} title="Drag to reorder">{"\u2801\u2801\u2801"}</span>:<span style={{fontSize:10,color:C.border}}>{"\u2014"}</span>}</div>
            <Img src={item.image} alt={item.name} style={{width:44,height:44,objectFit:"cover",borderRadius:7,border:"1px solid "+C.border}}/>
            <div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{item.name}{item.isBundle&&<span style={{background:"#1e40af",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,marginLeft:8,letterSpacing:1,verticalAlign:"middle"}}>BUNDLE</span>}</div><div style={{fontSize:12,color:C.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>{item.description}</div></div>
            <div><span style={{background:C.surface,border:"1px solid "+C.border,borderRadius:5,padding:"3px 9px",fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>{item.category}</span></div>
            <div style={{fontFamily:F.display,fontSize:15,color:C.red,fontWeight:700}}>${(item.price||0).toFixed(2)}</div>
            <div><button onClick={()=>toggleKiosk(item)} disabled={isSavingThis} style={{background:isOn?C.green:C.surface,color:isOn?C.greenText:C.muted,border:"1px solid "+(isOn?"rgba(74,222,128,.3)":C.border),borderRadius:20,padding:"6px 14px",cursor:isSavingThis?"wait":"pointer",fontFamily:F.body,fontSize:12,fontWeight:700,transition:"all .2s",opacity:isSavingThis?.5:1,minWidth:80,textAlign:"center"}}>{isSavingThis?"\u2026":isOn?"\u25CF On":"\u25CB Off"}</button></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button onClick={()=>{setEditing({...item,price:String(item.price),showOnKiosk:item.showOnKiosk!==false});setIsNew(false);}} style={smallBtn()}>Edit</button><button onClick={()=>setConfirmDel(item.id)} style={smallBtn(true)}>Del</button></div>
          </div>);})}
      </div></div></div>
      {editing&&<ItemModal item={editing} isNew={isNew} saving={saving._save} catNames={catNames} menu={menu} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveItem(editing)} onClose={()=>setEditing(null)}/>}
      {confirmDel&&<ConfirmModal message={"Delete \""+((menu.find(m=>m.id===confirmDel)||{}).name||"")+"\"? This cannot be undone."} confirmLabel="Delete Item" danger onConfirm={()=>deleteItem(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Item Modal
// ═══════════════════════════════════════════════════════════════════════════════
function ItemModal({item,isNew,saving,catNames,onChange,onSave,onClose,menu}){
  const invalid=!item.name.trim()||!item.price||isNaN(parseFloat(item.price));const nonBundleItems=(menu||[]).filter(m=>!m.isBundle&&m.id!==item.id);const bundleItems=item.bundleItems||[];
  const [uploading,setUploading]=useState(false);const [uploadingBarcode,setUploadingBarcode]=useState(false);
  function addBundleItem(){onChange({bundleItems:[...bundleItems,{itemId:nonBundleItems[0]?.id||"",quantity:1}]});}
  function updateBundleItem(idx,field,val){const updated=[...bundleItems];updated[idx]={...updated[idx],[field]:val};onChange({bundleItems:updated});}
  function removeBundleItem(idx){onChange({bundleItems:bundleItems.filter((_,i)=>i!==idx)});}
  async function handlePhotoUpload(e){const file=e.target.files?.[0];if(!file)return;setUploading(true);try{const path="menu-images/"+Date.now()+"_"+file.name;const storageRef=ref(storage,path);await uploadBytes(storageRef,file);const url=await getDownloadURL(storageRef);onChange({image:url});}catch(err){console.error(err);}finally{setUploading(false);}}
  async function handleBarcodeUpload(e){const file=e.target.files?.[0];if(!file)return;setUploadingBarcode(true);try{const path="barcode-images/"+Date.now()+"_"+file.name;const storageRef=ref(storage,path);await uploadBytes(storageRef,file);const url=await getDownloadURL(storageRef);onChange({barcodeImage:url});}catch(err){console.error(err);}finally{setUploadingBarcode(false);}}
  return(<Modal title={isNew?"Add Menu Item":"Edit Menu Item"} onClose={onClose} wide>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}><Field label="Item Name *"><input value={item.name} onChange={e=>onChange({name:e.target.value})} placeholder="e.g. Ribeye Steak" style={inputSt()}/></Field><Field label="Price ($) *"><input value={item.price} onChange={e=>onChange({price:e.target.value})} placeholder="0.00" type="number" step="0.01" style={inputSt()}/></Field></div>
    <Field label="Description" style={{marginBottom:14}}><textarea value={item.description||""} onChange={e=>onChange({description:e.target.value})} rows={3} placeholder="Brief description" style={{...inputSt(),resize:"vertical"}}/></Field>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}><Field label="Category"><select value={item.category} onChange={e=>onChange({category:e.target.value})} style={inputSt(true)}>{(catNames||[]).map(c=><option key={c} value={c}>{c}</option>)}</select></Field><Field label="SKU"><input value={item.sku||""} onChange={e=>onChange({sku:e.target.value})} placeholder="e.g. RIB-001, GB-5LB" style={inputSt()}/></Field><Field label="Stock Qty"><input value={item.stock===null||item.stock===undefined?"":item.stock} onChange={e=>onChange({stock:e.target.value})} placeholder="Leave blank = unlimited" type="number" min="0" style={inputSt()}/></Field></div>
    <Field label="Product Photo" style={{marginBottom:14}}>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <label style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{uploading?"Uploading\u2026":"Upload Photo"}<input type="file" accept="image/*" onChange={handlePhotoUpload} style={{display:"none"}}/></label>
        <div style={{fontSize:12,color:C.muted}}>or</div>
        <input value={item.image||""} onChange={e=>onChange({image:e.target.value})} placeholder="Paste image URL\u2026" style={{...inputSt(),flex:1}}/>
      </div>
    </Field>
    {item.image&&<div style={{marginBottom:14}}><Img src={item.image} alt="preview" style={{height:110,width:"100%",objectFit:"cover",borderRadius:10,border:"1px solid "+C.border}}/></div>}
    <Field label="Barcode Image" style={{marginBottom:14}}>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <label style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{uploadingBarcode?"Uploading\u2026":"Upload Barcode"}<input type="file" accept="image/*" onChange={handleBarcodeUpload} style={{display:"none"}}/></label>
        {item.barcodeImage&&<button onClick={()=>onChange({barcodeImage:""})} style={{background:C.errorBg,border:"none",color:C.errorText,borderRadius:7,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>Remove</button>}
      </div>
    </Field>
    {item.barcodeImage&&<div style={{marginBottom:14,background:"#fff",borderRadius:10,padding:"10px",display:"flex",justifyContent:"center"}}><img src={item.barcodeImage} alt="barcode" style={{maxHeight:80,objectFit:"contain"}}/></div>}
    <Field label="Show on Kiosk" style={{marginBottom:14}}><button onClick={()=>onChange({showOnKiosk:!item.showOnKiosk})} style={{width:"100%",background:item.showOnKiosk?"rgba(22,101,52,.2)":"rgba(255,255,255,.03)",color:item.showOnKiosk?C.greenText:C.muted,border:"1px solid "+(item.showOnKiosk?"rgba(74,222,128,.3)":C.border),borderRadius:10,padding:"10px 13px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,textAlign:"left",transition:"all .2s"}}>{item.showOnKiosk?"\u25CF Visible on kiosk":"\u25CB Hidden from kiosk"}</button></Field>
    <Field label="Bundle" style={{marginBottom:14}}><button onClick={()=>onChange({isBundle:!item.isBundle,bundleItems:item.isBundle?[]:(item.bundleItems||[])})} style={{width:"100%",background:item.isBundle?"#1e40af":C.surface,color:item.isBundle?C.cream:C.muted,border:"1px solid "+(item.isBundle?"#3b82f6":C.border),borderRadius:10,padding:"10px 13px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,textAlign:"left",transition:"all .2s"}}>{item.isBundle?"\u25C6 This is a Bundle":"\u25CB Regular item \u2014 click to make a bundle"}</button></Field>
    {item.isBundle&&<Field label="Bundle Contents" style={{marginBottom:14}}><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:12}}>{bundleItems.length===0&&<div style={{fontSize:12,color:C.muted,padding:"8px 0",textAlign:"center"}}>No items added yet</div>}{bundleItems.map((bi,idx)=><div key={idx} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><select value={bi.itemId} onChange={e=>updateBundleItem(idx,"itemId",e.target.value)} style={{...inputSt(true),flex:1}}><option value="">Select item\u2026</option>{nonBundleItems.map(m=><option key={m.id} value={m.id}>{m.name} (${(m.price||0).toFixed(2)})</option>)}</select><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:C.muted}}>Qty:</span><input type="number" min="1" max="99" value={bi.quantity} onChange={e=>updateBundleItem(idx,"quantity",Math.max(1,parseInt(e.target.value)||1))} style={{...inputSt(),width:55,textAlign:"center"}}/></div><button onClick={()=>removeBundleItem(idx)} style={{background:C.errorBg,border:"none",color:C.errorText,cursor:"pointer",fontSize:14,width:32,height:32,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{"\u2715"}</button></div>)}<button onClick={addBundleItem} disabled={nonBundleItems.length===0} style={{background:C.surface,border:"1px dashed "+C.border,color:C.muted,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:600,width:"100%",marginTop:4}}>+ Add Item to Bundle</button></div>{bundleItems.length>0&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Items value: ${bundleItems.reduce((sum,bi)=>{const m=nonBundleItems.find(x=>x.id===bi.itemId);return sum+(m?(m.price||0)*bi.quantity:0);},0).toFixed(2)} {"\u2014"} Bundle price: ${parseFloat(item.price||0).toFixed(2)}</div>}</Field>}
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn ghost onClick={onClose}>Cancel</Btn><Btn primary onClick={onSave} disabled={invalid||saving||uploading||uploadingBarcode}>{saving?"Saving\u2026":isNew?"Add Item":"Save Changes"}</Btn></div>
  </Modal>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Categories Manager
// ═══════════════════════════════════════════════════════════════════════════════
function CategoriesManager({ categories, menu, dbOps, showToast }) {
  const [newName,setNewName]=useState("");const [editingId,setEditingId]=useState(null);const [editName,setEditName]=useState("");const [saving,setSaving]=useState(false);const inputRef=useRef(null);
  async function handleAdd(){const name=newName.trim();if(!name)return;if(categories.find(c=>c.name.toLowerCase()===name.toLowerCase())){showToast("That category already exists","error");return;}setSaving(true);try{await dbOps.addCategory(name);setNewName("");showToast('"'+name+'" category added');inputRef.current?.focus();}catch(e){console.error(e);showToast("Add failed","error");}finally{setSaving(false);}}
  async function handleRename(id){const name=editName.trim();if(!name)return;if(categories.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.id!==id)){showToast("That name is already taken","error");return;}setSaving(true);try{await dbOps.renameCategory(id,name);setEditingId(null);showToast("Category renamed");}catch(e){console.error(e);showToast("Rename failed","error");}finally{setSaving(false);}}
  async function handleDelete(cat){const inUse=menu.filter(i=>i.category===cat.name).length;if(inUse>0){try{const batch=writeBatch(db);menu.filter(i=>i.category===cat.name).forEach(item=>{batch.update(doc(db,"kioskMenu",item.id),{category:"Uncategorized"});});batch.delete(doc(db,"kioskCategories",cat.id));await batch.commit();showToast('"'+cat.name+'" deleted \u2014 '+inUse+' item'+(inUse!==1?"s":"")+" moved to Uncategorized");}catch(e){console.error(e);showToast("Delete failed","error");}}else{try{await dbOps.deleteCategory(cat.id);showToast('"'+cat.name+'" removed',"error");}catch(e){console.error(e);showToast("Delete failed","error");}}}
  return (
    <div style={{animation:"fadeUp .3s ease",maxWidth:580}}>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"18px 20px",marginBottom:18}}>
        <div style={{fontSize:12,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:12}}>Add New Category</div>
        <div style={{display:"flex",gap:10}}><input ref={inputRef} value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="e.g. BBQ, Spices, Seafood\u2026" style={{...inputSt(),flex:1}}/><Btn primary onClick={handleAdd} disabled={!newName.trim()||saving}>{saving?"Adding\u2026":"+ Add"}</Btn></div>
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px 110px",borderBottom:"1px solid "+C.border,padding:"9px 18px"}}>{["Category Name","Items","Actions"].map(h=><div key={h} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {categories.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No categories yet</div>:categories.map((cat,idx)=>{const itemCount=menu.filter(i=>i.category===cat.name).length;const isEditing=editingId===cat.id;return(
          <div key={cat.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 80px 110px",borderBottom:"1px solid "+C.border,padding:"11px 18px",alignItems:"center",transition:"background .15s"}}>
            <div>{isEditing?<div style={{display:"flex",gap:8}}><input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleRename(cat.id);if(e.key==="Escape")setEditingId(null);}} autoFocus style={{...inputSt(),padding:"6px 10px",fontSize:14}}/><button onClick={()=>handleRename(cat.id)} disabled={!editName.trim()||saving} style={{background:C.green,border:"none",color:C.greenText,borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:13,fontWeight:700}}>{"\u2713"}</button><button onClick={()=>setEditingId(null)} style={{background:C.border,border:"none",color:C.muted,borderRadius:7,padding:"5px 10px",cursor:"pointer",fontSize:13}}>{"\u2715"}</button></div>:<div style={{display:"flex",alignItems:"center",gap:10}}><div style={{display:"flex",flexDirection:"column",gap:2}}><button onClick={()=>dbOps.reorderCategory(cat.id,"up")} disabled={idx===0} style={{background:"transparent",border:"none",color:idx===0?C.border:C.muted,cursor:idx===0?"default":"pointer",fontSize:10,lineHeight:1,padding:"1px 3px"}}>{"\u25B2"}</button><button onClick={()=>dbOps.reorderCategory(cat.id,"down")} disabled={idx===categories.length-1} style={{background:"transparent",border:"none",color:idx===categories.length-1?C.border:C.muted,cursor:idx===categories.length-1?"default":"pointer",fontSize:10,lineHeight:1,padding:"1px 3px"}}>{"\u25BC"}</button></div><span style={{fontSize:15,color:C.cream,fontWeight:600}}>{cat.name}</span></div>}</div>
            <div><span style={{fontSize:13,color:itemCount>0?C.mutedLight:C.border}}>{itemCount} item{itemCount!==1?"s":""}</span></div>
            <div style={{display:"flex",gap:6}}>{!isEditing&&<><button onClick={()=>{setEditingId(cat.id);setEditName(cat.name);}} style={smallBtn()}>Rename</button><button onClick={()=>handleDelete(cat)} style={smallBtn(true,false)}>Del{itemCount>0?" ("+itemCount+")":""}</button></>}</div>
          </div>);})}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// User Manager
// ═══════════════════════════════════════════════════════════════════════════════
function UserManager({ users, dbOps, showToast, isMobile }) {
  const blank={firstName:"",lastName:"",email:"",phone:"",deliveryLocation:DELIVERY_LOCATIONS[0]};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState(false);const [viewing,setViewing]=useState(null);
  function displayName(u){return((u.firstName||"")+" "+(u.lastName||"")).trim()||u.name||"Unnamed";}
  function editUser(user){setEditing({...user,firstName:user.firstName||user.name||"",lastName:user.lastName||"",email:user.email||"",phone:user.phone||"",deliveryLocation:user.deliveryLocation||DELIVERY_LOCATIONS[0]});setIsNew(false);setViewing(null);}
  async function saveUser(user){if(saving)return;if(!(user.firstName||"").trim()||(!(user.email||"").trim()&&!(user.phone||"").trim())){showToast("First name and either email or phone required","error");return;}setSaving(true);try{const data={firstName:(user.firstName||"").trim(),lastName:(user.lastName||"").trim(),email:(user.email||"").trim().toLowerCase(),phone:(user.phone||"").trim(),deliveryLocation:user.deliveryLocation||DELIVERY_LOCATIONS[0]};if(isNew){await dbOps.addUser(data);showToast("Employee added");}else{await dbOps.updateUser(user.id,data);showToast("Employee updated");}setEditing(null);}catch(e){console.error(e);showToast("Save failed","error");}finally{setSaving(false);}}
  async function deleteUser(id){try{await dbOps.deleteUser(id);showToast("Employee removed","error");setConfirmDel(null);setViewing(null);}catch(e){console.error(e);showToast("Delete failed","error");}}
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><div style={{fontSize:13,color:C.muted}}>{users.length} employee{users.length!==1?"s":""} registered</div><Btn primary onClick={()=>{setEditing({...blank});setIsNew(true);}}>+ Add Employee</Btn></div>

      {/* Mobile: name-only card list */}
      {isMobile?(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {users.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"40px",textAlign:"center",color:C.muted}}>No employees yet</div>
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
        {users.length===0?<div style={{padding:"40px",textAlign:"center",color:C.muted}}>No employees yet</div>:users.map(user=><div key={user.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 1fr 180px 140px 160px 100px",borderBottom:"1px solid "+C.border,padding:"13px 18px",alignItems:"center",transition:"background .15s"}}>
          <div style={{fontSize:15,color:C.cream,fontWeight:600}}>{user.firstName||user.name||"—"}</div>
          <div style={{fontSize:15,color:C.cream}}>{user.lastName||""}</div>
          <div style={{fontSize:13,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email||"\u2014"}</div>
          <div style={{fontSize:13,color:C.muted,whiteSpace:"nowrap"}}>{user.phone||"\u2014"}</div>
          <div style={{fontSize:13,color:C.muted,whiteSpace:"nowrap"}}>{user.deliveryLocation||"\u2014"}</div>
          <div style={{display:"flex",gap:6}}><button onClick={()=>editUser(user)} style={smallBtn()}>Edit</button><button onClick={()=>setConfirmDel(user.id)} style={smallBtn(true)}>Del</button></div>
        </div>)}
      </div></div></div>
      )}

      {/* Mobile: View employee detail modal */}
      {viewing&&<Modal title={displayName(viewing)} onClose={()=>setViewing(null)}>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>First Name</span><span style={{color:C.cream,fontWeight:600}}>{viewing.firstName||viewing.name||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Last Name</span><span style={{color:C.cream,fontWeight:600}}>{viewing.lastName||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Email</span><span style={{color:C.cream}}>{viewing.email||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Phone</span><span style={{color:C.cream}}>{viewing.phone||"\u2014"}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:C.muted}}>Delivery Location</span><span style={{color:C.cream}}>{viewing.deliveryLocation||"\u2014"}</span></div>
        </div>
        <div style={{display:"flex",gap:10}}><Btn ghost onClick={()=>setViewing(null)}>Close</Btn><Btn primary onClick={()=>editUser(viewing)}>Edit</Btn><button onClick={()=>{setViewing(null);setConfirmDel(viewing.id);}} style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600}}>Delete</button></div>
      </Modal>}

      {editing&&<UserModal user={editing} isNew={isNew} saving={saving} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveUser(editing)} onClose={()=>setEditing(null)}/>}
      {confirmDel&&<ConfirmModal message={"Remove \""+displayName(users.find(u=>u.id===confirmDel)||{})+"\"?"} confirmLabel="Remove Employee" danger onConfirm={()=>deleteUser(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

function UserModal({user,isNew,saving,onChange,onSave,onClose}){
  const invalid=!(user.firstName||"").trim()||(!(user.email||"").trim()&&!(user.phone||"").trim());
  return(<Modal title={isNew?"Add Employee":"Edit Employee"} onClose={onClose}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
      <Field label="First Name *"><input value={user.firstName||""} onChange={e=>onChange({firstName:e.target.value})} placeholder="e.g. John" style={inputSt()}/></Field>
      <Field label="Last Name"><input value={user.lastName||""} onChange={e=>onChange({lastName:e.target.value})} placeholder="e.g. Smith" style={inputSt()}/></Field>
    </div>
    <Field label="Email" style={{marginBottom:14}}><input value={user.email||""} onChange={e=>onChange({email:e.target.value})} placeholder="john@example.com" type="email" style={inputSt()}/></Field>
    <Field label="Phone" style={{marginBottom:14}}><input value={user.phone||""} onChange={e=>onChange({phone:e.target.value})} placeholder="(316) 555-1234" type="tel" style={inputSt()}/></Field>
    <Field label="Delivery Location" style={{marginBottom:14}}><select value={user.deliveryLocation||DELIVERY_LOCATIONS[0]} onChange={e=>onChange({deliveryLocation:e.target.value})} style={inputSt(true)}>{DELIVERY_LOCATIONS.map(loc=><option key={loc} value={loc}>{loc}</option>)}</select></Field>
    <div style={{fontSize:12,color:C.muted,marginBottom:22}}>Email or phone required. Employees set their own password on the kiosk and can reset it using their email and phone number.</div>
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn ghost onClick={onClose}>Cancel</Btn><Btn primary onClick={onSave} disabled={invalid||saving}>{saving?"Saving\u2026":isNew?"Add Employee":"Save Changes"}</Btn></div>
  </Modal>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delivery Panel — grouped by location
// ═══════════════════════════════════════════════════════════════════════════════
function DeliveryPanel({ orders, users, dbOps, showToast }) {
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
// Order History — Active / Archived (delivery moved to its own tab)
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// Order Board Panel — KDS-style picking view inside admin
// ═══════════════════════════════════════════════════════════════════════════════
function OrderBoardPanel({ orders, users, menu, dbOps, showToast, isMobile }) {
  const [savingId,setSavingId]=useState(null);
  const prevCountRef=useRef(0);
  const [flashBg,setFlashBg]=useState(false);

  const active=orders.filter(o=>!o.archived&&["paid","picking"].includes(normalizeStatus(o.status))).sort((a,b)=>new Date(a.ts||0)-new Date(b.ts||0));

  // Chime on new orders
  useEffect(()=>{
    if(active.length>prevCountRef.current&&prevCountRef.current>0){
      try{const ctx=new(window.AudioContext||window.webkitAudioContext)();[[880,0],[1100,.15],[1320,.28]].forEach(([freq,t])=>{const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=freq;g.gain.setValueAtTime(0.22,ctx.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.28);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.3);});}catch(e){}
      setFlashBg(true);setTimeout(()=>setFlashBg(false),800);
    }
    prevCountRef.current=active.length;
  },[active.length]);

  async function toggleItem(order,idx){const checked=[...(order.checkedItems||[])];const pos=checked.indexOf(idx);if(pos===-1)checked.push(idx);else checked.splice(pos,1);try{await dbOps.updateOrder(order.id,{checkedItems:checked});}catch(e){console.error(e);}}

  async function sendToDelivery(order){setSavingId(order.id);try{const history=[...(order.statusHistory||[]),{status:"out_for_delivery",at:new Date().toISOString(),by:"admin"}];await dbOps.updateOrder(order.id,{status:"out_for_delivery",statusHistory:history});showToast("Sent to delivery");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingId(null);}}

  function printPickTicket(order){
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
    const skuBcJs=items.map((i,idx)=>{if(i.sku&&!i.barcodeImage){const id=items.slice(0,idx).filter(x=>x.sku&&!x.barcodeImage).length;return'try{JsBarcode("#item-bc-'+id+'","'+i.sku+'",{format:"CODE128",width:1.6,height:30,displayValue:false,margin:0});}catch(e){}';}return'';}).filter(Boolean).join("");
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
<script>window.onload=function(){try{JsBarcode("#order-bc","${orderNum}",{format:"CODE128",width:2.2,height:50,displayValue:false,margin:0});}catch(e){}${skuBcJs}window.print();};<\/script>
</body></html>`;
    openPrintWindow(html);
  }

  function timeAgo(ts){if(!ts)return"";const mins=Math.floor((Date.now()-new Date(ts))/60000);if(mins<1)return"just now";if(mins===1)return"1 min ago";return mins+" min ago";}

  if(active.length===0) return(
    <div style={{animation:"fadeUp .3s ease",textAlign:"center",padding:"60px 20px"}}>
      <div style={{fontSize:48,opacity:.15,marginBottom:12}}>{"\u{1F4E6}"}</div>
      <div style={{fontFamily:F.display,fontSize:22,color:C.muted,marginBottom:8}}>No orders to pick</div>
      <div style={{fontSize:14,color:C.border}}>When an order is marked as paid, it will appear here for packing</div>
    </div>
  );

  return(
    <div style={{animation:"fadeUp .3s ease",background:flashBg?"rgba(155,28,28,.1)":"transparent",transition:"background .4s",borderRadius:14,padding:flashBg?10:0}}>
      <div style={{fontSize:13,color:C.muted,marginBottom:16}}>{active.length} order{active.length!==1?"s":""} to pick</div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(340px,1fr))",gap:16,alignItems:"start"}}>
        {active.map(order=>{
          const checked=order.checkedItems||[];const totalItems=order.items?.length||0;const allChecked=totalItems>0&&checked.length>=totalItems;
          const ageMs=order.ts?Date.now()-new Date(order.ts):0;const isNew=ageMs<120000&&ageMs>0;const isOld=ageMs>600000;
          return(
            <div key={order.id} style={{background:"#ffffff",border:"2px solid "+(isNew?C.red:isOld?C.amber:"#e5e7eb"),borderRadius:18,overflow:"hidden",boxShadow:isNew?"0 0 28px rgba(155,28,28,.45)":isOld?"0 0 18px rgba(146,64,14,.3)":"none",animation:"fadeUp .25s ease"}}>
              {/* Card header */}
              <div style={{padding:"14px 16px",background:isNew?"#fef2f2":"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{fontFamily:F.display,fontSize:24,fontWeight:900,color:"#111827",flex:1}}>#{order.orderNumber||"\u2014"}</div>
                  {isNew&&<span style={{background:"#dc2626",color:"#fff",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:900,letterSpacing:2,animation:"pulse 1.4s infinite"}}>NEW</span>}
                  {isOld&&!isNew&&<span style={{background:"#ea580c",color:"#fff",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>WAITING</span>}
                </div>
                <div style={{fontSize:15,color:"#111827",fontWeight:600}}>{order.user||"Walk-in"}</div>
                <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{timeAgo(order.ts)} {order.deliveryLocation?"\u00B7 "+order.deliveryLocation:""}</div>
              </div>
              {/* Checklist */}
              <div style={{padding:"12px 14px"}}>
                {order.items?.map((item,i)=>{const isChecked=checked.includes(i);return(
                  <div key={i} onClick={()=>toggleItem(order,i)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px",borderRadius:10,marginBottom:6,cursor:"pointer",background:isChecked?"#f0fdf4":"#f9fafb",border:"1px solid "+(isChecked?"#86efac":"#e5e7eb"),opacity:isChecked?.55:1,transition:"all .15s",userSelect:"none"}}>
                    <div style={{width:28,height:28,borderRadius:8,flexShrink:0,border:"2.5px solid "+(isChecked?"#16a34a":"#d1d5db"),background:isChecked?"#16a34a":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>{isChecked&&<span style={{color:"#fff",fontSize:15,fontWeight:900}}>{"\u2713"}</span>}</div>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:isChecked?"#9ca3af":"#111827",textDecoration:isChecked?"line-through":"none"}}>{item.name}</div>{item.sku&&<div style={{fontSize:11,color:"#9ca3af",fontFamily:F.mono,marginTop:1}}>SKU: {item.sku}</div>}</div>
                    <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,color:isChecked?"#d1d5db":"#111827",flexShrink:0}}>{"\u00D7"}{item.quantity}</div>
                  </div>);})}
                {/* Progress */}
                {totalItems>0&&<div style={{marginTop:10,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}><span style={{fontSize:12,color:"#6b7280"}}>{checked.length}/{totalItems} packed</span>{allChecked&&<span style={{fontSize:12,color:"#16a34a",fontWeight:700}}>{"\u2713"} Ready!</span>}</div>
                  <div style={{height:7,background:"#e5e7eb",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,transition:"width .35s ease",background:allChecked?"#16a34a":"#dc2626",width:(checked.length/totalItems)*100+"%"}}/></div>
                </div>}
                {/* Actions */}
                <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                  <button onClick={()=>printPickTicket(order)} style={{flex:1,padding:"12px 8px",background:"#f3f4f6",border:"1px solid #d1d5db",color:"#374151",borderRadius:10,cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,minWidth:100}}>Print Ticket</button>
                  <button onClick={()=>sendToDelivery(order)} disabled={savingId===order.id||!allChecked} style={{flex:2,padding:"12px",background:allChecked?"#16a34a":"#e5e7eb",border:"none",color:allChecked?"#fff":"#9ca3af",borderRadius:10,cursor:(savingId===order.id||!allChecked)?"default":"pointer",fontFamily:F.display,fontSize:14,fontWeight:900,letterSpacing:1,textTransform:"uppercase",opacity:savingId===order.id?.6:1,minHeight:48}}>{savingId===order.id?"Saving...":"Send to Delivery"}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}`}</style>
    </div>
  );
}

function OrderBarcode({value,small}){
  const svgRef=useRef(null);
  useEffect(()=>{if(!svgRef.current||!value)return;const opts={format:"CODE128",width:small?1.5:3,height:small?40:120,displayValue:true,fontSize:small?12:20,background:"transparent",lineColor:small?"#e8dcc8":"#000",textColor:small?"#e8dcc8":"#000",margin:small?4:10};const render=()=>{try{window.JsBarcode(svgRef.current,String(value),opts);}catch(e){console.error(e);}};if(!window.JsBarcode){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";s.onload=render;document.head.appendChild(s);}else{render();};},[value,small]);
  return <svg ref={svgRef}/>;
}

function OrderHistory({ orders, users, dbOps, showToast }) {
  const [search,setSearch]=useState("");const [expanded,setExpanded]=useState(null);const [confirmClear,setConfirmClear]=useState(false);const [view,setView]=useState("active");const [statusFilter,setStatusFilter]=useState("all");const [savingStatus,setSavingStatus]=useState(null);const [customerFilter,setCustomerFilter]=useState("all");const [scanBarcode,setScanBarcode]=useState(null);
  const terminalStatus="delivered";
  function getStatus(order){return normalizeStatus(order.status);}
  const active=orders.filter(o=>!o.archived&&getStatus(o)!=="out_for_delivery");const archived=orders.filter(o=>o.archived);
  const source=view==="active"?active:archived;
  const archivedCustomers=[...new Set(archived.map(o=>o.user).filter(Boolean))].sort();
  const filtered=source.filter(o=>{const ms=o.user?.toLowerCase().includes(search.toLowerCase())||String(o.orderNumber||"").includes(search);const mst=statusFilter==="all"||getStatus(o)===statusFilter;const mc=customerFilter==="all"||o.user===customerFilter;return ms&&mst&&mc;});
  const totalRev=filtered.reduce((s,o)=>s+(o.total||0),0);
  const counts=ORDER_STATUSES.reduce((acc,s)=>{acc[s.id]=active.filter(o=>getStatus(o)===s.id).length;return acc;},{});
  async function setStatus(orderId,newStatus){setSavingStatus(orderId);try{await dbOps.updateOrder(orderId,{status:newStatus});}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function toggleItemChecked(order,itemIndex){const checked=[...(order.checkedItems||[])];const pos=checked.indexOf(itemIndex);if(pos===-1)checked.push(itemIndex);else checked.splice(pos,1);try{await dbOps.updateOrder(order.id,{checkedItems:checked});}catch(e){console.error(e);}}
  async function completeOrder(orderId){setSavingStatus(orderId);try{const order=orders.find(o=>o.id===orderId);const archivedAt=new Date().toISOString();await dbOps.updateOrder(orderId,{status:terminalStatus,archived:true,archivedAt});if(order?.user){const matchedUser=users.find(u=>u.name===order.user);if(matchedUser){await addDoc(collection(db,"kioskUsers",matchedUser.id,"completedOrders"),{orderNumber:order.orderNumber||null,items:order.items||[],total:order.total||0,placedAt:order.ts||null,completedAt:archivedAt});}}showToast("Order completed");if(expanded===orderId)setExpanded(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function restoreOrder(orderId){setSavingStatus(orderId);try{await dbOps.updateOrder(orderId,{status:"picking",archived:false,archivedAt:null,checkedItems:[]});showToast("Order restored");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function handleClearAll(){try{await dbOps.clearOrders();showToast("Orders archived");setConfirmClear(false);setView("active");}catch(e){console.error(e);showToast("Failed","error");}}
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",gap:4,marginBottom:16,background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:4,width:"fit-content"}}>{[{id:"active",label:"Active ("+active.length+")"},{id:"archived",label:"Archived ("+archived.length+")"}].map(t=><button key={t.id} onClick={()=>{setView(t.id);setExpanded(null);setSearch("");setStatusFilter("all");setCustomerFilter("all");}} style={{background:view===t.id?C.red:"transparent",border:"none",color:view===t.id?C.cream:C.muted,borderRadius:8,padding:"8px 18px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600,transition:"all .15s"}}>{t.label}</button>)}</div>
      {view==="active"&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setStatusFilter("all")} style={{background:statusFilter==="all"?C.surface:"transparent",border:"1px solid "+(statusFilter==="all"?C.borderMid:C.border),color:statusFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({active.length})</button>{ORDER_STATUSES.filter(s=>s.id!==terminalStatus).map(s=><button key={s.id} onClick={()=>setStatusFilter(s.id)} style={{background:statusFilter===s.id?s.color:"transparent",color:statusFilter===s.id?s.text:C.muted,border:"1px solid "+(statusFilter===s.id?s.color:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:statusFilter===s.id?700:400}}>{s.label} ({counts[s.id]||0})</button>)}</div>}
      {view==="archived"&&archivedCustomers.length>0&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setCustomerFilter("all")} style={{background:customerFilter==="all"?C.surface:"transparent",border:"1px solid "+(customerFilter==="all"?C.borderMid:C.border),color:customerFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({archived.length})</button>{archivedCustomers.map(name=>{const count=archived.filter(o=>o.user===name).length;return<button key={name} onClick={()=>setCustomerFilter(name)} style={{background:customerFilter===name?C.red:"transparent",color:customerFilter===name?C.cream:C.muted,border:"1px solid "+(customerFilter===name?C.red:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:customerFilter===name?700:400}}>{name} ({count})</button>;})}</div>}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search\u2026" style={{...inputSt(),flex:1,minWidth:200}}/><div style={{fontSize:13,color:C.muted}}>{filtered.length} order{filtered.length!==1?"s":""} {"\u00B7"} <span style={{color:C.red,fontFamily:F.display,fontSize:16}}>${totalRev.toFixed(2)}</span></div>{view==="active"&&active.length>0&&<button onClick={()=>setConfirmClear(true)} style={{background:C.amber,border:"1px solid "+C.amber,color:"#1c1400",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Archive All</button>}</div>
      {filtered.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"60px",textAlign:"center",color:C.muted}}>{view==="archived"?"No archived orders":"No orders match your filters"}</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{filtered.map(order=>{const isExpanded=expanded===order.id;const checkedItems=order.checkedItems||[];const totalItems=order.items?.length||0;const allChecked=totalItems>0&&checkedItems.length===totalItems;const curStatus=getStatus(order);const nextStatuses=ORDER_STATUSES.filter(s=>canTransition(curStatus,s.id));return(
          <div key={order.id} style={{background:C.card,border:"2px solid "+(isExpanded?C.borderMid:C.border),borderRadius:12,overflow:"hidden",transition:"border .2s"}}>
            <div style={{padding:"12px 16px"}}><div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setExpanded(isExpanded?null:order.id)}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:C.muted,fontSize:16,display:"inline-block",transform:isExpanded?"rotate(90deg)":"none",transition:"transform .2s"}}>{"\u203A"}</span><div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{order.user} <span style={{fontFamily:F.mono,fontSize:12,color:C.muted}}>#{order.orderNumber||"\u2014"}</span></div><div style={{fontSize:12,color:C.muted}}>{order.ts?new Date(order.ts).toLocaleString():""}</div></div></div></div>
              {!order.archived&&totalItems>0&&<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:allChecked?C.greenText:C.red,width:(checkedItems.length/totalItems)*100+"%",borderRadius:3,transition:"width .3s"}}/></div><span style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{checkedItems.length}/{totalItems}</span></div>}
              <div style={{fontFamily:F.display,fontSize:16,color:C.red,fontWeight:700,flexShrink:0}}>${(order.total||0).toFixed(2)}</div>
              {!order.archived&&<div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}><StatusBadge status={curStatus}/>{nextStatuses.map(s=><button key={s.id} disabled={savingStatus===order.id} onClick={()=>setStatus(order.id,s.id)} style={{background:C.surface,color:s.text,border:"1px solid "+s.color,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{"\u2192"} {s.label}</button>)}{curStatus!==terminalStatus&&<button disabled={savingStatus===order.id} onClick={()=>completeOrder(order.id)} style={{background:"#166534",color:"#4ade80",border:"1px solid #22c55e",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"\u2713 Complete"}</button>}</div>}
              {order.archived&&<div style={{display:"flex",gap:6,alignItems:"center"}}><StatusBadge status={getStatus(order)}/><button disabled={savingStatus===order.id} onClick={()=>restoreOrder(order.id)} style={{background:C.amber,color:"#1c1400",border:"1px solid "+C.amber,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"\u21A9 Restore"}</button></div>}
            </div></div>
            {isExpanded&&<div style={{borderTop:"1px solid "+C.border,padding:"14px 16px",background:C.surface}}>
              <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:12}}>{order.archived?"Order Items":"Pack Checklist"}</div>
              {order.items?.map((item,i)=>{const isChecked=checkedItems.includes(i);return<div key={i} onClick={()=>!order.archived&&toggleItemChecked(order,i)} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 10px",borderRadius:10,marginBottom:6,cursor:order.archived?"default":"pointer",background:isChecked?"rgba(22,101,52,.15)":"rgba(255,255,255,.02)",border:"1px solid "+(isChecked?"rgba(74,222,128,.2)":C.border),opacity:isChecked?.75:1}}>
                {!order.archived&&<div style={{width:22,height:22,borderRadius:6,border:"2px solid "+(isChecked?C.greenText:C.borderMid),background:isChecked?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{isChecked&&<span style={{color:C.greenText,fontSize:13,fontWeight:900}}>{"\u2713"}</span>}</div>}
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
      {confirmClear&&<ConfirmModal message={"Archive all "+active.length+" active order"+(active.length!==1?"s":"")+"?"} confirmLabel="Archive All" onConfirm={handleClearAll} onClose={()=>setConfirmClear(false)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Accounts Manager
// ═══════════════════════════════════════════════════════════════════════════════
function AdminAccountsManager({ adminAccounts, dbOps, currentAdmin, showToast }) {
  const blank={name:"",username:"",password:"",role:"Admin"};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState(false);
  async function saveAdmin(admin){if(saving)return;if(!admin.name.trim()||!admin.username.trim()){showToast("Name and username required","error");return;}if(isNew&&admin.password.length<6){showToast("Password must be at least 6 characters","error");return;}const taken=adminAccounts.find(a=>a.username.toLowerCase()===admin.username.trim().toLowerCase()&&a.id!==admin.id);if(taken){showToast("Username already taken","error");return;}setSaving(true);try{if(isNew){await dbOps.addAdminAccount(admin);showToast("Admin created");}else{await dbOps.updateAdminAccount(admin.id,admin);showToast("Admin updated");}setEditing(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSaving(false);}}
  async function deleteAdmin(id){if(id===currentAdmin.id){showToast("Cannot delete your own account","error");setConfirmDel(null);return;}try{await dbOps.deleteAdminAccount(id);showToast("Admin removed","error");setConfirmDel(null);}catch(e){console.error(e);showToast("Failed","error");}}
  const rc={"Super Admin":{bg:C.red,text:C.cream},"Admin":{bg:C.amber,text:C.amberText}};
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><div style={{fontSize:13,color:C.muted}}>{adminAccounts.length} admin account{adminAccounts.length!==1?"s":""}</div><Btn primary onClick={()=>{setEditing({...blank});setIsNew(true);}}>+ Add Admin</Btn></div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}><div style={{overflowX:"auto"}}><div style={{minWidth:580}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 150px 160px 120px",borderBottom:"1px solid "+C.border,padding:"9px 18px"}}>{["Name","Role","Username","Actions"].map(h=><div key={h} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
        {adminAccounts.map(admin=>{const isMe=admin.id===currentAdmin.id;const col=rc[admin.role]||rc["Admin"];return<div key={admin.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 150px 160px 120px",borderBottom:"1px solid "+C.border,padding:"13px 18px",alignItems:"center",transition:"background .15s"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:30,height:30,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.cream,flexShrink:0}}>{admin.name.charAt(0).toUpperCase()}</div><div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{admin.name}</div>{isMe&&<div style={{fontSize:11,color:C.muted}}>You</div>}</div></div>
          <div><span style={{background:col.bg,color:col.text,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>{admin.role}</span></div>
          <div style={{fontFamily:F.mono,fontSize:13,color:C.mutedLight}}>{admin.username}</div>
          <div style={{display:"flex",gap:6}}><button onClick={()=>{setEditing({...admin,password:""});setIsNew(false);}} style={smallBtn()}>Edit</button><button onClick={()=>!isMe&&setConfirmDel(admin.id)} style={smallBtn(true,isMe)}>Del</button></div>
        </div>;})}
      </div></div></div>
      {editing&&<AdminAccountModal account={editing} isNew={isNew} saving={saving} onChange={p=>setEditing(prev=>({...prev,...p}))} onSave={()=>saveAdmin(editing)} onClose={()=>setEditing(null)}/>}
      {confirmDel&&<ConfirmModal message={"Remove \""+((adminAccounts.find(a=>a.id===confirmDel)||{}).name||"")+"\"?"} confirmLabel="Remove Admin" danger onConfirm={()=>deleteAdmin(confirmDel)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

function AdminAccountModal({account,isNew,saving,onChange,onSave,onClose}){
  const [showPass,setShowPass]=useState(false);const invalid=!account.name.trim()||!account.username.trim()||(isNew&&account.password.length<6);
  return(<Modal title={isNew?"Create Admin Account":"Edit Admin Account"} onClose={onClose}>
    <Field label="Full Name *" style={{marginBottom:14}}><input value={account.name} onChange={e=>onChange({name:e.target.value})} placeholder="e.g. Frank" style={inputSt()}/></Field>
    <Field label="Username *" style={{marginBottom:14}}><input value={account.username} onChange={e=>onChange({username:e.target.value.toLowerCase().replace(/\s/g,"")})} placeholder="e.g. frank" style={{...inputSt(),fontFamily:F.mono}}/></Field>
    <Field label={isNew?"Password * (min 6 chars)":"New Password (leave blank to keep)"} style={{marginBottom:8}}><div style={{position:"relative"}}><input value={account.password} onChange={e=>onChange({password:e.target.value})} placeholder={isNew?"Set a password":"Leave blank to keep current"} type={showPass?"text":"password"} style={inputSt()}/><button onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:17}}>{showPass?"\u{1F648}":"\u{1F441}"}</button></div></Field>
    <div style={{fontSize:12,color:C.muted,marginBottom:18}}>Passwords are hashed before storing.</div>
    <Field label="Role" style={{marginBottom:22}}><select value={account.role} onChange={e=>onChange({role:e.target.value})} style={inputSt(true)}><option value="Admin">Admin</option><option value="Super Admin">Super Admin</option></select></Field>
    <div style={{display:"flex",justifyContent:"flex-end",gap:10}}><Btn ghost onClick={onClose}>Cancel</Btn><Btn primary onClick={onSave} disabled={invalid||saving}>{saving?"Saving\u2026":isNew?"Create Account":"Save Changes"}</Btn></div>
  </Modal>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inventory History Panel
// ═══════════════════════════════════════════════════════════════════════════════
function InventoryHistoryPanel({ adjustments }) {
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
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search item, reason, or actor" style={{...inputSt(),minWidth:280,maxWidth:"100%"}} />
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
function AuditLogPanel({ auditLogs }) {
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
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search action, actor, or summary" style={{...inputSt(),minWidth:280,maxWidth:"100%"}} />
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
