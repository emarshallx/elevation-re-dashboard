import { h, panel, segmented, sourceLink, renderTable } from "../lib/ui.js";
import { baseLayout, theme, slotColor, reducedMotion } from "../lib/theme.js";
import { plot, purge } from "../lib/charts.js";
import { pp, dateLabel, moneyFull } from "../lib/format.js";

export const title = "Markets";

const VIEWS = {
  "North America": { lon: -97, lat: 41 },
  Europe: { lon: 14, lat: 49 },
  Atlantic: { lon: -42, lat: 44 },
};

export async function mount(view, ctx) {
  const m = await ctx.api.get("markets");
  let region = "all";

  const globeDiv = h("div", { class: "chart", style: { minHeight: "470px" } });
  const legend = h("div", { class: "globe-legend" });
  const controls = h("div", { class: "globe-controls" });
  const globeP = panel({
    title: "House prices, change over the last year",
    sub: "Drag to turn the globe. Latest headline measure per country.",
    body: h("div", { class: "globe-stage" }, globeDiv, controls, legend),
    table: () => ({
      columns: [{ label: "Country" }, { label: "Annual change", align: "r" }, { label: "Period" }, { label: "Measure" }],
      rows: [...m.house_prices.globe].sort((a, b) => b.yoy - a.yoy).map(g => [g.country, pp(g.yoy), g.period, g.measure]),
    }),
    foot: `${m.house_prices.globe_note} Sources: ${m.house_prices.globe_sources.map(sourceLink).join(", ")}.`,
  });

  const rateList = h("div", { class: "rate-list" });
  const ratesP = panel({ title: "Policy rates", sub: "Latest decisions and next meetings", body: rateList });
  const histP = panel({ title: "Policy rates since 2024", sub: m.policy_rates.history_note, table: () => rateTable(m) });
  const euP = panel({ title: m.house_prices.eu_index.label, sub: "Quarterly", table: () => euTable(m),
    foot: `${m.house_prices.eu_index.note} Source: ${sourceLink(m.house_prices.eu_index.source)}.` });
  const resBody = h("div", { class: "tbl-wrap", style: { maxHeight: "none" } });
  const resP = panel({ title: "Residential prices", sub: "Latest published level and annual change", body: resBody });
  const vacP = panel({ title: "Commercial vacancy by sector", sub: "Latest quarter or month published", table: () => vacTable(m) });
  const comBody = h("div", { class: "tbl-wrap", style: { maxHeight: "none" } });
  const comP = panel({ title: "Commercial fundamentals", sub: "Vacancy, availability and prime yields", body: comBody, cls: "stmt" });
  const capP = panel({ title: "US cap rates", sub: "CBRE survey, first half of 2026", body: factList(m.commercial.cap_rates.map(c => ({ label: c.label, value: c.value, note: c.note }))),
    foot: `Source: ${sourceLink(m.commercial.cap_rates_source)}.` });
  const eu = m.commercial.europe_investment;
  const euInvP = panel({ title: "European capital markets", sub: "Investment and prime yields", body: factList([
    { label: eu.label, value: eu.value, note: eu.note },
    ...m.commercial.rows.filter(r => r.region === "Europe").map(r => ({ label: `Prime ${r.sector === "Industrial" ? "logistics" : r.sector.toLowerCase()} yield, ${r.period}`, value: `${r.value.toFixed(1)}%`, note: r.note })),
  ]), foot: `Sources: ${sourceLink(eu.source)}, ${sourceLink(m.commercial.rows.find(r => r.region === "Europe").source)}.` });
  const fcP = panel({ title: "Price forecasts", sub: "What the forecasters expect", body: h("ul", { class: "facts" },
    m.house_prices.forecasts.map(f => h("li", {}, h("span", { class: "f-label" }, f.market), h("span", { class: "f-note", html: `${f.text} ${sourceLink(f.source)}` })))) });

  const regionSeg = segmented([{ value: "all", label: "Both regions" }, { value: "North America", label: "North America" }, { value: "Europe", label: "Europe" }],
    region, v => { region = v; drawTables(); if (v !== "all") fly(VIEWS[v]); else fly(VIEWS.Atlantic); }, "Region");

  view.replaceChildren(
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title" }, "Markets"),
        h("p", { class: "page-sub" }, `North America and Europe: house prices, commercial fundamentals and the rates behind them. Compiled ${dateLabel(m.compiled)} from the sources linked on each panel.`)),
      h("div", { class: "filters" }, regionSeg)),
    h("div", { class: "grid g-32" }, globeP.root, ratesP.root),
    h("div", { class: "grid g-2" }, histP.root, euP.root),
    resP.root,
    h("div", { class: "grid g-2" }, vacP.root, capP.root),
    comP.root,
    h("div", { class: "grid g-2" }, euInvP.root, fcP.root));

  // ---------- policy rates ----------
  rateList.replaceChildren(...m.policy_rates.current.map(r => h("div", { class: "rate" },
    h("div", {}, h("div", { class: "rate-bank" }, r.bank),
      h("div", { class: `rate-move ${r.change_bp > 0 ? "up" : "flat"}` },
        r.change_bp > 0 ? `▲ ${r.change_bp} bp on ${dateLabel(r.decision)}` : `Held on ${dateLabel(r.decision)}`)),
    h("div", { class: "rate-value" }, r.label.replace(" deposit rate", "")),
    h("div", { class: "rate-note", html: `${r.note} Next decision ${dateLabel(r.next)}. ${sourceLink(r.source)}` }))));

  // ---------- globe ----------
  const t = theme();
  const g = m.house_prices.globe;
  const scale = [[0, t.neg], [0.5, t.mid], [1, t.pos]];
  legend.innerHTML = `Annual change<div class="ramp" style="background:linear-gradient(90deg, ${t.neg}, ${t.mid}, ${t.pos})"></div><div class="ticks"><span>−18%</span><span>0</span><span>+18%</span></div>`;
  let rot = { ...VIEWS["North America"] };
  await plot(globeDiv, [{
    type: "choropleth", locations: g.map(x => x.iso3), z: g.map(x => x.yoy), zmin: -18, zmax: 18, zmid: 0,
    colorscale: scale, showscale: false, marker: { line: { color: t.panel, width: 0.6 } },
    customdata: g.map(x => [x.country, x.period, x.measure]),
    hovertemplate: "<b>%{customdata[0]}</b><br>%{z:+.1f}% over a year<br>%{customdata[1]}, %{customdata[2]}<extra></extra>",
  }], baseLayout({
    margin: { l: 0, r: 0, t: 0, b: 0 }, dragmode: "pan",
    geo: {
      projection: { type: "orthographic", rotation: { lon: rot.lon, lat: rot.lat } },
      showland: true, landcolor: t.panel2, showocean: true, oceancolor: t.page, showlakes: false,
      showcountries: true, countrycolor: t.lineStrong, countrywidth: 0.6, showcoastlines: true, coastlinecolor: t.lineStrong,
      showframe: false, bgcolor: "rgba(0,0,0,0)",
      lataxis: { showgrid: true, gridcolor: t.line, dtick: 15 }, lonaxis: { showgrid: true, gridcolor: t.line, dtick: 15 },
    },
  }), { grow: false });
  globeDiv.on("plotly_relayout", ev => {
    if (ev["geo.projection.rotation.lon"] !== undefined) rot = { lon: ev["geo.projection.rotation.lon"], lat: ev["geo.projection.rotation.lat"] ?? rot.lat };
  });

  let flying = 0;
  function fly(to, ms = 2600) {
    const id = ++flying;
    const from = { ...rot };
    let dLon = to.lon - from.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    if (reducedMotion()) {
      rot = { lon: from.lon + dLon, lat: to.lat };
      window.Plotly.relayout(globeDiv, { "geo.projection.rotation.lon": rot.lon, "geo.projection.rotation.lat": rot.lat });
      return;
    }
    const start = performance.now();
    const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    let busy = false;
    function frame(now) {
      if (id !== flying || !globeDiv.isConnected) return;
      const k = Math.min(1, (now - start) / ms);
      const e = ease(k);
      const next = { lon: from.lon + dLon * e, lat: from.lat + (to.lat - from.lat) * e };
      if (!busy) {
        busy = true;
        window.Plotly.relayout(globeDiv, { "geo.projection.rotation.lon": next.lon, "geo.projection.rotation.lat": next.lat })
          .then(() => { busy = false; });
        rot = next;
      }
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  for (const [name, v] of Object.entries(VIEWS)) {
    controls.append(h("button", { class: "text-btn", type: "button", style: { background: "var(--panel)", borderColor: "var(--line-strong)" },
      onclick: () => fly(v, 1800) }, name === "Atlantic" ? "Both" : name));
  }
  const intro = setTimeout(() => fly(VIEWS.Europe, 3400), 900);

  // ---------- rate history ----------
  const today = m.compiled;
  plot(histP.chart, m.policy_rates.history.map((s, i) => ({
    type: "scatter", mode: "lines", name: s.short, line: { shape: "hv", width: 2, color: slotColor(i) },
    x: [...s.steps.map(x => x[0]), today], y: [...s.steps.map(x => x[1]), s.steps.at(-1)[1]],
    hovertemplate: `${s.short} %{y:.2f}%<extra></extra>`,
  })), baseLayout({
    showlegend: true, hovermode: "x unified", margin: { t: 30, r: 46 },
    yaxis: { ticksuffix: "%", rangemode: "tozero" }, xaxis: { tickformat: "%b %Y", type: "date" },
    annotations: m.policy_rates.history.map((s, i) => ({ xref: "paper", x: 1, y: s.steps.at(-1)[1], text: s.short, showarrow: false,
      xanchor: "left", xshift: 6, font: { size: 11, color: theme().ink2 } })),
  }));

  // ---------- EU index ----------
  const e = m.house_prices.eu_index;
  const cut = e.quarters.indexOf(e.derived_from) - 1;
  const qx = e.quarters.map(q => { const [y, qq] = q.split("-Q"); return `${y}-${String(qq * 3 - 2).padStart(2, "0")}-01`; });
  plot(euP.chart, [
    { type: "scatter", mode: "lines", name: "Published", x: qx.slice(0, cut + 1), y: e.values.slice(0, cut + 1),
      line: { color: t.ink, width: 2 }, hovertemplate: "%{x|%Y Q%q}: %{y:.1f}<extra>Published</extra>" },
    { type: "scatter", mode: "lines+markers", name: "Derived from reported growth", x: qx.slice(cut), y: e.values.slice(cut),
      line: { color: t.ink, width: 2, dash: "dot" }, marker: { size: 6, color: t.ink }, hovertemplate: "%{x|%Y}: %{y:.1f}<extra>Derived</extra>" },
  ], baseLayout({ showlegend: true, margin: { t: 30 }, xaxis: { tickformat: "%Y", type: "date" }, yaxis: {} }));

  // ---------- vacancy dot plot ----------
  const vacRows = m.commercial.rows.filter(r => r.region !== "Europe");
  const marketsList = ["United States", "Canada", "Chicago"];
  const sectors = ["Office", "Industrial", "Multifamily", "Retail"];
  const symbols = ["circle", "square", "diamond"];
  plot(vacP.chart, marketsList.map((mk, i) => {
    const rows = vacRows.filter(r => r.market === mk);
    return {
      type: "scatter", mode: "markers", name: mk, y: rows.map(r => r.sector), x: rows.map(r => r.value),
      customdata: rows.map(r => [r.metric, r.period]),
      marker: { size: 13, color: slotColor(i), symbol: symbols[i], line: { color: t.panel, width: 2 } },
      hovertemplate: `${mk}<br>%{y} %{customdata[0]}: %{x:.1f}%<br>%{customdata[1]}<extra></extra>`,
    };
  }), baseLayout({ showlegend: true, margin: { t: 30 }, xaxis: { ticksuffix: "%", showgrid: true, rangemode: "tozero" },
    yaxis: { type: "category", categoryorder: "array", categoryarray: [...sectors].reverse(), showgrid: true } }), { grow: false });
  vacP.root.querySelector(".panel-sub").textContent = "Canada industrial is an availability rate; Canada and Chicago office are downtown.";

  // ---------- tables ----------
  function drawTables() {
    const inRegion = r => region === "all" || r.region === region;
    const hp = m.house_prices.headline.filter(inRegion);
    resBody.replaceChildren(h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, h("th", {}, "Market"), h("th", { class: "r" }, "Latest"), h("th", { class: "r" }, "Annual change"),
        h("th", {}, "Period"), h("th", {}, "Measure"), h("th", {}, "Source"))),
      h("tbody", {}, hp.map(r => h("tr", {},
        h("td", {}, h("strong", {}, r.market), r.note ? h("div", { class: "muted" }, r.note) : null),
        h("td", { class: "r" }, r.level ? moneyFull(r.level, r.currency) : "Index"),
        h("td", { class: "r" }, yoyCell(r.yoy)),
        h("td", { style: { whiteSpace: "nowrap" } }, r.period), h("td", {}, r.measure),
        h("td", { html: sourceLink(r.source) }))))));
    const cr = m.commercial.rows.filter(inRegion);
    comBody.replaceChildren(renderTable({
      columns: [{ label: "Market" }, { label: "Sector" }, { label: "Measure" }, { label: "Rate", align: "r" }, { label: "Period" }, { label: "Context" }, { label: "Source" }],
      rows: cr.map(r => [r.market, r.sector, r.metric, `${r.value.toFixed(1)}%`, r.period.replace(" ", "\u00a0"), r.note, h("span", { html: sourceLink(r.source) })]),
    }));
  }
  drawTables();

  function yoyCell(v) {
    const tt = theme();
    const w = Math.min(Math.abs(v) / 18, 1) * 60;
    return h("span", { class: "yoy-cell" },
      h("span", { class: "yoy-track", "aria-hidden": "true" },
        h("span", { class: "zero" }),
        h("span", { class: "bar", style: { width: `${w}px`, left: v >= 0 ? "60px" : `${60 - w}px`, background: v >= 0 ? tt.pos : tt.neg } })),
      h("span", { class: "num", style: { minWidth: "52px", display: "inline-block" } }, pp(v)));
  }

  return { destroy() { clearTimeout(intro); flying++; view.querySelectorAll(".chart").forEach(purge); } };
}

