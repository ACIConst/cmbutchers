import { useState } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { inputSt } from "../../components/ui-helpers";

export function InventoryHistoryPanel({ adjustments }) {const{T:C,TF:F}=useAdminTheme();
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
