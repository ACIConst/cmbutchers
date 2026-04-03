import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, GLASS, GLASS_MODAL, MAX_ITEM_QTY, KIOSK_CART_IDLE_MS, EXIT_HOLD_MS, MAX_PIN_ATTEMPTS, PIN_LOCKOUT_SECS, DELIVERY_LOCATIONS } from "../../styles/tokens";
import { useIdleTimer } from "../../hooks/useIdleTimer";
import { useMenu, useUsers, useCategories, createDbOps } from "../../hooks/useFirestore";
import { Img } from "../../components/Img";
import { KioskBtn, KQtyBtn, ModeLoadingScreen } from "../../components/ui";
import { isOrderingOpen, getDeliveryDate, fmtDate } from "../../utils";
import { addDoc, updateDoc, doc, collection } from "firebase/firestore";
import { db } from "../../config/firebase";

function CutoffBanner() {
  const open = isOrderingOpen();
  const deliveryDate = getDeliveryDate();
  const formatted = fmtDate(deliveryDate);
  if (open) return <div style={{background:C.amber,color:C.amberText,textAlign:"center",padding:"10px 16px",fontSize:13,fontWeight:600,letterSpacing:1,fontFamily:F.display}}>Order by Wed 3:00 PM for this Friday's delivery</div>;
  return <div style={{background:C.red,color:C.cream,textAlign:"center",padding:"14px 16px",fontSize:17,fontWeight:700,letterSpacing:1,fontFamily:F.display}}>Orders placed now will be delivered Friday {formatted}</div>;
}

