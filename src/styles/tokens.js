// ─── Design tokens ────────────────────────────────────────────────────────────
export const C = {
  bg:"#0f0d0b", surface:"#1a1714", card:"#1c1917",
border:"#2e2923", borderMid:"#3d352c",
red:"#d93616",
cream:"#ffffff",
muted:"#7a5c38", mutedLight:"#9a7a58",
green:"#166534", greenText:"#4ade80",
errorBg:"#450a0a", errorText:"#f87171",
amber:"#92400e", amberText:"#fbbf24",
sidebarBg:"#0f0d0b", sidebarActive:"#1c1917",
focus:"#c0392b",
};

export const CLight = {
  bg:"#f5f3f0", surface:"#ffffff", card:"#ffffff",
  border:"#e0dbd4", borderMid:"#d0c9c0",
  red:"#d93616",
  cream:"#1a1714",
  muted:"#7a7068", mutedLight:"#5a534c",
  green:"#166534", greenText:"#15803d",
  errorBg:"#fef2f2", errorText:"#dc2626",
  amber:"#f59e0b", amberText:"#92400e",
  sidebarBg:"#ece8e2", sidebarActive:"#ffffff",
  focus:"#c0392b",
};

export const F = {
  brand:"'Playfair Display',Georgia,serif",
  display:"'DM Sans',system-ui,sans-serif",
  body:"'DM Sans',system-ui,sans-serif",
  mono:"'JetBrains Mono','Fira Code',monospace",
};

export const FONT_OPTIONS = [
  { id:"default", label:"DM Sans (Default)", body:"'DM Sans',system-ui,sans-serif", display:"'DM Sans',system-ui,sans-serif" },
  { id:"inter",   label:"Inter",             body:"'Inter',system-ui,sans-serif",    display:"'Inter',system-ui,sans-serif" },
  { id:"roboto",  label:"Roboto",            body:"'Roboto',system-ui,sans-serif",   display:"'Roboto',system-ui,sans-serif" },
  { id:"mono",    label:"JetBrains Mono",    body:"'JetBrains Mono','Fira Code',monospace", display:"'JetBrains Mono','Fira Code',monospace" },
];

// ─── Glassmorphism presets ───────────────────────────────────────────────────
export const GLASS = {
  background:"rgba(28,25,23,.72)",
  backdropFilter:"blur(24px) saturate(1.2)",
  WebkitBackdropFilter:"blur(24px) saturate(1.2)",
  border:"1px solid rgba(255,255,255,.06)",
};

export const GLASS_MODAL = {
  background:"rgba(26,23,20,.88)",
  backdropFilter:"blur(32px) saturate(1.3)",
  WebkitBackdropFilter:"blur(32px) saturate(1.3)",
  border:"1px solid rgba(255,255,255,.06)",
};

// ─── Kiosk constants ──────────────────────────────────────────────────────────
export const KIOSK_CART_IDLE_MS = 120_000;  // 2 min of inactivity → reset
export const ADMIN_SESSION_MS   = 1_800_000;// 30 min → admin auto-logout
export const MAX_PIN_ATTEMPTS   = 3;
export const PIN_LOCKOUT_SECS   = 30;
export const MAX_ITEM_QTY       = 10;
export const EXIT_HOLD_MS       = 3_000;    // hold 3 s to exit kiosk

// ─── Order statuses (7-step lifecycle) ──────────────────────────────────────
export const ORDER_STATUSES = [
  { id:"placed",           label:"Placed",            color:"#92400e", text:"#fbbf24" },
  { id:"paid",             label:"Paid",              color:"#166534", text:"#4ade80" },
  { id:"picking",          label:"Picking",           color:"#1e40af", text:"#93c5fd" },
  { id:"out_for_delivery", label:"Out for Delivery",  color:"#0e7490", text:"#67e8f9" },
  { id:"delivered",        label:"Delivered",          color:"#166534", text:"#4ade80" },
  { id:"cancelled",        label:"Cancelled",          color:"#7f1d1d", text:"#fca5a5" },
];

// Valid status transitions (forward only, no skipping)
export const VALID_TRANSITIONS = {
  placed:           ["paid"],
  paid:             ["picking"],
  picking:          ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered:        [],
};

export function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

