// Number formatting shared across pages.

export function money(v, { digits = null, currency = "USD" } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const sym = currency === "CAD" ? "C$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  let out;
  if (a >= 1e9) out = (a / 1e9).toFixed(digits ?? 2) + "B";
  else if (a >= 1e6) out = (a / 1e6).toFixed(digits ?? (a >= 1e8 ? 0 : 1)) + "M";
  else if (a >= 1e3) out = (a / 1e3).toFixed(digits ?? 0) + "K";
  else out = a.toFixed(digits ?? 0);
  return sign + sym + out;
}

export function moneyFull(v, currency = "USD") {
  if (v === null || v === undefined) return "–";
  const sym = currency === "CAD" ? "C$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  const s = Math.round(Math.abs(v)).toLocaleString("en-US");
  return (v < 0 ? "−" : "") + sym + s;
}

export function thousands(v) {
  if (v === null || v === undefined) return "–";
  const s = Math.round(Math.abs(v) / 1000).toLocaleString("en-US");
  return v < 0 ? `(${s})` : s;
}

export function pct(v, digits = 1, { sign = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const s = (Math.abs(v) * 100).toFixed(digits) + "%";
  if (v < 0) return "−" + s;
  return (sign && v > 0 ? "+" : "") + s;
}

export function pp(v, digits = 1, { sign = true } = {}) {
  // value already in percent units
  if (v === null || v === undefined) return "–";
  const s = Math.abs(v).toFixed(digits) + "%";
  if (v < 0) return "−" + s;
  return (sign && v > 0 ? "+" : "") + s;
}

export function mult(v, digits = 2) {
  if (v === null || v === undefined) return "–";
  return v.toFixed(digits) + "×";
}

export function years(v) {
  if (v === null || v === undefined) return "–";
  return v.toFixed(1) + " yrs";
}

export function int(v) {
  if (v === null || v === undefined) return "–";
  return Math.round(v).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(period) {
  const [y, m] = period.split("-");
  return `${MONTHS[+m - 1]} ${y}`;
}
export function dateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export function monthYear(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