function KioskCard({ item, idx, hov, onHover, onClick }) {
  return (
    <div className={item.inStock?"touch-active":""} style={{background:C.card,border:"1px solid "+(hov&&item.inStock?C.red+"66":C.border),borderRadius:16,overflow:"hidden",cursor:item.inStock?"pointer":"default",transform:hov&&item.inStock?"translateY(-3px)":"translateY(0)",boxShadow:hov&&item.inStock?"0 12px 36px "+C.redGlow:"0 2px 12px rgba(0,0,0,.35)",transition:"all .25s ease",opacity:item.inStock?1:.5,animation:"fadeUp .3s ease "+idx*40+"ms backwards"}} onClick={onClick} onMouseEnter={()=>onHover(item.id)} onMouseLeave={()=>onHover(null)}>
      <div style={{position:"relative",height:"clamp(140px, 25vw, 190px)",overflow:"hidden"}}>
        <Img src={item.image} alt={item.name} style={{width:"100%",height:"100%",objectFit:"cover",filter:!item.inStock?"grayscale(90%) brightness(.5)":"brightness(.85)",transform:hov&&item.inStock?"scale(1.05)":"scale(1)",transition:"transform .4s ease"}}/>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(15,13,11,.8),transparent 55%)"}}/>
        <div style={{position:"absolute",top:10,right:10,background:item.inStock?"rgba(22,101,52,.85)":"rgba(69,10,10,.85)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",color:item.inStock?C.greenText:C.errorText,borderRadius:7,padding:"4px 10px",fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>{item.inStock?"\u25CF In Stock":"\u2715 Sold Out"}</div>
        {item.inStock&&item.stock!==null&&item.stock!==undefined&&item.stock<=3&&item.stock>0&&<div style={{position:"absolute",top:10,left:10,background:"rgba(146,64,14,.85)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",color:C.amberText,borderRadius:6,padding:"3px 9px",fontSize:10,fontWeight:700,letterSpacing:1}}>{item.stock} left</div>}
        <div style={{position:"absolute",bottom:8,left:8,background:"rgba(0,0,0,.5)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",color:C.muted,borderRadius:5,padding:"3px 8px",fontSize:10,letterSpacing:1,textTransform:"uppercase",fontFamily:F.display}}>{item.category}</div>
        {!item.inStock&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"rgba(0,0,0,.65)",backdropFilter:"blur(4px)",borderRadius:10,padding:"8px 20px",fontSize:12,color:C.errorText,fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>Not Available</div></div>}
      </div>
      <div style={{padding:"14px 16px 18px"}}>
        <div style={{fontFamily:F.display,fontSize:16,fontWeight:700,color:C.cream,marginBottom:5,lineHeight:1.25}}>{item.name}{item.isBundle&&<span style={{background:"#1e40af",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,marginLeft:8,letterSpacing:1,verticalAlign:"middle"}}>BUNDLE</span>}</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.55,marginBottom:12,minHeight:36}}>
          {item.isBundle && item.description && item.description.includes("|")
            ? <div style={{background:C.surface,borderRadius:8,padding:"6px 10px",border:"1px solid "+C.border}}>
                {item.description.split("|").map((part,i)=><div key={i} style={{padding:"2px 0",display:"flex",alignItems:"center",gap:6}}><span style={{color:C.red,fontSize:8}}>{"\u25CF"}</span><span>{part.trim()}</span></div>)}
              </div>
            : item.description}
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontFamily:F.display,fontSize:20,fontWeight:700,color:item.inStock?C.red:C.muted}}>${item.price.toFixed(2)}</div>
          {item.inStock&&<div style={{fontSize:11,color:hov?C.cream:C.muted,letterSpacing:1,textTransform:"uppercase",transition:"color .2s",fontFamily:F.display,fontWeight:500}}>Tap to add {"\u2192"}</div>}
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ order, onReset }) {
  const [countdown, setCountdown] = useState(30);
  useEffect(()=>{ const iv=setInterval(()=>setCountdown(c=>{if(c<=1){onReset();return 0;}return c-1;}),1000); return()=>clearInterval(iv); },[]);
  const pct = (countdown/30)*100;
  return (
    <div className="kiosk-root" style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",textAlign:"center",fontFamily:F.body,color:C.cream}}>
      <div style={{width:86,height:86,borderRadius:"50%",background:"rgba(22,101,52,.2)",border:"3px solid "+C.greenText,display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,color:C.greenText,marginBottom:26,boxShadow:"0 0 50px rgba(74,222,128,.12)",animation:"successPop .55s cubic-bezier(.175,.885,.32,1.275) forwards"}}>{"\u2713"}</div>
      <div style={{fontFamily:F.brand,fontSize:"clamp(32px, 8vw, 46px)",fontWeight:900,color:C.cream,marginBottom:4,letterSpacing:2}}>Thank You!</div>
      <div style={{fontSize:15,color:C.muted,marginBottom:4,fontFamily:F.display}}>Your order has been placed.</div>
      <div style={{fontFamily:F.display,fontSize:17,color:C.muted,letterSpacing:4,marginBottom:4,fontWeight:500}}>ORDER #{order.orderNumber||order.displayId}</div>
      <div style={{fontSize:14,color:C.mutedLight,marginBottom:4}}>Placed by <strong style={{color:C.cream}}>{order.user}</strong></div>
      <div style={{fontFamily:F.display,fontSize:34,fontWeight:700,color:C.red,marginBottom:24}}>${order.total.toFixed(2)}</div>
      <div style={{...GLASS_MODAL,borderRadius:18,padding:"16px 22px",marginBottom:24,minWidth:280,maxWidth:440,width:"100%",textAlign:"left"}}>
        {order.items.map((item,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid "+C.border,fontSize:14,color:C.muted}}><span>{item.name} {"\u00D7"} {item.quantity}</span><span style={{color:C.cream}}>${(item.price*item.quantity).toFixed(2)}</span></div>)}
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px 0 0",fontSize:16,fontWeight:700,color:C.cream}}><span>Total</span><span style={{color:C.red,fontFamily:F.display,fontSize:20}}>${order.total.toFixed(2)}</span></div>
      </div>
      <div style={{fontSize:15,color:C.muted,marginBottom:22}}>Please see the counter to pick up your order.</div>
      <KioskBtn primary large onClick={onReset}>Place Another Order</KioskBtn>
      <div style={{marginTop:20,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
        <div style={{width:180,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:C.red,width:pct+"%",transition:"width 1s linear",borderRadius:3}}/></div>
        <div style={{fontSize:13,color:C.border}}>Auto-reset in <span style={{color:C.muted,fontWeight:600}}>{countdown}s</span></div>
      </div>
    </div>
  );
}


function KioskApp({ menu, users, categories, addOrder, dbOps, onExit }) {
  const [cart,setCart]=useState([]);
  const [selected,setSelected]=useState(null);
  const [qty,setQty]=useState(1);
  const [view,setView]=useState("idle");
  // Auth state (replaces PIN)
  const [authMode,setAuthMode]=useState("choose"); // "choose", "login", "register", or "reset"
  const [authEmail,setAuthEmail]=useState("");
  const [authPass,setAuthPass]=useState("");
  const [authErr,setAuthErr]=useState("");
  const [authLoading,setAuthLoading]=useState(false);
  const [shaking,setShaking]=useState(false);
  // Registration fields
  const [regFirst,setRegFirst]=useState("");
  const [regLast,setRegLast]=useState("");
  const [regPhone,setRegPhone]=useState("");
  const [regEmail,setRegEmail]=useState("");
  const [regPass,setRegPass]=useState("");
  const [regLocation,setRegLocation]=useState(DELIVERY_LOCATIONS[0]);
  const [regErr,setRegErr]=useState("");
  const [regLoading,setRegLoading]=useState(false);
  // Reset password fields
  const [resetEmail,setResetEmail]=useState("");
  const [resetPhone,setResetPhone]=useState("");
  const [resetNewPass,setResetNewPass]=useState("");
  const [resetStep,setResetStep]=useState(1); // 1=verify, 2=new password
  const [resetErr,setResetErr]=useState("");
  const [resetLoading,setResetLoading]=useState(false);
  const [resetUserId,setResetUserId]=useState(null);
  // Show/hide password toggles
  const [showLoginPass,setShowLoginPass]=useState(false);
  const [showRegPass,setShowRegPass]=useState(false);
  const [showResetPass,setShowResetPass]=useState(false);

  const [activeCat,setActiveCat]=useState("All");
  const [orderResult,setOrderResult]=useState(null);
  const [hovered,setHovered]=useState(null);
  const [justAdded,setJustAdded]=useState(false);
  const [hideOOS,setHideOOS]=useState(false);
  const exitHoldRef=useRef(null);
  const [exitProgress,setExitProgress]=useState(0);

  const cats=["All",...categories];
  const filtered=(activeCat==="All"?menu:menu.filter(i=>i.category===activeCat)).filter(i=>i.showOnKiosk!==false).filter(i=>!hideOOS||i.inStock).sort((a,b)=>(a.menuOrder||999)-(b.menuOrder||999));
  const cartQty=cart.reduce((s,i)=>s+i.quantity,0);
  const cartTotal=cart.reduce((s,i)=>s+i.price*i.quantity,0);

  const goIdle=useCallback(()=>{if(view!=="success")reset();},[view]);
  useIdleTimer(view==="idle"?99999999:KIOSK_CART_IDLE_MS,goIdle);

  function startExitHold(){setExitProgress(1);exitHoldRef.current=setTimeout(()=>{setExitProgress(0);onExit();},EXIT_HOLD_MS);}
  function cancelExitHold(){clearTimeout(exitHoldRef.current);setExitProgress(0);}

  function addToCart(){
    const maxQty=(selected.stock!==null&&selected.stock!==undefined)?Math.min(MAX_ITEM_QTY,selected.stock):MAX_ITEM_QTY;
    setCart(prev=>{const ex=prev.find(c=>c.id===selected.id);if(ex)return prev.map(c=>c.id===selected.id?{...c,quantity:Math.min(maxQty,c.quantity+qty)}:c);return[...prev,{...selected,quantity:Math.min(maxQty,qty)}];});
    setJustAdded(true);
    setTimeout(()=>{setJustAdded(false);setSelected(null);},650);
  }

  async function decrementStock(cartItems){
    for(const cartItem of cartItems){
      if(cartItem.isBundle&&cartItem.bundleItems&&cartItem.bundleItems.length>0){
        for(const bi of cartItem.bundleItems){
          const component=menu.find(m=>m.id===bi.itemId);
          if(!component||component.stock===null||component.stock===undefined)continue;
          const newStock=Math.max(0,component.stock-(bi.quantity*cartItem.quantity));
          try{await dbOps.updateMenuItem(bi.itemId,{stock:newStock,inStock:newStock>0});}catch(e){console.error("Stock decrement failed:",e);}
        }
      }
      if(cartItem.stock!==null&&cartItem.stock!==undefined){
        const newStock=Math.max(0,cartItem.stock-cartItem.quantity);
        try{await dbOps.updateMenuItem(cartItem.id,{stock:newStock,inStock:newStock>0});}catch(e){console.error("Stock decrement failed:",e);}
      }
    }
  }

  async function handleLogin(){
    if(authLoading)return;
    if(!authEmail.trim()||!authPass){setAuthErr("Enter your email and password.");return;}
    setAuthLoading(true);setAuthErr("");
    try{
      const res=await fetch("https://us-central1-testing-and-development-f696f.cloudfunctions.net/kioskVerifyPassword",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:authEmail.trim(),password:authPass})});
      const data=await res.json();
      if(data.success){placeOrder(data.user);}
      else{setAuthErr(data.error==="Invalid credentials"?"Invalid email or password.":"Login failed. Try again.");setShaking(true);setTimeout(()=>setShaking(false),700);}
    }catch(e){console.error("Login error:",e);setAuthErr("Login failed. Try again.");}
    finally{setAuthLoading(false);}
  }

  async function handleRegister(){
    if(regLoading)return;
    if(!regFirst.trim()||!regLast.trim()){setRegErr("First and last name required.");return;}
    if(!regEmail.trim()||!regEmail.includes("@")){setRegErr("Valid email required.");return;}
    if(regPass.length<4){setRegErr("Password must be at least 4 characters.");return;}
    if(!regPhone.trim()){setRegErr("Phone number required.");return;}
    const duplicate=users.find(u=>u.email&&u.email.toLowerCase()===regEmail.trim().toLowerCase());
    if(duplicate){setRegErr("An account with this email already exists. Please log in.");return;}
    setRegLoading(true);setRegErr("");
    try{
      // Hash password server-side with bcrypt
      const hashRes=await fetch("https://us-central1-testing-and-development-f696f.cloudfunctions.net/kioskHashPassword",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:regPass})});
      const hashData=await hashRes.json();
      if(!hashData.hash)throw new Error("Hash failed");
      const newUser={firstName:regFirst.trim(),lastName:regLast.trim(),email:regEmail.trim().toLowerCase(),phone:regPhone.replace(/\D/g,""),passwordHash:hashData.hash,role:"Customer",deliveryLocation:regLocation};
      const docRef=await addDoc(collection(db,"kioskUsers"),newUser);
      placeOrder({id:docRef.id,...newUser});
    }catch(e){
      console.error(e);setRegErr("Registration failed. Try again.");
    }finally{setRegLoading(false);}
  }

  function placeOrder(user){
    const userName=(user.firstName||"")+" "+(user.lastName||"");
    const orderNum=Math.floor(Math.random()*9000+1000);
    const orderData={orderNumber:orderNum,user:userName.trim()||user.name||"Customer",userId:user.id,email:user.email||"",deliveryLocation:user.deliveryLocation||"",items:cart.map(i=>({id:i.id,name:i.name,price:i.price,quantity:i.quantity,image:i.image||"",sku:i.sku||"",barcode:i.barcode||"",barcodeImage:i.barcodeImage||"",qbItemId:i.qbItemId||""})),total:cartTotal,ts:new Date().toISOString()};
    setOrderResult({...orderData,displayId:orderNum,email:user.email||""});
    setView("success");
    addOrder(orderData).catch(e=>console.error("Order save failed:",e));
    decrementStock(cart);
  }

  function handleResetVerify(){
    if(!resetEmail.trim()||!resetPhone.trim()){setResetErr("Enter your email and phone number.");return;}
    const cleanPhone=resetPhone.replace(/\D/g,"");
    const user=users.find(u=>u.email&&u.email.toLowerCase()===resetEmail.trim().toLowerCase());
    if(!user){setResetErr("No account found with that email.");return;}
    const userPhone=(user.phone||"").replace(/\D/g,"");
    if(!userPhone||userPhone!==cleanPhone){setResetErr("Phone number doesn't match our records.");return;}
    setResetUserId(user.id);
    setResetErr("");
    setResetStep(2);
  }

  async function handleResetPassword(){
    if(resetLoading)return;
    if(resetNewPass.length<4){setResetErr("Password must be at least 4 characters.");return;}
    setResetLoading(true);setResetErr("");
    try{
      const hashRes=await fetch("https://us-central1-testing-and-development-f696f.cloudfunctions.net/kioskHashPassword",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:resetNewPass})});
      const hashData=await hashRes.json();
      if(!hashData.hash)throw new Error("Hash failed");
      await updateDoc(doc(db,"kioskUsers",resetUserId),{passwordHash:hashData.hash});
      setAuthMode("login");
      setAuthErr("");
      setAuthEmail(resetEmail);
      setAuthPass("");
      setResetEmail("");setResetPhone("");setResetNewPass("");setResetStep(1);setResetUserId(null);
      setAuthErr("Password updated! Sign in with your new password.");
    }catch(e){
      console.error(e);
      setResetErr("Failed to update password. Try again.");
    }finally{setResetLoading(false);}
  }

  function resetAuth(){setAuthMode("choose");setAuthEmail("");setAuthPass("");setAuthErr("");setRegFirst("");setRegLast("");setRegPhone("");setRegEmail("");setRegPass("");setRegLocation(DELIVERY_LOCATIONS[0]);setRegErr("");setResetEmail("");setResetPhone("");setResetNewPass("");setResetStep(1);setResetErr("");setResetUserId(null);setShowLoginPass(false);setShowRegPass(false);setShowResetPass(false);}
  function reset(){setCart([]);resetAuth();setOrderResult(null);setView("idle");setActiveCat("All");setSelected(null);}

  if(view==="idle")return(
    <div className="kiosk-root" onClick={()=>setView("menu")} style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative",overflow:"hidden",padding:"0 20px"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,"+C.red+",transparent)"}}/>
      <div style={{position:"absolute",top:"30%",left:"50%",transform:"translate(-50%,-50%)",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle, rgba(155,28,28,.08), transparent 70%)",pointerEvents:"none"}}/>
      <div style={{fontFamily:F.brand,fontSize:"clamp(36px, 10vw, 60px)",fontWeight:900,color:C.cream,letterSpacing:8,lineHeight:1,textAlign:"center"}}>CHAMP'S MEATS</div>
      <div style={{letterSpacing:9,color:C.muted,fontSize:"clamp(11px, 2.5vw, 14px)",textTransform:"uppercase",marginTop:8,marginBottom:52,fontFamily:F.display,fontWeight:500}}>Halstead, KS</div>
      <div style={{background:C.red,color:C.cream,borderRadius:16,padding:"20px clamp(28px, 8vw, 52px)",fontFamily:F.display,fontSize:"clamp(18px, 4vw, 28px)",fontWeight:700,letterSpacing:3,animation:"idlePulse 2.8s ease-in-out infinite",boxShadow:"0 8px 40px "+C.redGlow}}>TAP TO ORDER</div>
      <div style={{position:"absolute",bottom:28,fontSize:11,color:C.border,letterSpacing:3,textTransform:"uppercase",fontFamily:F.display}}>Employee Kiosk</div>
      <div onMouseDown={startExitHold} onMouseUp={cancelExitHold} onTouchStart={startExitHold} onTouchEnd={cancelExitHold} onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:0,right:0,width:60,height:60,cursor:"default"}}>
        {exitProgress>0&&<div style={{position:"absolute",bottom:8,right:8,width:44,height:44,borderRadius:"50%",border:"3px solid "+C.red+"44",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:6,height:6,borderRadius:"50%",background:C.red,animation:"pulse 0.5s infinite"}}/></div>}
      </div>
    </div>
  );

  if(view==="success"&&orderResult)return <SuccessScreen order={orderResult} onReset={reset}/>;

  return(
    <div className="kiosk-root" style={{minHeight:"100vh",background:C.bg,fontFamily:F.body,color:C.cream,display:"flex",flexDirection:"column"}}>
      <header style={{...GLASS,borderBottom:"1px solid "+C.red+"44",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50,boxShadow:"0 6px 30px rgba(0,0,0,.5)",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><img src="/Champs%20Meats.svg" alt="Champs Meats" style={{width:"140px",height:"auto",objectFit:"contain"}}/></div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {view==="cart"&&<KioskBtn ghost onClick={()=>setView("menu")}>{"\u2190"} Menu</KioskBtn>}
          {view==="checkout"&&<KioskBtn ghost onClick={()=>{setView("cart");resetAuth();}}>{"\u2190"} Cart</KioskBtn>}
          {view==="menu"&&<button onClick={()=>cartQty>0&&setView("cart")} className="touch-active" style={{background:cartQty>0?C.red:C.border,border:"none",color:C.cream,borderRadius:12,padding:"12px 20px",fontFamily:F.body,fontSize:15,fontWeight:600,cursor:cartQty>0?"pointer":"default",display:"flex",alignItems:"center",gap:8,position:"relative",transition:"background .2s",minHeight:48}}>Cart {cartQty>0?"("+cartQty+")":"Empty"}{cartQty>0&&<span style={{position:"absolute",top:-8,right:-8,background:C.cream,color:C.red,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{cartQty}</span>}</button>}
          <button className="touch-active" onClick={onExit} style={{background:"transparent",border:"1px solid "+C.border,color:C.muted,borderRadius:10,padding:"10px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,minHeight:44}}>Exit</button>
        </div>
      </header>
      <CutoffBanner/>

      {view==="menu"&&(
        <div style={{flex:1,padding:"clamp(14px, 3vw, 20px) clamp(14px, 3vw, 24px)",animation:"fadeUp .3s ease"}}>
          <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>{cats.map(cat=><button key={cat} onClick={()=>setActiveCat(cat)} className="touch-active" style={{background:activeCat===cat?C.red:"transparent",color:activeCat===cat?C.cream:C.muted,border:"1px solid "+(activeCat===cat?C.red:C.border),borderRadius:24,padding:"10px 20px",cursor:"pointer",fontFamily:F.display,fontSize:13,fontWeight:600,transition:"all .18s",minHeight:44,whiteSpace:"nowrap"}}>{cat}</button>)}</div>
            <button onClick={()=>setHideOOS(h=>!h)} className="touch-active" style={{background:hideOOS?C.surface:"transparent",border:"1px solid "+(hideOOS?C.borderMid:C.border),color:hideOOS?C.cream:C.muted,borderRadius:24,padding:"8px 16px",cursor:"pointer",fontFamily:F.display,fontSize:13,minHeight:44,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>{hideOOS?"\u2713 ":""}Hide Out of Stock</button>
          </div>
          {filtered.length===0?<div style={{textAlign:"center",padding:"80px 0",color:C.muted}}><div style={{fontSize:48,marginBottom:16,opacity:.4}}></div><div style={{fontSize:20,marginBottom:12,fontFamily:F.display}}>No items in this category</div><button onClick={()=>{setActiveCat("All");setHideOOS(false);}} className="touch-active" style={{background:C.red,border:"none",color:C.cream,borderRadius:12,padding:"14px 28px",fontFamily:F.display,fontSize:16,cursor:"pointer",marginTop:8}}>Show All Items</button></div>
          :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(100%, 280px),1fr))",gap:"clamp(12px, 2vw, 18px)"}}>{filtered.map((item,idx)=><KioskCard key={item.id} item={item} idx={idx} hov={hovered===item.id} onHover={setHovered} onClick={()=>{if(item.inStock){setSelected(item);setQty(1);}}}/>)}</div>}
        </div>
      )}

      {view==="cart"&&(
        <div style={{flex:1,display:"flex",justifyContent:"center",padding:"clamp(16px, 4vw, 28px) clamp(14px, 3vw, 24px)",animation:"fadeUp .3s ease"}}>
          <div style={{width:"100%",maxWidth:680}}>
            <div style={{fontFamily:F.display,fontSize:"clamp(24px, 5vw, 34px)",fontWeight:700,marginBottom:4,letterSpacing:1}}>Your Order</div>
            <div style={{color:C.muted,fontSize:14,marginBottom:22,fontFamily:F.display}}>Review items before checking out</div>
            {cart.length===0?<div style={{textAlign:"center",padding:"70px 0",color:C.muted}}><div style={{fontSize:52,marginBottom:16,opacity:.4}}></div><div style={{fontSize:20,marginBottom:24,fontFamily:F.display}}>Your cart is empty</div><KioskBtn primary onClick={()=>setView("menu")}>{"\u2190"} Browse Menu</KioskBtn></div>:(
              <>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:22}}>
                  {cart.map(item=><div key={item.id} style={{...GLASS_MODAL,borderRadius:14,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}><Img src={item.image} alt={item.name} style={{width:62,height:62,objectFit:"cover",borderRadius:10,flexShrink:0}}/><div style={{flex:1,minWidth:120}}><div style={{fontFamily:F.display,fontSize:16,color:C.cream,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div><div style={{fontSize:13,color:C.muted,marginTop:2}}>${item.price.toFixed(2)} each</div></div><div style={{display:"flex",alignItems:"center",gap:6,background:C.card,borderRadius:12,padding:4,border:"1px solid "+C.border}}><KQtyBtn onClick={()=>setCart(p=>p.map(c=>c.id===item.id?{...c,quantity:Math.max(1,c.quantity-1)}:c))}>{"\u2212"}</KQtyBtn><span style={{fontFamily:F.display,fontSize:18,fontWeight:700,minWidth:28,textAlign:"center",color:C.cream}}>{item.quantity}</span><KQtyBtn onClick={()=>setCart(p=>p.map(c=>c.id===item.id?{...c,quantity:Math.min(MAX_ITEM_QTY,c.quantity+1)}:c))} disabled={item.quantity>=MAX_ITEM_QTY}>+</KQtyBtn></div><div style={{fontFamily:F.display,fontSize:18,color:C.red,minWidth:68,textAlign:"right",flexShrink:0}}>${(item.price*item.quantity).toFixed(2)}</div><button onClick={()=>setCart(p=>p.filter(c=>c.id!==item.id))} className="touch-active" style={{background:C.errorBg,border:"none",color:C.errorText,cursor:"pointer",fontSize:15,width:40,height:40,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{"\u2715"}</button></div>)}
                </div>
                <div style={{...GLASS_MODAL,borderRadius:16,padding:"clamp(16px, 3vw, 22px) clamp(18px, 3vw, 26px)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:12,fontSize:15}}><span style={{color:C.muted}}>Subtotal ({cartQty} item{cartQty!==1?"s":""})</span><span style={{color:C.cream}}>${cartTotal.toFixed(2)}</span></div>
                  <div style={{height:1,background:C.border,marginBottom:14}}/>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:24}}><span style={{fontFamily:F.display,fontSize:22,color:C.cream}}>Total</span><span style={{fontFamily:F.display,fontSize:32,fontWeight:900,color:C.red}}>${cartTotal.toFixed(2)}</span></div>
                  <KioskBtn primary fullWidth large onClick={()=>setView("checkout")}>Checkout {"\u2192"}</KioskBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {view==="checkout"&&authMode==="choose"&&(
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"clamp(12px, 3vw, 24px)",animation:"fadeUp .3s ease"}}>
          <div style={{width:440,maxWidth:"95vw",textAlign:"center"}}>
            <div style={{fontFamily:F.display,fontSize:"clamp(22px, 5vw, 30px)",fontWeight:900,color:C.cream,letterSpacing:2,marginBottom:8}}>CHECKOUT</div>
            <div style={{fontSize:15,color:C.muted,marginBottom:8}}>Order total: <span style={{color:C.red,fontFamily:F.display,fontWeight:700,fontSize:22}}>${cartTotal.toFixed(2)}</span></div>
            <div style={{fontSize:13,color:C.muted,marginBottom:32}}>Sign in to your account or create a new one to place your order</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <button onClick={()=>setAuthMode("login")} className="touch-active" style={{width:"100%",background:C.red,border:"none",color:C.cream,borderRadius:14,padding:"18px 20px",fontSize:18,fontWeight:700,cursor:"pointer",fontFamily:F.display,letterSpacing:1,boxShadow:"0 8px 32px "+C.redGlow,transition:"transform .15s"}}>Sign In</button>
              <button onClick={()=>setAuthMode("register")} className="touch-active" style={{width:"100%",background:"transparent",border:"2px solid "+C.borderMid,color:C.cream,borderRadius:14,padding:"18px 20px",fontSize:18,fontWeight:700,cursor:"pointer",fontFamily:F.display,letterSpacing:1,transition:"all .15s"}}>Create New Account</button>
              <button onClick={()=>setView("cart")} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontFamily:F.body,fontSize:14,marginTop:8}}>{"\u2190"} Back to Cart</button>
            </div>
          </div>
        </div>
      )}

      {view==="checkout"&&authMode!=="choose"&&(
        <div style={{flex:1,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"clamp(12px, 3vw, 24px)",paddingTop:"clamp(16px, 4vw, 30px)",animation:"fadeUp .3s ease",overflowY:"auto"}}>
          <div style={{...GLASS_MODAL,borderRadius:"clamp(16px, 3vw, 24px)",padding:"clamp(20px, 4vw, 36px) clamp(18px, 3.5vw, 36px)",width:440,maxWidth:"95vw",boxShadow:"0 28px 80px rgba(0,0,0,.75)"}}>

            {/* LOGIN FORM */}
            {authMode==="login"&&(
              <div style={{animation:shaking?"shake .65s ease":"none"}}>
                <div style={{textAlign:"center",marginBottom:18}}>
                  <div style={{fontSize:24,marginBottom:6}}>{"\u{1F512}"}</div>
                  <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:2,color:C.cream}}>SIGN IN</div>
                  <div style={{fontSize:13,color:C.muted,marginTop:4}}>Enter your email & password to place order</div>
                </div>
                <div style={{marginBottom:12}}>
                  <input type="email" value={authEmail} onChange={e=>{setAuthEmail(e.target.value);setAuthErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Email address" autoCapitalize="none" autoComplete="off" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                </div>
                <div style={{marginBottom:14,position:"relative"}}>
                  <input type={showLoginPass?"text":"password"} value={authPass} onChange={e=>{setAuthPass(e.target.value);setAuthErr("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Password" autoComplete="off" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 44px 12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                  <button onClick={()=>setShowLoginPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:18,lineHeight:1,padding:"4px"}}>{showLoginPass?"\u{1F648}":"\u{1F441}"}</button>
                </div>
                {authErr&&<div style={{background:authErr.startsWith("Password updated")?"rgba(22,101,52,.2)":C.errorBg,color:authErr.startsWith("Password updated")?C.greenText:C.errorText,border:"1px solid "+(authErr.startsWith("Password updated")?"rgba(74,222,128,.2)":"transparent"),borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:12}}>{authErr}</div>}
                <button onClick={handleLogin} disabled={authLoading||!authEmail.trim()||!authPass} className="touch-active" style={{width:"100%",background:authEmail.trim()&&authPass?C.red:C.border,border:"none",color:C.cream,borderRadius:12,padding:"14px",fontSize:16,fontWeight:700,cursor:authEmail.trim()&&authPass?"pointer":"default",fontFamily:F.display,letterSpacing:1,opacity:authEmail.trim()&&authPass?1:.5,transition:"all .2s",minHeight:52,boxShadow:authEmail.trim()&&authPass?"0 6px 28px "+C.redGlow:"none"}}>{authLoading?"Signing in...":"Place Order"}</button>
                <div style={{marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <button onClick={()=>{setAuthMode("reset");setResetEmail(authEmail);setResetErr("");setResetStep(1);}} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontFamily:F.body,fontSize:13,textDecoration:"underline",padding:0}}>Forgot password?</button>
                  <span style={{fontSize:13,color:C.border}}>Total: <span style={{color:C.muted,fontWeight:600}}>${cartTotal.toFixed(2)}</span></span>
                </div>
                <div style={{marginTop:14,textAlign:"center"}}>
                  <button onClick={()=>{setAuthMode("choose");setAuthErr("");}} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontFamily:F.body,fontSize:13}}>{"\u2190"} Back</button>
                </div>
              </div>
            )}

            {/* RESET PASSWORD FORM */}
            {authMode==="reset"&&(
              <div>
                <div style={{textAlign:"center",marginBottom:18}}>
                  <div style={{fontSize:24,marginBottom:6}}>{"\u{1F511}"}</div>
                  <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:2,color:C.cream}}>{resetStep===1?"RESET PASSWORD":"NEW PASSWORD"}</div>
                  <div style={{fontSize:13,color:C.muted,marginTop:4}}>{resetStep===1?"Verify your email and phone number":"Set your new password"}</div>
                </div>

                {resetStep===1&&<>
                  <div style={{marginBottom:12}}>
                    <input type="email" value={resetEmail} onChange={e=>{setResetEmail(e.target.value);setResetErr("");}} placeholder="Email address" autoCapitalize="none" autoComplete="off" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <input type="tel" value={resetPhone} onChange={e=>{setResetPhone(e.target.value);setResetErr("");}} placeholder="Phone number on file" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                  </div>
                  {resetErr&&<div style={{background:C.errorBg,color:C.errorText,borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:12}}>{resetErr}</div>}
                  <button onClick={handleResetVerify} className="touch-active" style={{width:"100%",background:resetEmail.trim()&&resetPhone.trim()?C.red:C.border,border:"none",color:C.cream,borderRadius:12,padding:"14px",fontSize:16,fontWeight:700,cursor:resetEmail.trim()&&resetPhone.trim()?"pointer":"default",fontFamily:F.display,letterSpacing:1,opacity:resetEmail.trim()&&resetPhone.trim()?1:.5,transition:"all .2s",minHeight:52}}>Verify Identity</button>
                </>}

                {resetStep===2&&<>
                  <div style={{background:"rgba(22,101,52,.15)",border:"1px solid rgba(74,222,128,.2)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.greenText,textAlign:"center"}}>{"\u2713"} Identity verified. Enter your new password below.</div>
                  <div style={{marginBottom:14,position:"relative"}}>
                    <input type={showResetPass?"text":"password"} value={resetNewPass} onChange={e=>{setResetNewPass(e.target.value);setResetErr("");}} placeholder="New password (min 4 characters)" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 44px 12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                    <button onClick={()=>setShowResetPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:18,lineHeight:1,padding:"4px"}}>{showResetPass?"\u{1F648}":"\u{1F441}"}</button>
                  </div>
                  {resetErr&&<div style={{background:C.errorBg,color:C.errorText,borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:12}}>{resetErr}</div>}
                  <button onClick={handleResetPassword} disabled={resetLoading} className="touch-active" style={{width:"100%",background:resetNewPass.length>=4?C.green:C.border,border:"none",color:C.cream,borderRadius:12,padding:"14px",fontSize:16,fontWeight:700,cursor:resetNewPass.length>=4?"pointer":"default",fontFamily:F.display,letterSpacing:1,opacity:resetNewPass.length>=4?1:.5,transition:"all .2s",minHeight:52}}>{resetLoading?"Updating...":"Set New Password"}</button>
                </>}

                <div style={{marginTop:14,textAlign:"center"}}>
                  <button onClick={()=>{setAuthMode("login");setResetErr("");setResetStep(1);}} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontFamily:F.body,fontSize:13}}>{"\u2190"} Back to Sign In</button>
                </div>
              </div>
            )}

            {/* REGISTER FORM */}
            {authMode==="register"&&(
              <div>
                <div style={{textAlign:"center",marginBottom:16}}>
                  <div style={{fontSize:24,marginBottom:6}}>{"\u{1F4DD}"}</div>
                  <div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:2,color:C.cream}}>CREATE ACCOUNT</div>
                  <div style={{fontSize:13,color:C.muted,marginTop:4}}>Fill in your info to get started</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <input value={regFirst} onChange={e=>setRegFirst(e.target.value)} placeholder="First Name" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                  <input value={regLast} onChange={e=>setRegLast(e.target.value)} placeholder="Last Name" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                </div>
                <div style={{marginBottom:10}}>
                  <input type="email" value={regEmail} onChange={e=>setRegEmail(e.target.value)} placeholder="Email address" autoCapitalize="none" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                </div>
                <div style={{marginBottom:10}}>
                  <input type="tel" value={regPhone} onChange={e=>setRegPhone(e.target.value)} placeholder="Phone number" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                </div>
                <div style={{marginBottom:10,position:"relative"}}>
                  <input type={showRegPass?"text":"password"} value={regPass} onChange={e=>setRegPass(e.target.value)} placeholder="Create a password" autoComplete="new-password" style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 44px 12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}/>
                  <button onClick={()=>setShowRegPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:18,lineHeight:1,padding:"4px"}}>{showRegPass?"\u{1F648}":"\u{1F441}"}</button>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:C.muted,marginBottom:6}}>Delivery Location</div>
                  <select value={regLocation} onChange={e=>setRegLocation(e.target.value)} style={{width:"100%",background:C.card,border:"1px solid "+C.borderMid,borderRadius:10,padding:"12px 14px",color:C.cream,fontFamily:F.body,fontSize:15}}>
                    {DELIVERY_LOCATIONS.map(loc=><option key={loc} value={loc}>{loc}</option>)}
                  </select>
                </div>
                {regErr&&<div style={{background:C.errorBg,color:C.errorText,borderRadius:8,padding:"9px 14px",fontSize:13,marginBottom:12}}>{regErr}</div>}
                <button onClick={handleRegister} disabled={regLoading} className="touch-active" style={{width:"100%",background:C.red,border:"none",color:C.cream,borderRadius:12,padding:"14px",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:F.display,letterSpacing:1,minHeight:52,boxShadow:"0 6px 28px "+C.redGlow,opacity:regLoading?.6:1}}>{regLoading?"Creating account...":"Create Account & Place Order"}</button>
                <div style={{marginTop:12,fontSize:13,color:C.border,textAlign:"center"}}>Order total: <span style={{color:C.muted,fontWeight:600}}>${cartTotal.toFixed(2)}</span></div>
                <div style={{marginTop:14,textAlign:"center"}}>
                  <button onClick={()=>{setAuthMode("choose");setRegErr("");}} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontFamily:F.body,fontSize:13}}>{"\u2190"} Back</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selected&&(
        <div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16,animation:"fadeIn .2s ease"}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS_MODAL,borderRadius:20,overflow:"hidden",width:450,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 32px 80px rgba(0,0,0,.7)",animation:"scaleIn .22s ease"}}>
            <div style={{position:"relative",height:"clamp(180px, 35vw, 240px)"}}>
              <Img src={selected.image} alt={selected.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(15,13,11,.92),transparent 50%)"}}/>
              <button onClick={()=>setSelected(null)} className="touch-active" style={{position:"absolute",top:14,right:14,background:"rgba(0,0,0,.5)",backdropFilter:"blur(10px)",border:"none",color:C.cream,borderRadius:"50%",width:42,height:42,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"\u2715"}</button>
              <div style={{position:"absolute",top:14,left:14,background:"rgba(22,101,52,.85)",backdropFilter:"blur(8px)",color:C.greenText,borderRadius:7,padding:"4px 12px",fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>In Stock</div>
            </div>
            <div style={{padding:"clamp(16px, 3vw, 22px) clamp(18px, 3vw, 24px)"}}>
              <div style={{fontFamily:F.display,fontSize:"clamp(20px, 4vw, 26px)",fontWeight:700,color:C.cream,marginBottom:6}}>{selected.name}{selected.isBundle&&<span style={{background:"#1e40af",color:"#fff",fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:5,marginLeft:10,letterSpacing:1,verticalAlign:"middle"}}>BUNDLE</span>}</div>
              {selected.isBundle && selected.description && selected.description.includes("|")
                ? <div style={{background:C.card,borderRadius:10,padding:"10px 14px",marginBottom:14,border:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>Includes:</div>
                    {selected.description.split("|").map((part,i)=><div key={i} style={{padding:"3px 0",display:"flex",alignItems:"center",gap:8,fontSize:13,color:C.cream}}><span style={{color:C.red,fontSize:8}}>{"\u25CF"}</span><span>{part.trim()}</span></div>)}
                  </div>
                : <div style={{fontSize:14,color:C.muted,lineHeight:1.65,marginBottom:14}}>{selected.description}</div>}
              {selected.isBundle&&selected.bundleItems&&selected.bundleItems.length>0&&!selected.description?.includes("|")&&<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"10px 14px",marginBottom:14}}><div style={{fontSize:11,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>Includes:</div>{selected.bundleItems.map((bi,i)=>{const m=menu.find(x=>x.id===bi.itemId);return m?<div key={i} style={{fontSize:13,color:C.cream,padding:"3px 0"}}>{bi.quantity}{"\u00D7"} {m.name}</div>:null;})}</div>}
              <div style={{fontFamily:F.display,fontSize:24,fontWeight:700,color:C.red,marginBottom:20}}>${selected.price.toFixed(2)} <span style={{fontSize:13,color:C.muted,fontFamily:F.body}}>{selected.isBundle?"per bundle":"per item"}</span></div>
              {(()=>{const maxQty=(selected.stock!==null&&selected.stock!==undefined)?Math.min(MAX_ITEM_QTY,selected.stock):MAX_ITEM_QTY;return(<>
              <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:18,background:C.card,borderRadius:12,padding:5,width:"fit-content",border:"1px solid "+C.border}}><KQtyBtn large onClick={()=>setQty(q=>Math.max(1,q-1))}>{"\u2212"}</KQtyBtn><span style={{minWidth:56,textAlign:"center",fontFamily:F.display,fontSize:24,fontWeight:700,color:C.cream}}>{qty}</span><KQtyBtn large onClick={()=>setQty(q=>Math.min(maxQty,q+1))} disabled={qty>=maxQty}>+</KQtyBtn></div>
              {qty>=maxQty&&<div style={{fontSize:12,color:C.amberText,marginBottom:10}}>Only {maxQty} available</div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}><div style={{color:C.muted,fontSize:15}}>Subtotal: <span style={{color:C.cream,fontWeight:600,fontSize:18}}>${(selected.price*qty).toFixed(2)}</span></div><button onClick={addToCart} className="touch-active" style={{background:justAdded?C.green:C.red,border:"none",color:C.cream,borderRadius:12,padding:"14px 28px",fontFamily:F.display,fontSize:16,fontWeight:700,cursor:"pointer",transition:"background .3s",minHeight:52,boxShadow:"0 4px 20px "+C.redGlow}}>{justAdded?"\u2713 Added!":"Add to Cart"}</button></div>
              </>);})()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KioskView() {
  const {menu,ready:menuReady}=useMenu();
  const {users,ready:usersReady}=useUsers();
  const {categories:rawCats,ready:catsReady}=useCategories();
  const navigate=useNavigate();
  const categories=rawCats.map(c=>c.name);
  const dbOps=createDbOps(menu,categories);
  if(!menuReady||!usersReady||!catsReady)return <ModeLoadingScreen label="Loading kiosk..."/>;
  return <KioskApp menu={menu} users={users} categories={categories} addOrder={dbOps.addOrder} dbOps={dbOps} onExit={()=>navigate("/")}/>;
}
