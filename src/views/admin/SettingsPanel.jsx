import { useState, useRef, useEffect } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { FONT_OPTIONS, DELIVERY_LOCATIONS } from "../../styles/tokens";
import { Modal, ConfirmModal, Field, Btn, inputSt, smallBtn } from "../../components/ui";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, CF_BASE } from "../../config/firebase";

const storage = getStorage();

export function SettingsPanel({ showToast, adminAccounts, dbOps, currentAdmin, isSuperAdmin, categories }) {
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

function compressImage(file, maxWidth = 280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      // Try WebP first, fall back to PNG
      const webpUrl = canvas.toDataURL("image/webp", 0.85);
      const ext = webpUrl.startsWith("data:image/webp") ? "webp" : "png";
      const quality = ext === "webp" ? 0.85 : undefined;
      canvas.toBlob(blob => blob ? resolve({ blob, ext }) : reject(new Error("Compression failed")), "image/" + ext, quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("Failed to load image")); };
    img.src = URL.createObjectURL(file);
  });
}

function SettingsAppearance({C,F,theme,setTheme,fontId,setFontId,logoUrl,setLogoUrl,showToast,cardSt,secTitle}){
  const [uploading,setUploading]=useState(false);const fileRef=useRef(null);
  async function handleLogoUpload(e){const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("image/")){showToast("Please select an image file","error");return;}if(file.size>2*1024*1024){showToast("Logo must be under 2 MB","error");return;}setUploading(true);try{const{blob,ext}=await compressImage(file);const storageRef=ref(storage,"company-config/logo-"+Date.now()+"."+ext);await uploadBytes(storageRef,blob);const url=await getDownloadURL(storageRef);await setLogoUrl(url);showToast("Logo uploaded");}catch(err){console.error(err);showToast("Upload failed","error");}finally{setUploading(false);if(fileRef.current)fileRef.current.value="";}}
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
  const blank={name:"",email:"",password:"",role:"Admin"};
  const [editing,setEditing]=useState(null);const [isNew,setIsNew]=useState(false);const [confirmDel,setConfirmDel]=useState(null);const [saving,setSaving]=useState(false);
  const ROLES=isSuperAdmin?["Employee","Manager","Admin","Super Admin"]:["Employee","Manager","Admin"];
  const emailRe=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  async function saveStaff(staff){if(saving)return;if(!staff.name.trim()||!staff.email.trim()){showToast("Name and email required","error");return;}if(!emailRe.test(staff.email.trim())){showToast("Enter a valid email address","error");return;}if(isNew&&staff.password.length<8){showToast("Password must be at least 8 characters","error");return;}if(!isNew&&staff.password&&staff.password.length<8){showToast("Password must be at least 8 characters","error");return;}const taken=adminAccounts.find(a=>a.email&&a.email.toLowerCase()===staff.email.trim().toLowerCase()&&a.id!==staff.id);if(taken){showToast("Email already in use","error");return;}if(!isSuperAdmin&&staff.role==="Super Admin"){showToast("Only Super Admins can assign that role","error");return;}setSaving(true);try{if(isNew){await dbOps.addAdminAccount(staff);showToast("Staff member added");}else{await dbOps.updateAdminAccount(staff.id,staff);showToast("Staff member updated");}setEditing(null);}catch(e){console.error(e);showToast(e.message||"Failed","error");}finally{setSaving(false);}}
  async function deleteStaff(id){if(id===currentAdmin?.id){showToast("Cannot delete your own account","error");setConfirmDel(null);return;}const target=adminAccounts.find(a=>a.id===id);if(!isSuperAdmin&&target?.role==="Super Admin"){showToast("Cannot remove a Super Admin","error");setConfirmDel(null);return;}try{await dbOps.deleteAdminAccount(id);showToast("Staff member removed");setConfirmDel(null);}catch(e){console.error(e);showToast(e.message||"Failed","error");}}
  const rc={"Super Admin":{bg:C.red,text:"#fff"},"Admin":{bg:C.amber,text:C.amberText},"Manager":{bg:"#1e40af",text:"#93c5fd"},"Employee":{bg:C.surface,text:C.muted}};
  return(
    <div style={{maxWidth:700}}>
      <div style={cardSt}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={secTitle}>Staff Accounts ({adminAccounts.length})</div>
          <Btn t={C} primary onClick={()=>{setEditing({...blank});setIsNew(true);}}>+ Add Staff</Btn>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Staff accounts can sign into the admin panel. Role determines what they can access.</div>
        <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 120px 1fr 100px",borderBottom:"1px solid "+C.border,padding:"9px 16px"}}>{["Name","Role","Email",""].map(h=><div key={h||"act"} style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:C.muted}}>{h}</div>)}</div>
          {adminAccounts.length===0?<div style={{padding:"30px",textAlign:"center",color:C.muted}}>No staff accounts</div>:adminAccounts.map(staff=>{const isMe=staff.id===currentAdmin?.id;const isSA=staff.role==="Super Admin";const canEdit=isSuperAdmin||!isSA;const col=rc[staff.role]||rc["Employee"];return(
            <div key={staff.id} className="row-hover" style={{display:"grid",gridTemplateColumns:"1fr 120px 1fr 100px",borderBottom:"1px solid "+C.border,padding:"12px 16px",alignItems:"center",transition:"background .15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:30,height:30,borderRadius:"50%",background:C.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff",flexShrink:0}}>{(staff.name||"?").charAt(0).toUpperCase()}</div><div><div style={{fontSize:14,color:C.cream,fontWeight:600}}>{staff.name}{isMe&&<span style={{fontSize:11,color:C.muted,marginLeft:6}}>(you)</span>}</div></div></div>
              <div><span style={{background:col.bg,color:col.text,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>{staff.role}</span></div>
              <div style={{fontSize:13,color:C.mutedLight,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{staff.email||"—"}</div>
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
  const [showPass,setShowPass]=useState(false);const invalid=!account.name.trim()||!account.email.trim()||(isNew&&account.password.length<8);
  const cantPromote=!isSuperAdmin&&account.role==="Super Admin";
  return(<Modal t={C} title={isNew?"Add Staff Member":"Edit Staff Member"} onClose={onClose}>
    <Field t={C} label="Full Name *" style={{marginBottom:14}}><input value={account.name} onChange={e=>onChange({name:e.target.value})} placeholder="e.g. Frank Acevedo" style={inputSt(false,C)}/></Field>
    <Field t={C} label="Email *" style={{marginBottom:14}}><input value={account.email} type="email" onChange={e=>onChange({email:e.target.value.trim()})} placeholder="e.g. frank@champsbutcher.com" style={inputSt(false,C)}/></Field>
    <Field t={C} label={isNew?"Password * (min 8 chars)":"New Password (leave blank to keep)"} style={{marginBottom:8}}><div style={{position:"relative"}}><input value={account.password} onChange={e=>onChange({password:e.target.value})} placeholder={isNew?"Set a password":"Leave blank to keep current"} type={showPass?"text":"password"} style={inputSt(false,C)}/><button onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:17}}>{showPass?"\u{1F648}":"\u{1F441}"}</button></div></Field>
    <div style={{fontSize:12,color:C.muted,marginBottom:18}}>This creates a Firebase login account for the staff member.</div>
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
  const QB_BASE=CF_BASE;
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
