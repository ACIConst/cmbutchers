import { C as C_DARK, F as F_DARK } from "../../styles/tokens";

export function AccessDenied({ email, onLogout, onExit }) {
  const C=C_DARK,F=F_DARK;
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:F.body,color:C.cream,padding:40}}>
      <img src="/Champs%20Meats.svg" alt="Champs Meats" style={{height:"60px",width:"auto",objectFit:"contain",marginBottom:14}}/>
      <div style={{fontFamily:F.display,fontSize:26,fontWeight:900,letterSpacing:4,color:C.cream,marginBottom:4}}>ACCESS DENIED</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:32}}>Your account does not have admin access</div>
      <div style={{background:C.surface,border:"1px solid "+C.borderMid,borderRadius:18,padding:"34px 36px",width:420,maxWidth:"95vw",animation:"scaleIn .3s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)",textAlign:"center"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:C.errorBg,border:"2px solid "+C.errorText,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 18px"}}>&#x1F6AB;</div>
        <div style={{fontSize:15,color:C.cream,marginBottom:6}}>Signed in as</div>
        <div style={{fontFamily:F.mono,fontSize:14,color:C.muted,marginBottom:20,wordBreak:"break-all"}}>{email || "unknown"}</div>
        <div style={{background:C.errorBg,border:"1px solid "+C.red,borderRadius:10,padding:"12px 16px",fontSize:13,color:C.errorText,marginBottom:24,lineHeight:1.5}}>This account is not assigned an approved <strong>Admin</strong>, <strong>Manager</strong>, or <strong>Super Admin</strong> role. Contact an administrator to request access.</div>
        <button onClick={onLogout} style={{width:"100%",background:C.red,border:"none",color:C.cream,borderRadius:10,padding:"14px",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:F.body,marginBottom:10}}>Sign Out &amp; Try Another Account</button>
        <button onClick={onExit} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",width:"100%",fontFamily:F.body,fontSize:14,padding:"8px 0"}}>{"\u2190"} Back to Mode Select</button>
      </div>
    </div>
  );
}
