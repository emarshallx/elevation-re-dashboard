import { h, panel, kpi, badge } from "../lib/ui.js";
import { baseLayout, sectorColor, theme, SECTORS } from "../lib/theme.js";
import { plot } from "../lib/charts.js";
import { money, pct, mult, years, monthLabel, int } from "../lib/format.js";
import { createSkyline } from "../skyline.js";

export const title = "Portfolio";

const SYMBOL = { Office: "circle", Industrial: "square", Retail: "diamond", Multifamily: "triangle-up" };

export async function mount(view, ctx) {
  const [all, data] = await Promise.all([ctx.api.get("portfolio"), ctx.api.get(`portfolio?${ctx.query()}`)]);

  const sub = h("p", { class: "page-sub" });
  const head = h("header", { class: "page-head" },
    h("div", {}, h("h1", { class: "page-title" }, "Portfolio"), sub),
    ctx.filterControls());

  const skyWrap = h("div", { class: "skyline-wrap" });
  const key = h("div", { class: "skyline-key" },
    h("span", {}, "Height is appraised value, width is building size."),
    h("span", {}, h("span", { class: "k-win" }), "Lit windows are the share of space leased"),
    ...SECTORS.map(s => h("span", { html: `${roofIcon(s)}${s}` })));

  // KPI band
  const k = data.kpis;
  const tiles = {
    value: kpi("Portfolio value", k.value, v => money(v), costNote(k), 0),
    noi: kpi("NOI, trailing 12 months", k.noi_t12, v => money(v), growthNote(k), 80),
    leased: kpi("Leased, commercial", k.occupancy.commercial ?? null, v => pct(v, 1), resNote(k), 160),
    walt: kpi("Weighted lease term", k.walt, v => years(v), "Commercial, by rent", 240),
    ltv: kpi("Loan to value", k.ltv, v => pct(v, 1), dscrNote(k), 320),
    cap: kpi("Implied cap rate", k.cap_rate, v => pct(v, 2), `Debt cost ${pct(k.wtd_rate, 2)}`, 400),
  };
  const band = h("section", { class: "kpis", "aria-label": "Key figures" }, Object.values(tiles));

  const noiP = panel({ title: "Net operating income by month", sub: "Actual against the 2026 budget", chartClass: "chart tall",
    table: () => noiTable(state.data) });
  const watchList = h("ul", { class: "watch" });
  const watchP = panel({ title: "Watchlist", sub: "Debt, leasing and occupancy flags", body: watchList });
  const valueP = panel({ title: "Value by sector", sub: "Quarterly appraisals", table: () => valueTable(state.data) });
  const expP = panel({ title: "Lease expiry schedule", sub: "Commercial area expiring by year, share of total area",
    table: () => expiryTable(state.data) });
  const occP = panel({ title: "Occupancy by sector", sub: "Area- and unit-weighted, monthly", table: () => occTable(state.data) });
  const mapP = panel({ title: "Where the portfolio sits", sub: "Marker size is value", table: () => mapTable(state.data) });

  view.replaceChildren(head, skyWrap, key, band,
    h("div", { class: "grid g-21" }, noiP.root, watchP.root),
    h("div", { class: "grid g-2" }, valueP.root, expP.root),
    h("div", { class: "grid g-2" }, occP.root, mapP.root));

  const sky = createSkyline(skyWrap, all.skyline, { onSelect: id => ctx.navigate(`#/assets/${id}`) });
  sky.setFilter(ctx.state);

  const state = { data };

  function draw(d) {
    state.data = d;
    sub.textContent = `${d.kpis.count} ${d.kpis.count === 1 ? "property" : "properties"}, trailing twelve months to ${monthLabel(d.noi_series.periods.at(-1))}.`;
    drawWatch(watchList, d, ctx);
    drawNoi(noiP.chart, d);
    drawValue(valueP.chart, d);
    drawExpiry(expP.chart, d);
    drawOcc(occP.chart, d);
    drawMap(mapP.chart, d, ctx);
  }
  draw(data);

  return {
    async update(s) {
      sky.setFilter(s);
      const d = await ctx.api.get(`portfolio?${ctx.query()}`);
      if (d.empty) return;
      const kk = d.kpis;
      tiles.value.set(kk.value, costNote(kk));
      tiles.noi.set(kk.noi_t12, growthNote(kk));
      tiles.leased.set(kk.occupancy.commercial ?? null, resNote(kk));
      tiles.walt.set(kk.walt, "Commercial, by rent");
      tiles.ltv.set(kk.ltv, dscrNote(kk));
      tiles.cap.set(kk.cap_rate, `Debt cost ${pct(kk.wtd_rate, 2)}`);
      draw(d);
    },
    destroy() { sky.destroy(); },
  };
}

