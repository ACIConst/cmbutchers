import { useState } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { normalizeStatus } from "../../styles/tokens";

export function DeliveryPanel({ orders, dbOps, showToast, isMobile }) {const{T:C,TF:F}=useAdminTheme();
  const [savingId,setSavingId]=useState(null);
  const deliveryOrders=orders.filter(o=>!o.archived&&normalizeStatus(o.status)==="out_for_delivery");
  const locations=[...new Set(deliveryOrders.map(o=>o.deliveryLocation||"No Location"))].sort();

  // Delivered this week
  const now=new Date();const weekStart=new Date(now);weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
  const deliveredThisWeek=orders.filter(o=>{const s=normalizeStatus(o.status);if(s!=="delivered")return false;const d=o.deliveredAt?new Date(o.deliveredAt):o.archivedAt?new Date(o.archivedAt):null;return d&&d>=weekStart;});
  const deliveredLocations=[...new Set(deliveredThisWeek.map(o=>o.deliveryLocation||"No Location"))].sort();
  const weekTotal=deliveredThisWeek.reduce((s,o)=>s+(o.total||0),0);

  async function markDelivered(order){setSavingId(order.id);try{const deliveredAt=new Date().toISOString();await dbOps.updateOrder(order.id,{status:"delivered",archived:true,archivedAt:deliveredAt,deliveredAt});showToast("Delivered \u2713");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingId(null);}}
  async function markAllDelivered(loc){const locOrders=deliveryOrders.filter(o=>(o.deliveryLocation||"No Location")===loc);for(const order of locOrders){await markDelivered(order);}}

  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      {/* Pending Deliveries */}
      {deliveryOrders.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"60px",textAlign:"center",color:C.muted,marginBottom:30}}>No orders awaiting delivery</div>:(
        <>
          <div style={{fontSize:13,color:C.muted,marginBottom:18}}>{deliveryOrders.length} order{deliveryOrders.length!==1?"s":""} awaiting delivery across {locations.length} location{locations.length!==1?"s":""}</div>
          {locations.map(loc=>{const locOrders=deliveryOrders.filter(o=>(o.deliveryLocation||"No Location")===loc);const locTotal=locOrders.reduce((s,o)=>s+(o.total||0),0);return(
            <div key={loc} style={{marginBottom:24}}>
              <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><div style={{fontFamily:F.display,fontSize:18,fontWeight:900,letterSpacing:1,color:C.cream}}>{loc}</div><span style={{background:"#6b21a8",color:"#d8b4fe",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>{locOrders.length} order{locOrders.length!==1?"s":""}</span><span style={{fontSize:14,color:C.red,fontFamily:F.display,fontWeight:700}}>${locTotal.toFixed(2)}</span></div>
                <button onClick={()=>markAllDelivered(loc)} style={{background:"#6b21a8",color:"#d8b4fe",border:"1px solid #7c3aed",borderRadius:10,padding:"8px 16px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700,width:isMobile?"100%":"auto"}}>Deliver All at {loc}</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>{locOrders.map(order=>(
                <div key={order.id} style={{background:C.card,border:"1px solid "+C.borderMid,borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",justifyContent:"space-between",gap:12}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,color:C.cream,fontWeight:600}}>#{order.orderNumber||""} — {order.user||"Unknown"}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{order.items?.map(i=>i.name+" \u00D7"+i.quantity).join(", ")}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{order.ts?new Date(order.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</div></div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:isMobile?"space-between":"flex-end",gap:12}}>
                    <div style={{fontFamily:F.display,fontSize:20,fontWeight:900,color:C.red,flexShrink:0}}>${(order.total||0).toFixed(2)}</div>
                    <button onClick={()=>markDelivered(order)} disabled={savingId===order.id} style={{background:"#6b21a8",color:"#d8b4fe",border:"1px solid #7c3aed",borderRadius:10,padding:"10px 20px",cursor:savingId===order.id?"wait":"pointer",fontFamily:F.display,fontSize:14,fontWeight:900,letterSpacing:1,textTransform:"uppercase",opacity:savingId===order.id ? 0.6 : 1,whiteSpace:"nowrap"}}>{savingId===order.id?"...":"Delivered"}</button>
                  </div>
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
