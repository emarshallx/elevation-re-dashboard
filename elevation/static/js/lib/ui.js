// Small DOM helpers: element builder, panels with a chart/table toggle,
// count-up figures, segmented controls and the shared tooltip.
import { reducedMotion } from "./theme.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * A panel with a header, a chart slot and an optional table twin.
 * `table` is a function returning {columns:[{label, align}], rows:[[...]]}.
 */
export function panel({ title, sub, cls = "", chartClass = "chart", table = null, foot = null, body = null }) {
  const chart = h("div", { class: chartClass });
  const tableSlot = h("div", { class: "tbl-wrap", hidden: true });
  const actions = h("div", { class: "panel-actions" });
  const root = h("section", { class: `panel ${cls}` },
    h("div", { class: "panel-head" },
      h("div", {}, h("h2", { class: "panel-title" }, title), h("p", { class: "panel-sub" }, sub || "")),
      actions),
    body || chart, tableSlot, foot ? h("div", { class: "panel-foot", html: foot }) : null);
  if (table) {
    const btn = h("button", { class: "text-btn", type: "button", "aria-pressed": "false" }, "Show table");
    btn.addEventListener("click", () => {
      const showing = btn.getAttribute("aria-pressed") === "true";
      if (!showing) tableSlot.replaceChildren(renderTable(table()));
      tableSlot.hidden = showing;
      (body || chart).hidden = !showing;
      btn.setAttribute("aria-pressed", String(!showing));
      btn.textContent = showing ? "Show table" : "Show chart";
      if (showing && chart.data) window.Plotly.Plots.resize(chart);
    });
    actions.append(btn);
  }
  return { root, chart, actions };
}

export function renderTable({ columns, rows, rowClass }) {
  return h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, columns.map(c => h("th", { class: c.align === "r" ? "r" : "" }, c.label)))),
    h("tbody", {}, rows.map((r, i) => h("tr", { class: rowClass ? rowClass(i) : "" },
      r.map((cell, j) => h("td", { class: columns[j].align === "r" ? "r" : "" }, cell))))));
}

export function countUp(el, to, fmt, ms = 900, from = 0) {
  if (reducedMotion() || to === null || to === undefined || from === null) { el.textContent = fmt(to); return; }
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = fmt(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** A stat tile whose figure counts up; call `el.set(value, noteHtml)` to animate to a new value. */
export function kpi(label, value, fmt, note = null, delay = 0) {
  const v = h("div", { class: "kpi-value" }, value === null || value === undefined ? fmt(value) : fmt(0));
  const n = h("div", { class: "kpi-note", html: note || "" });
  const el = h("div", { class: "kpi" }, h("div", { class: "kpi-label" }, label), v, n);
  el.last = value;
  setTimeout(() => countUp(v, value, fmt), delay);
  el.set = (next, nextNote) => {
    countUp(v, next, fmt, 700, el.last ?? 0);
    el.last = next;
    if (nextNote !== undefined) n.innerHTML = nextNote || "";
  };
  return el;
}

export function segmented(options, value, onChange, label) {
  const wrap = h("div", { class: "seg", role: "group", "aria-label": label });
  for (const o of options) {
    const b = h("button", { type: "button", "aria-pressed": String(o.value === value) },
      o.swatch ? h("span", { class: "swatch", style: { background: o.swatch } }) : null, o.label);
    b.addEventListener("click", () => {
      wrap.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

// ---- tooltip ----
const tipEl = () => document.getElementById("tip");
export function showTip(html, x, y) {
  const tip = tipEl();
  tip.innerHTML = html;
  tip.classList.add("show");
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top < 8) top = y + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() { tipEl().classList.remove("show"); }

export function varianceCell(actual, budget, kind) {
  // kind: "revenue" (higher is favourable) or "opex" (lower is favourable)
  const diff = actual - budget;
  const pctv = budget ? diff / Math.abs(budget) : 0;
  const favourable = kind === "opex" ? diff < 0 : diff > 0;
  if (Math.abs(pctv) < 0.0005) return h("span", { class: "var flat" }, "on budget");
  const arrow = favourable ? "▲" : "▼";
  return h("span", { class: `var ${favourable ? "good" : "bad"}`, title: favourable ? "Favourable" : "Unfavourable" },
    `${arrow} ${(Math.abs(pctv) * 100).toFixed(1)}%`, h("span", { class: "sr-only" }, favourable ? " favourable" : " unfavourable"));
}

export function badge(severity, text) {
  const icon = { critical: "●", serious: "▲", warning: "◆", good: "✓" }[severity] || "●";
  return h("span", { class: `badge ${severity}` }, h("span", { "aria-hidden": "true" }, icon), text);
}

export function sourceLink(src) {
  if (!src) return "";
  return `<a href="${src.url}" target="_blank" rel="noopener">${src.name}</a>`;
}
