import { useAdminTheme } from "../../context/AdminThemeContext";
import { normalizeStatus } from "../../styles/tokens";
import { Modal, StatusBadge, Btn } from "../../components/ui";
import { openPrintWindow, escapeHtml } from "../../components/ui-helpers";

export function ReceiptModal({ order, onClose }) {const{T:C,TF:F}=useAdminTheme();
  function printReceipt() {
    const items = order.items || [];
    const safeOrderNumber = escapeHtml(order.orderNumber || "");
    const safeCustomer = escapeHtml(order.user || "Walk-in");
    const safeDate = escapeHtml(order.ts ? new Date(order.ts).toLocaleString() : "");
    const safeDelivery = order.deliveryLocation ? escapeHtml(order.deliveryLocation) : "";
    const itemRows = items.map(i => `<div class="item"><span>${escapeHtml(i.name)} x${i.quantity}</span><span>$${(i.price*i.quantity).toFixed(2)}</span></div>`).join("");
    const html = `<!DOCTYPE html><html><head><title>Receipt #${safeOrderNumber}</title><style>@page{size:80mm auto;margin:4mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:13px;color:#000;padding:8px;max-width:80mm}.header{text-align:center;border-bottom:2px dashed #000;padding-bottom:10px;margin-bottom:10px}.shop-name{font-size:18px;font-weight:900;letter-spacing:2px;text-transform:uppercase}.receipt-label{font-size:14px;font-weight:700;margin-top:4px;letter-spacing:3px}.order-num{font-size:20px;font-weight:900;margin:6px 0}.info-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}.items{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:8px 0;margin:10px 0}.item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ccc}.item:last-child{border-bottom:none}.total-row{display:flex;justify-content:space-between;font-size:16px;font-weight:900;margin-top:8px;padding-top:8px;border-top:2px solid #000}.footer{text-align:center;font-size:10px;margin-top:12px;color:#666}@media print{body{padding:0}}</style></head><body><div class="header"><div class="shop-name">Champ's Butcher Shop</div><div class="receipt-label">— RECEIPT —</div><div class="order-num">#${safeOrderNumber}</div></div><div class="info-row"><span>Customer:</span><strong>${safeCustomer}</strong></div><div class="info-row"><span>Date:</span><span>${safeDate}</span></div>${safeDelivery?`<div class="info-row"><span>Delivery:</span><span>${safeDelivery}</span></div>`:""}<div class="items">${itemRows}</div><div class="total-row"><span>TOTAL</span><span>$${(order.total||0).toFixed(2)}</span></div><div class="footer">Thank you!<br>Champ's Meats — Halstead, KS<br>Printed ${new Date().toLocaleString()}</div><script>window.onload=function(){window.print();}</script></body></html>`;
    openPrintWindow(html);
  }
  const items = order.items || [];
  return (
    <Modal t={C} title={"Receipt #"+(order.orderNumber||"")} onClose={onClose}>
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
      <div style={{display:"flex",gap:10}}><Btn t={C} ghost onClick={onClose}>Close</Btn><Btn t={C} primary onClick={printReceipt}>Print Receipt</Btn></div>
    </Modal>
  );
}
