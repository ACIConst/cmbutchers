import { useState } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { DELIVERY_LOCATIONS } from "../../styles/tokens";
import { Modal, ConfirmModal, Field, Btn } from "../../components/ui";
import { inputSt, smallBtn } from "../../components/ui-helpers";

export function UserManager({ users: allUsers, dbOps, showToast, isMobile }) {const{T:C,TF:F}=useAdminTheme();
  const ADMIN_ROLES=["super_admin","manager","Super Admin","Admin","Manager","Employee"];
  const users=allUsers.filter(u=>!u.role||!ADMIN_ROLES.includes(u.role)||u.role==="Customer");
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