function factList(items) {
  return h("ul", { class: "facts" }, items.map(i => h("li", {},
    h("span", { class: "f-value" }, i.value), h("span", { class: "f-label" }, i.label), h("span", { class: "f-note" }, i.note))));
}

function rateTable(m) {
  const rows = [];
  for (const s of m.policy_rates.history) for (const [d, v] of s.steps) rows.push([s.short, dateLabel(d), `${v.toFixed(2)}%`]);
  return { columns: [{ label: "Bank" }, { label: "Effective" }, { label: "Rate", align: "r" }], rows };
}
function euTable(m) {
  const e = m.house_prices.eu_index;
  const cut = e.quarters.indexOf(e.derived_from);
  return { columns: [{ label: "Quarter" }, { label: "Index", align: "r" }, { label: "Basis" }],
    rows: e.quarters.map((q, i) => [q, e.values[i].toFixed(2), i >= cut ? "Derived" : "Published"]) };
}
function vacTable(m) {
  return { columns: [{ label: "Market" }, { label: "Sector" }, { label: "Measure" }, { label: "Rate", align: "r" }, { label: "Period" }],
    rows: m.commercial.rows.filter(r => r.region !== "Europe").map(r => [r.market, r.sector, r.metric, `${r.value.toFixed(1)}%`, r.period]) };
}
