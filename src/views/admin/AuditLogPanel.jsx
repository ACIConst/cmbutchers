import { useState } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { inputSt } from "../../components/ui-helpers";

export function AuditLogPanel({ auditLogs }) {const{T:C,TF:F}=useAdminTheme();
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
