import { useState, useRef, useEffect } from "react";
import { useAdminTheme } from "../../context/AdminThemeContext";
import { ORDER_STATUSES, normalizeStatus } from "../../styles/tokens";
import { StatusBadge, ConfirmModal, Btn } from "../../components/ui";
import {
  inputSt,
  openPrintWindow,
  escapeHtml,
  escapeAttribute,
  toJsStringLiteral,
} from "../../components/ui-helpers";
import { Img } from "../../components/Img";
import { CF_BASE } from "../../config/firebase";

function printPickTicket(order, menu, shopName = "Champ's Butcher Shop"){
    const items=order.items||[];const orderNum=String(order.orderNumber||"0000");
    const safeShopName=escapeHtml(shopName);const safeOrderNumber=escapeHtml(order.orderNumber||"");const safeCustomer=escapeHtml(order.user||"Walk-in");const safeLocation=escapeHtml(order.deliveryLocation||"N/A");const safeDate=escapeHtml(order.ts?new Date(order.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):"");
    let itemsHtml="";let bcIdx=0;
    items.forEach((i)=>{
      const mi=(menu||[]).find(m=>m.name===i.name);const isBundle=mi&&mi.isBundle;const subs=(isBundle&&mi.bundleItems)||[];
      let h='<tr class="item-row"><td class="cb-col"><div class="cb"></div></td>';
      h+='<td class="qty-col">'+i.quantity+'</td>';
      h+='<td class="name-col"><div class="item-name">'+escapeHtml(i.name)+(isBundle?' <span class="bundle-tag">BUNDLE</span>':'')+'</div>';
      if(i.sku)h+='<div class="item-sku">SKU: '+escapeHtml(i.sku)+'</div>';
      if(i.barcodeImage)h+='<div class="item-bc"><img src="'+escapeAttribute(i.barcodeImage)+'" /></div>';
      else if(i.sku){h+='<div class="item-bc"><svg id="item-bc-'+bcIdx+'"></svg></div>';bcIdx++;}
      if(subs.length>0){h+='<div class="bundle-contents"><div class="bundle-hdr">Bundle contains:</div>';subs.forEach(b=>{const si=(menu||[]).find(m=>m.id===b.itemId);if(si){h+='<div class="sub-item"><span class="sub-name">'+escapeHtml(si.name)+'</span><span class="sub-qty"> x'+(b.quantity*i.quantity)+'</span></div>';if(si.sku)h+='<div class="sub-sku">SKU: '+escapeHtml(si.sku)+'</div>';}});h+='</div>';}
      h+='</td></tr>';
      itemsHtml+=h;
    });
    const skuBcJs=items.map((i,idx)=>{if(i.sku&&!i.barcodeImage){const id=items.slice(0,idx).filter(x=>x.sku&&!x.barcodeImage).length;return`try{JsBarcode("#item-bc-${id}",${toJsStringLiteral(i.sku)},{format:"CODE128",width:1.6,height:30,displayValue:false,margin:0});}catch(e){console.warn("Barcode render failed:",e);}`;}return'';}).filter(Boolean).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pick Ticket #${safeOrderNumber}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
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
<div class="shop-name">${safeShopName}</div>
<div class="shop-sub">Halstead, KS</div>
<div class="ticket-label">Pick Ticket</div>
<div class="order-num">#${safeOrderNumber}</div>
<div class="order-barcode"><svg id="order-bc"></svg></div>
</div>
<div class="info">
<div class="info-item"><div class="info-label">Customer</div><div class="info-value">${safeCustomer}</div></div>
<div class="info-item"><div class="info-label">Location</div><div class="info-value">${safeLocation}</div></div>
<div class="info-item"><div class="info-label">Date</div><div class="info-value">${safeDate}</div></div>
<div class="info-item"><div class="info-label">Order Total</div><div class="info-value">$${(order.total||0).toFixed(2)}</div></div>
</div>
<table><thead><tr><th></th><th>Qty</th><th>Item</th></tr></thead><tbody>${itemsHtml}</tbody></table>
<div class="summary"><div class="summary-count">${items.reduce((s,i)=>s+i.quantity,0)} total items &middot; ${items.length} line${items.length!==1?"s":""}</div></div>
<div class="footer">Printed ${new Date().toLocaleString()}</div>
</div>
<script>window.onload=function(){try{JsBarcode("#order-bc",${toJsStringLiteral(orderNum)},{format:"CODE128",width:2.2,height:50,displayValue:false,margin:0});}catch(e){console.warn("Barcode render failed:",e);}${skuBcJs}window.print();};</script>
</body></html>`;
    openPrintWindow(html);
  }

function OrderBarcode({value,small}){
  const{theme}=useAdminTheme();
  const svgRef=useRef(null);
  useEffect(()=>{if(!svgRef.current||!value)return;const smallColor=theme==="light"?"#4a4540":"#e8dcc8";const opts={format:"CODE128",width:small?1.5:3,height:small?40:120,displayValue:true,fontSize:small?12:20,background:"transparent",lineColor:small?smallColor:"#000",textColor:small?smallColor:"#000",margin:small?4:10};const render=()=>{try{window.JsBarcode(svgRef.current,String(value),opts);}catch(e){console.error(e);}};if(!window.JsBarcode){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";s.onload=render;document.head.appendChild(s);}else{render();};},[theme, value, small]);
  return <svg ref={svgRef}/>;
}

export function OrderHistory({ orders, menu, dbOps, showToast, shopName }) {const{T:C,TF:F}=useAdminTheme();
  const [search,setSearch]=useState("");const [expanded,setExpanded]=useState(null);const [confirmClear,setConfirmClear]=useState(false);const [view,setView]=useState("active");const [statusFilter,setStatusFilter]=useState("all");const [savingStatus,setSavingStatus]=useState(null);const [customerFilter,setCustomerFilter]=useState("all");const [scanBarcode,setScanBarcode]=useState(null);const [confirmCancel,setConfirmCancel]=useState(null);const [sendingInvoice,setSendingInvoice]=useState(null);const [retryingSync,setRetryingSync]=useState(null);
  const [selectMode,setSelectMode]=useState(false);const [selected,setSelected]=useState(new Set());const [bulkSaving,setBulkSaving]=useState(false);
  const QB_SEND_URL=`${CF_BASE}/qbSendInvoice`;const QB_RETRY_URL=`${CF_BASE}/qbRetrySyncOrder`;
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
    printPickTicket(order,menu,shopName);
    if(getStatus(order)==="paid"){setSavingStatus(order.id);try{await dbOps.updateOrder(order.id,{status:"picking"});showToast("Status \u2192 Picking");}catch(e){console.error(e);showToast("Status update failed","error");}finally{setSavingStatus(null);}}
  }
  async function toggleItemChecked(order,itemIndex){const checked=[...(order.checkedItems||[])];const pos=checked.indexOf(itemIndex);if(pos===-1)checked.push(itemIndex);else checked.splice(pos,1);try{await dbOps.updateOrder(order.id,{checkedItems:checked});}catch(e){console.error(e);}}
  async function completeOrder(orderId){setSavingStatus(orderId);try{const archivedAt=new Date().toISOString();await dbOps.updateOrder(orderId,{status:terminalStatus,archived:true,archivedAt,deliveredAt:archivedAt});showToast("Order completed");if(expanded===orderId)setExpanded(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function restoreOrder(orderId){setSavingStatus(orderId);try{await dbOps.updateOrder(orderId,{status:"picking",archived:false,archivedAt:null,checkedItems:[]});showToast("Order restored");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function cancelOrder(id){setSavingStatus(id);try{await dbOps.updateOrder(id,{status:"cancelled",cancelledAt:new Date().toISOString(),cancelledBy:"admin"});showToast("Order cancelled");setConfirmCancel(null);if(expanded===id)setExpanded(null);}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function restoreCancelled(id){setSavingStatus(id);try{await dbOps.updateOrder(id,{status:"placed",cancelledAt:null,cancelledBy:null});showToast("Order restored");}catch(e){console.error(e);showToast("Failed","error");}finally{setSavingStatus(null);}}
  async function handleClearAll(){try{await dbOps.clearOrders();showToast("Orders archived");setConfirmClear(false);setView("active");}catch(e){console.error(e);showToast("Failed","error");}}
  async function handleSendInvoice(order){setSendingInvoice(order.id);try{const res=await fetch(QB_SEND_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id})});const data=await res.json();if(data.success)showToast("Invoice sent to customer");else showToast(data.error||"Failed to send","error");}catch(e){console.error(e);showToast("Failed to send invoice","error");}finally{setSendingInvoice(null);}}
  async function handleRetrySync(order){setRetryingSync(order.id);try{const res=await fetch(QB_RETRY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id})});const data=await res.json();if(!data.success)showToast(data.error||"Retry failed","error");}catch(e){console.error(e);showToast("Retry failed","error");}finally{setRetryingSync(null);}}
  function toggleSelect(id){setSelected(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function toggleSelectAll(){if(selected.size===filtered.length)setSelected(new Set());else setSelected(new Set(filtered.map(o=>o.id)));}
  async function bulkAction(action){setBulkSaving(true);try{for(const id of selected){if(action==="paid")await dbOps.updateOrder(id,{status:"paid"});else if(action==="archive")await completeOrder(id);}showToast(`${selected.size} order(s) updated`);setSelected(new Set());setSelectMode(false);}catch(e){console.error(e);showToast("Bulk action failed","error");}finally{setBulkSaving(false);}}
  return(
    <div style={{animation:"fadeUp .3s ease"}}>
      <div style={{display:"flex",gap:4,marginBottom:16,background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:4,width:"fit-content"}}>{[{id:"active",label:"Active ("+active.length+")"},{id:"cancelled",label:"Cancelled ("+cancelled.length+")",color:C.errorBg,activeColor:C.errorText},{id:"archived",label:"Archived ("+archived.length+")"}].map(t=><button key={t.id} onClick={()=>{setView(t.id);setExpanded(null);setSearch("");setStatusFilter("all");setCustomerFilter("all");setSelectMode(false);setSelected(new Set());}} style={{background:view===t.id?(t.color||C.red):"transparent",border:"none",color:view===t.id?(t.activeColor||C.cream):C.muted,borderRadius:8,padding:"8px 18px",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600,transition:"all .15s"}}>{t.label}</button>)}</div>
      {view==="active"&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setStatusFilter("all")} style={{background:statusFilter==="all"?C.surface:"transparent",border:"1px solid "+(statusFilter==="all"?C.borderMid:C.border),color:statusFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({active.length})</button>{ORDER_STATUSES.filter(s=>s.id!==terminalStatus).map(s=><button key={s.id} onClick={()=>setStatusFilter(s.id)} style={{background:statusFilter===s.id?s.color:"transparent",color:statusFilter===s.id?s.text:C.muted,border:"1px solid "+(statusFilter===s.id?s.color:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:statusFilter===s.id?700:400}}>{s.label} ({counts[s.id]||0})</button>)}</div>}
      {view==="archived"&&archivedCustomers.length>0&&<div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}><button onClick={()=>setCustomerFilter("all")} style={{background:customerFilter==="all"?C.surface:"transparent",border:"1px solid "+(customerFilter==="all"?C.borderMid:C.border),color:customerFilter==="all"?C.cream:C.muted,borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13}}>All ({archived.length})</button>{archivedCustomers.map(name=>{const count=archived.filter(o=>o.user===name).length;return<button key={name} onClick={()=>setCustomerFilter(name)} style={{background:customerFilter===name?C.red:"transparent",color:customerFilter===name?C.cream:C.muted,border:"1px solid "+(customerFilter===name?C.red:C.border),borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:customerFilter===name?700:400}}>{name} ({count})</button>;})}</div>}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...inputSt(false,C),flex:1,minWidth:200}}/><div style={{fontSize:13,color:C.muted}}>{filtered.length} order{filtered.length!==1?"s":""} {"\u00B7"} <span style={{color:C.red,fontFamily:F.display,fontSize:16}}>${totalRev.toFixed(2)}</span></div>{view==="active"&&active.length>0&&<><button onClick={()=>{setSelectMode(m=>!m);setSelected(new Set());}} style={{background:selectMode?C.surface:"transparent",border:"1px solid "+(selectMode?C.borderMid:C.border),color:selectMode?C.cream:C.muted,borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600}}>{selectMode?"Cancel":"Select"}</button>{selectMode&&selected.size>0&&!bulkSaving&&<><button onClick={()=>bulkAction("paid")} style={{background:"#1e3a5f",border:"1px solid #3b82f6",color:"#93c5fd",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Mark Paid ({selected.size})</button><button onClick={()=>bulkAction("archive")} style={{background:C.amber,border:"1px solid "+C.amber,color:"#1c1400",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Archive ({selected.size})</button></>}{bulkSaving&&<span style={{fontSize:13,color:C.muted}}>Processing...</span>}<button onClick={()=>setConfirmClear(true)} style={{background:C.amber,border:"1px solid "+C.amber,color:"#1c1400",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:700}}>Archive All</button></>}</div>
      {selectMode&&view==="active"&&<div style={{marginBottom:8}}><label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.muted}}><input type="checkbox" checked={selected.size===filtered.length&&filtered.length>0} onChange={toggleSelectAll} style={{accentColor:C.red,width:18,height:18}}/>Select All ({filtered.length})</label></div>}
      {filtered.length===0?<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"60px",textAlign:"center",color:C.muted}}>{view==="archived"?"No archived orders":view==="cancelled"?"No cancelled orders":"No orders match your filters"}</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{filtered.map(order=>{const isExpanded=expanded===order.id;const checkedItems=order.checkedItems||[];const totalItems=order.items?.length||0;const allChecked=totalItems>0&&checkedItems.length===totalItems;const curStatus=getStatus(order);const orderCancelled=curStatus==="cancelled";return(
          <div key={order.id} style={{background:orderCancelled?"rgba(69,10,10,.15)":selected.has(order.id)?"rgba(127,29,29,.12)":C.card,border:"2px solid "+(orderCancelled?C.red+"44":selected.has(order.id)?C.red+"66":isExpanded?C.borderMid:C.border),borderRadius:12,overflow:"hidden",transition:"border .2s, background .2s",opacity:orderCancelled?.75:1}}>
            <div style={{padding:"12px 16px"}}><div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              {selectMode&&!orderCancelled&&<input type="checkbox" checked={selected.has(order.id)} onChange={()=>toggleSelect(order.id)} style={{accentColor:C.red,width:20,height:20,flexShrink:0,cursor:"pointer"}}/>}
              <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>selectMode&&!orderCancelled?toggleSelect(order.id):setExpanded(isExpanded?null:order.id)}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:C.muted,fontSize:16,display:"inline-block",transform:isExpanded?"rotate(90deg)":"none",transition:"transform .2s"}}>{"\u203A"}</span><div><div style={{fontSize:14,color:orderCancelled?C.errorText:C.cream,fontWeight:600,textDecoration:orderCancelled?"line-through":"none"}}>{order.user} <span style={{fontFamily:F.mono,fontSize:12,color:C.muted,textDecoration:"none",display:"inline-block"}}>#{order.orderNumber||"\u2014"}</span></div><div style={{fontSize:12,color:C.muted}}>{order.ts?new Date(order.ts).toLocaleString():""}</div>{orderCancelled&&<div style={{fontSize:11,color:C.errorText,marginTop:2}}>Cancelled{order.cancelledBy?" by "+order.cancelledBy:""}{order.cancelledAt?" \u00B7 "+new Date(order.cancelledAt).toLocaleString():""}</div>}</div></div></div>
              {!order.archived&&!orderCancelled&&totalItems>0&&<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:allChecked?C.greenText:C.red,width:(checkedItems.length/totalItems)*100+"%",borderRadius:3,transition:"width .3s"}}/></div><span style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{checkedItems.length}/{totalItems}</span></div>}
              <div style={{fontFamily:F.display,fontSize:16,color:orderCancelled?C.muted:C.red,fontWeight:700,flexShrink:0,textDecoration:orderCancelled?"line-through":"none"}}>${(order.total||0).toFixed(2)}</div>
              {orderCancelled&&<div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>CANCELLED</span><button disabled={savingStatus===order.id} onClick={()=>restoreCancelled(order.id)} style={{background:C.amber,color:"#1c1400",border:"1px solid "+C.amber,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"Restore"}</button></div>}
              {!order.archived&&!orderCancelled&&<div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}>
                <StatusBadge status={curStatus}/>
                {curStatus==="placed"&&!order.qbInvoiceSent&&(order.qbSyncError?<div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{color:"#fca5a5",fontSize:11,fontWeight:600,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={order.qbSyncError}>Sync failed</span><button disabled={retryingSync===order.id} onClick={()=>handleRetrySync(order)} style={{background:"#3b0a0a",color:"#fca5a5",border:"1px solid #dc2626",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{retryingSync===order.id?"Retrying...":"Retry"}</button></div>:!order.qbInvoiceId?<span style={{color:C.muted,fontSize:11,fontStyle:"italic",whiteSpace:"nowrap"}}>Syncing…</span>:<button disabled={sendingInvoice===order.id} onClick={()=>handleSendInvoice(order)} style={{background:"#1a3a2a",color:"#7ee8a8",border:"1px solid #2CA01C",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{sendingInvoice===order.id?"Sending...":"Send Invoice"}</button>)}
                {curStatus==="placed"&&order.qbInvoiceSent&&<span style={{background:"#0b3d1a",color:"#4ade80",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700}}>Invoice Sent</span>}
                {curStatus==="placed"&&order.qbInvoiceSent&&<button disabled={savingStatus===order.id} onClick={()=>{if(!order.qbPaid)setStatus(order.id,"paid");}} style={{background:order.qbPaid?"#166534":"#7f1d1d",color:order.qbPaid?"#4ade80":"#fca5a5",border:"1px solid "+(order.qbPaid?"#22c55e":"#dc2626"),borderRadius:6,padding:"4px 10px",cursor:order.qbPaid?"default":"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{order.qbPaid?"Paid":"Unpaid"}</button>}
                {(curStatus==="placed"||curStatus==="paid")&&<button disabled={savingStatus===order.id} onClick={()=>printAndPick(order)} style={{background:"#1e3a5f",color:"#93c5fd",border:"1px solid #3b82f6",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>Pick Ticket</button>}
                {order.qbInvoiceSent&&(curStatus==="placed"||curStatus==="paid"||curStatus==="picking")&&<button disabled={savingStatus===order.id} onClick={()=>setStatus(order.id,"out_for_delivery")} style={{background:"#0e4a5c",color:"#67e8f9",border:"1px solid #22d3ee",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>Delivery</button>}
                {curStatus!==terminalStatus&&<button onClick={()=>setConfirmCancel(order.id)} style={{background:C.errorBg,color:C.errorText,border:"1px solid "+C.errorText,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:14,lineHeight:1,fontWeight:700}} title="Cancel order">{"\u{1F5D1}"}</button>}
              </div>}
              {order.archived&&<div style={{display:"flex",gap:6,alignItems:"center"}}><StatusBadge status={getStatus(order)}/><button disabled={savingStatus===order.id} onClick={()=>restoreOrder(order.id)} style={{background:C.amber,color:"#1c1400",border:"1px solid "+C.amber,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{savingStatus===order.id?"...":"Restore"}</button></div>}
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
