import { normalizeStatus } from "../styles/tokens";

export function firestoreTsToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getOrderDate(order) {
  return firestoreTsToDate(order?.placedAt) || firestoreTsToDate(order?.createdAt) || firestoreTsToDate(order?.ts) || null;
}

export function getOrderDateMs(order) {
  return getOrderDate(order)?.getTime() || 0;
}

export function formatOrderDate(order, options) {
  const d = getOrderDate(order);
  return d ? d.toLocaleDateString("en-US", options) : "";
}

export function formatOrderDateTime(order) {
  const d = getOrderDate(order);
  return d ? d.toLocaleString() : "";
}