// Normalize legacy statuses from old 4-step model
export function normalizeStatus(status) {
  if (!status) return "delivered";
  const legacy = {
    not_started: "placed",
    invoiced: "placed",
    cold_storage: "picking",
    in_progress: "picking",
    ready_for_delivery: "out_for_delivery",
    completed: "delivered",
  };
  return legacy[status] || status;
}

// ─── Delivery locations ─────────────────────────────────────────────────────
export const DELIVERY_LOCATIONS = ["Sand Plant", "North Office", "The Plant"];

// ─── Seed data ──────────────────────────────────────────────────────────────
export const SEED_MENU = [
  { name:"Ribeye Steak",      description:"12oz USDA Prime, heavily marbled for unmatched richness",  price:24.99, category:"Steaks",  inStock:true,  image:"https://images.unsplash.com/photo-1558030006-450675393462?w=500&q=80" },
  { name:"New York Strip",    description:"10oz dry-aged strip with bold, beefy character",           price:22.99, category:"Steaks",  inStock:true,  image:"https://images.unsplash.com/photo-1600891964092-4316c288032e?w=500&q=80" },
  { name:"Filet Mignon",      description:"6oz center-cut tenderloin, butter-soft texture",           price:34.99, category:"Steaks",  inStock:true,  image:"https://images.unsplash.com/photo-1546964124-0cce460f38ef?w=500&q=80" },
  { name:"Baby Back Ribs",    description:"Full rack, fall-off-the-bone tender, house-rubbed",        price:28.99, category:"Pork",    inStock:true,  image:"https://images.unsplash.com/photo-1544025162-d76538a0e4b5?w=500&q=80" },
  { name:"Pork Chops",        description:"Bone-in thick cut, heritage breed, 2-pack",               price:14.99, category:"Pork",    inStock:false, image:"https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=500&q=80" },
  { name:"Ground Beef 80/20", description:"Perfect blend for burgers & meatballs, 1 lb",             price:7.99,  category:"Ground",  inStock:true,  image:"https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=500&q=80" },
  { name:"Chicken Breast",    description:"Air-chilled, boneless skinless, 2-pack",                  price:11.99, category:"Poultry", inStock:true,  image:"https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=500&q=80" },
  { name:"Lamb Rack",         description:"French-cut 8-bone rack, premium grass-fed",               price:42.99, category:"Lamb",    inStock:false, image:"https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=500&q=80" },
  { name:"Italian Sausage",   description:"House-made sweet links, 4-pack, natural casing",          price:9.99,  category:"Sausage", inStock:true,  image:"https://images.unsplash.com/photo-1618898909019-010e4e234c55?w=500&q=80" },
  { name:"Smoked Brisket",    description:"16-hour oak-smoked, sliced to order, 1 lb",               price:18.99, category:"Smoked",  inStock:true,  image:"https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=500&q=80" },
  { name:"Whole Chicken",     description:"Free-range, air-chilled, ready to roast",                 price:15.99, category:"Poultry", inStock:true,  image:"https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=500&q=80" },
  { name:"Breakfast Sausage", description:"House-made maple & sage links, 8-pack",                   price:8.49,  category:"Sausage", inStock:false, image:"https://images.unsplash.com/photo-1551248429-40975aa4de74?w=500&q=80" },
];

export const SEED_USERS = import.meta.env.DEV ? [
  { firstName:"John", lastName:"Smith", phone:"3165551234", email:"john@example.com", passwordHash:"a1b2c3d4_champs_bk", role:"Employee", deliveryLocation:"North Office" },
  { firstName:"Maria", lastName:"Garcia", phone:"3165555678", email:"maria@example.com", passwordHash:"e5f6g7h8_champs_bk", role:"Employee", deliveryLocation:"Sand Plant" },
] : [];

export const SEED_CATEGORIES = [
  { name:"Steaks",  sortOrder:1 },
  { name:"Pork",    sortOrder:2 },
  { name:"Ground",  sortOrder:3 },
  { name:"Poultry", sortOrder:4 },
  { name:"Sausage", sortOrder:5 },
  { name:"Smoked",  sortOrder:6 },
  { name:"Lamb",    sortOrder:7 },
  { name:"Other",   sortOrder:8 },
];