// ---------- notes ----------
const costNote = k => {
  const gain = k.value - k.acq_cost;
  return `<span class="${gain >= 0 ? "up" : "down"}">${gain >= 0 ? "▲" : "▼"} ${money(Math.abs(gain))}</span> vs. cost`;
};
const growthNote = k => k.noi_growth === null ? "" :
  `<span class="${k.noi_growth >= 0 ? "up" : "down"}">${k.noi_growth >= 0 ? "▲" : "▼"} ${pct(Math.abs(k.noi_growth), 1)}</span> on prior 12 months`;
const resNote = k => k.occupancy.residential !== undefined
  ? `Residential ${pct(k.occupancy.residential, 1)} of ${int(k.occupancy.residential_units)} units` : "No residential in view";
const dscrNote = k => `DSCR ${mult(k.dscr)} on ${money(k.debt)} debt`;

function roofIcon(s) {
  const c = sectorColor(s);
  const roof = {
    Office: `<path d="M5 6h6v2H5zM7.5 2h1v4h-1z" />`,
    Industrial: `<path d="M2 8l3-3v3l3-3v3l3-3v3l3-3v3z" />`,
    Retail: `<path d="M1 6h14v2H1z" />`,
    Multifamily: `<path d="M2 8l6-5 6 5z" />`,
  }[s];
  return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="var(--bldg-edge)">${roof}</g><rect x="2" y="8" width="12" height="6" fill="var(--bldg-edge)"/><rect x="1.5" y="14" width="13" height="2" fill="${c}"/></svg>`;
}

// ---------- charts ----------
function drawNoi(div, d) {
  const t = theme();
  const s = d.noi_series;
  const x = s.periods.map(p => p + "-01");
  const bx = s.budget_periods.map(p => p + "-01");
  const lastA = s.actual.at(-1);
  plot(div, [
    { type: "scatter", mode: "lines", name: "Actual", x, y: s.actual, line: { color: t.ink, width: 2 },
      hovertemplate: "%{x|%b %Y}<br>Actual %{y:$,.3s}<extra></extra>" },
    { type: "scatter", mode: "lines", name: "Budget", x: bx, y: s.budget, line: { color: t.light, width: 2, dash: "dot" },
      hovertemplate: "%{x|%b %Y}<br>Budget %{y:$,.3s}<extra></extra>" },
  ], baseLayout({
    showlegend: true, hovermode: "x unified",
    yaxis: { tickprefix: "$", tickformat: ".3s" },
    xaxis: { tickformat: "%b %Y", dtick: "M6" },
    margin: { t: 30 },
    annotations: [{ x: x.at(-1), y: lastA, text: money(lastA), showarrow: false, xanchor: "left", xshift: 6,
      font: { color: t.ink, size: 12 } }],
  }));
}

function drawValue(div, d) {
  const t = theme();
  const q = d.value_history.quarters;
  plot(div, d.value_history.series.map(s => ({
    type: "bar", name: s.sector, x: q, y: s.values,
    marker: { color: sectorColor(s.sector), line: { color: t.panel, width: 2 } },
    hovertemplate: `${s.sector}<br>%{x|%b %Y}: %{y:$,.3s}<extra></extra>`,
  })), baseLayout({
    barmode: "stack", showlegend: true, margin: { t: 30 }, bargap: 0.18,
    yaxis: { tickprefix: "$", tickformat: ".2s" }, xaxis: { tickformat: "%b<br>%Y", type: "date", dtick: "M6" },
  }));
}

function drawExpiry(div, d) {
  const t = theme();
  const e = d.expiry;
  const traces = e.series.map(s => ({
    type: "bar", name: s.sector, x: e.buckets, y: s.pct.map(v => v * 100),
    customdata: s.sf, marker: { color: sectorColor(s.sector), line: { color: t.panel, width: 2 } },
    hovertemplate: `${s.sector}, %{x}<br>%{y:.1f}% of area (%{customdata:,.0f} sf)<extra></extra>`,
  }));
  plot(div, traces, baseLayout({
    barmode: "stack", showlegend: true, margin: { t: 30 }, bargap: 0.22,
    yaxis: { ticksuffix: "%", rangemode: "tozero" }, xaxis: { type: "category" },
    annotations: [{ xref: "paper", yref: "paper", x: 1, y: 1.12, xanchor: "right", showarrow: false,
      text: `Vacant today: ${pct(e.vacant_pct, 1)}`, font: { color: t.ink2, size: 12 } }],
  }));
}

function drawOcc(div, d) {
  const t = theme();
  const traces = d.occupancy_history.map(s => ({
    type: "scatter", mode: "lines", name: s.sector, x: s.periods.map(p => p + "-01"), y: s.values.map(v => v * 100),
    line: { color: sectorColor(s.sector), width: 2 }, hovertemplate: `${s.sector} %{y:.1f}%<extra></extra>`,
  }));
  const ann = d.occupancy_history.map(s => ({
    xref: "paper", x: 1, y: s.values.at(-1) * 100, text: `${s.sector} ${(s.values.at(-1) * 100).toFixed(1)}%`,
    showarrow: false, xanchor: "left", xshift: 6, font: { color: t.ink2, size: 11 },
  }));
  plot(div, traces, baseLayout({
    showlegend: true, hovermode: "x unified", margin: { t: 30, r: 110 },
    yaxis: { ticksuffix: "%" }, xaxis: { tickformat: "%b %Y", dtick: "M6" }, annotations: ann,
  }));
}

async function drawMap(div, d, ctx) {
  const t = theme();
  const bySector = SECTORS.map(s => d.skyline.filter(p => p.sector === s)).filter(a => a.length);
  const maxV = Math.max(...d.skyline.map(p => p.value));
  const traces = bySector.map(ps => ({
    type: "scattergeo", name: ps[0].sector, lat: ps.map(p => p.lat), lon: ps.map(p => p.lon),
    text: ps.map(p => `${p.name}<br>${p.city}<br>${money(p.value)}`), customdata: ps.map(p => p.id),
    hovertemplate: "%{text}<extra></extra>",
    marker: { size: ps.map(p => 9 + 22 * Math.sqrt(p.value / maxV)), color: sectorColor(ps[0].sector),
      symbol: SYMBOL[ps[0].sector], opacity: 0.9, line: { color: t.panel, width: 2 } },
  }));
  await plot(div, traces, baseLayout({
    showlegend: true, margin: { t: 30, l: 0, r: 0, b: 0 },
    geo: {
      scope: "north america", projection: { type: "conic conformal", parallels: [33, 45], rotation: { lon: -96 } },
      lataxis: { range: [27, 56] }, lonaxis: { range: [-122, -68] },
      showland: true, landcolor: t.panel2, showocean: false, showlakes: true, lakecolor: t.panel,
      showcountries: true, countrycolor: t.lineStrong, showsubunits: true, subunitcolor: t.line,
      showcoastlines: true, coastlinecolor: t.lineStrong, bgcolor: "rgba(0,0,0,0)", framewidth: 0, showframe: false,
    },
  }), { grow: false });
  if (!div.clickBound) {
    div.on("plotly_click", ev => { const id = ev.points?.[0]?.customdata; if (id) ctx.navigate(`#/assets/${id}`); });
    div.clickBound = true;
  }
}

