// Get current week's Monday as ISO date string (used as weekOf key)
export function getWeekOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

// Get the next Friday delivery date based on a reference date
export function getDeliveryDate(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  // If we're past Wednesday cutoff, delivery is next Friday
  const isPastCutoff = !isOrderingOpen(date);
  let daysUntilFriday = (5 - day + 7) % 7;
  if (daysUntilFriday === 0 && isPastCutoff) daysUntilFriday = 7;
  if (isPastCutoff && daysUntilFriday <= 2) daysUntilFriday += 7;
  d.setDate(d.getDate() + daysUntilFriday);
  return d.toISOString().split("T")[0];
}

// Is ordering currently open for THIS Friday's delivery?
// Open until Wednesday 3:00 PM, then orders go to NEXT Friday.
export function isOrderingOpen(date) {
  const now = date ? new Date(date) : new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  // Open: Sunday(0) through Tuesday(2)
  if (day >= 0 && day <= 2) return true;
  // Wednesday: open until 3 PM
  if (day === 3 && now.getHours() < 15) return true;
  // After Wed 3 PM through Saturday: next Friday
  return false;
}

// Format currency
export function fmt$(n) {
  return "$" + Number(n).toFixed(2);
}

// Format date nicely
export function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

// Generate a random invoice token
export function genToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
