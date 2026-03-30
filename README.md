# Champs Butcher — Final Merged Build

Test build merging the best from all three versions into our production codebase.

## What Changed vs. Production

### NEW: `src/lib/api/` — Audit-Logged Write Layer
Every Firestore write now automatically logs to an `auditLogs` collection
with before/after snapshots, actor info, and timestamps.

### NEW: `src/components/ErrorBoundary.jsx`
React error boundary — catches render crashes, shows styled recovery screen.

### NEW: Two Admin Tabs (Super Admin only)
- **Inventory History** — searchable table of all stock adjustments
- **Audit Log** — searchable feed of every action across the app

### MODIFIED: `src/hooks/useFirestore.js`
`createDbOps()` now delegates through the audit-logged API layer.

### MODIFIED: `src/App.jsx`
Wrapped with ErrorBoundary.

## All Admin Sidebar Tabs
1. Dashboard  2. Menu Items  3. Categories  4. Employees
5. Orders  6. Order Board  7. Delivery  8. Admin Accounts (SA)
9. Inventory History (SA)  10. Audit Log (SA)

## How to Test
1. Unzip, `npm install`, `npm run dev`
2. Log in as Super Admin — see new tabs
3. Make any edit — check Firestore for `auditLogs` documents