function drawWatch(ul, d, ctx) {
  const byProp = new Map();
  for (const f of d.watchlist) {
    if (!byProp.has(f.id)) byProp.set(f.id, { id: f.id, name: f.name, severity: f.severity, flags: [] });
    byProp.get(f.id).flags.push(f);
  }
  const label = { critical: "Act now", serious: "Watch", warning: "Monitor" };
  ul.replaceChildren(...(byProp.size ? [...byProp.values()].map(p => h("li", {},
    h("div", { class: "w-badge" }, badge(p.severity, label[p.severity])),
    h("div", { class: "w-title" }, h("button", { type: "button", onclick: () => ctx.navigate(`#/assets/${p.id}`) }, p.name)),
    h("div", { class: "w-detail" }, p.flags.map((f, i) => h("div", {}, h("span", { style: { color: "var(--ink)" } }, f.issue), `. ${f.detail}`))))) :
    [h("li", {}, h("div", {}), h("div", { class: "w-detail" }, "Nothing flagged for this selection."))]));
}

// ---------- table twins ----------
function noiTable(d) {
  const s = d.noi_series;
  const b = Object.fromEntries(s.budget_periods.map((p, i) => [p, s.budget[i]]));
  return { columns: [{ label: "Month" }, { label: "Actual", align: "r" }, { label: "Budget", align: "r" }],
    rows: s.periods.map((p, i) => [monthLabel(p), money(s.actual[i]), b[p] !== undefined ? money(b[p]) : "–"]) };
}
function valueTable(d) {
  const v = d.value_history;
  return { columns: [{ label: "Quarter end" }, ...v.series.map(s => ({ label: s.sector, align: "r" }))],
    rows: v.quarters.map((q, i) => [q, ...v.series.map(s => money(s.values[i]))]) };
}
function expiryTable(d) {
  const e = d.expiry;
  return { columns: [{ label: "Year" }, ...e.series.map(s => ({ label: `${s.sector} (sf)`, align: "r" })), { label: "Share of area", align: "r" }],
    rows: e.buckets.map((b, i) => [b, ...e.series.map(s => int(s.sf[i])), pct(e.series.reduce((a, s) => a + s.pct[i], 0), 1)]) };
}
function occTable(d) {
  const o = d.occupancy_history;
  return { columns: [{ label: "Month" }, ...o.map(s => ({ label: s.sector, align: "r" }))],
    rows: o[0].periods.map((p, i) => [monthLabel(p), ...o.map(s => pct(s.values[i], 1))]) };
}
function mapTable(d) {
  return { columns: [{ label: "Property" }, { label: "Sector" }, { label: "City" }, { label: "Value", align: "r" }],
    rows: d.skyline.map(p => [p.name, p.sector, `${p.city}, ${p.province}`, money(p.value)]) };
}
