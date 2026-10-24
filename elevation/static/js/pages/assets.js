import { h, panel, kpi, renderTable, varianceCell, badge } from "../lib/ui.js";
import { baseLayout, sectorColor, theme, agingRamp } from "../lib/theme.js";
import { plot, purge } from "../lib/charts.js";
import { money, moneyFull, pct, mult, years, monthLabel, int, monthYear, dateLabel } from "../lib/format.js";
import { drawBuilding } from "../skyline.js";

export const title = "Assets";

const COLS = [
  { key: "name", label: "Property" },
  { key: "sector", label: "Sector" },
  { key: "city", label: "Location" },
  { key: "size", label: "Size", align: "r" },
  { key: "value", label: "Value", align: "r" },
  { key: "noi", label: "NOI, T12", align: "r" },
  { key: "cap_rate", label: "Cap rate", align: "r" },
  { key: "occupancy", label: "Leased", align: "r" },
  { key: "walt", label: "WALT", align: "r" },
  { key: "ltv", label: "LTV", align: "r" },
];

export async function mount(view, ctx, arg) {
  const all = await ctx.api.get("portfolio");
  let sort = { key: "value", dir: -1 };
  let selected = arg || null;

  const tableSlot = h("div", { class: "tbl-wrap", style: { maxHeight: "none" } });
  const listPanel = h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("div", {}, h("h2", { class: "panel-title" }, "Properties"),
        h("p", { class: "panel-sub" }, "Select a row to open the asset. Click a column to sort."))),
    tableSlot);
  const detail = h("div", { class: "detail" });

  view.replaceChildren(
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title" }, "Assets"),
        h("p", { class: "page-sub" }, "Property-level performance, rent rolls, receivables and debt.")),
      ctx.filterControls()),
    listPanel, detail);

  const visible = () => all.skyline.filter(p =>
    (ctx.state.region === "all" || p.country === ctx.state.region) &&
    (ctx.state.sector === "all" || p.sector === ctx.state.sector));

  function drawTable() {
    const rows = [...visible()].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      return (typeof x === "string" ? x.localeCompare(y) : (x ?? -1) - (y ?? -1)) * sort.dir;
    });
    const thead = h("thead", {}, h("tr", {}, COLS.map(c => {
      const th = h("th", { class: `sortable ${c.align === "r" ? "r" : ""}`, tabindex: "0", scope: "col",
        "aria-sort": sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
        c.label, sort.key === c.key ? (sort.dir > 0 ? " ↑" : " ↓") : "");
      const go = () => { sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : (c.align === "r" ? -1 : 1) }; drawTable(); };
      th.addEventListener("click", go);
      th.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      return th;
    })));
    const tbody = h("tbody", {}, rows.map(p => {
      const tr = h("tr", { class: `clickable ${p.id === selected ? "is-selected" : ""}`, tabindex: "0",
        "aria-selected": String(p.id === selected) },
        h("td", {}, h("span", { class: "sector-dot", style: { background: sectorColor(p.sector) } }), p.name),
        h("td", {}, p.sector),
        h("td", {}, `${p.city}, ${p.province}`),
        h("td", { class: "r" }, p.size_unit === "units" ? `${p.size} units` : `${int(p.size / 1000)}K sf`),
        h("td", { class: "r" }, money(p.value)),
        h("td", { class: "r" }, money(p.noi)),
        h("td", { class: "r" }, pct(p.cap_rate, 2)),
        h("td", { class: "r" }, pct(p.occupancy, 1)),
        h("td", { class: "r" }, p.walt ? years(p.walt) : "–"),
        h("td", { class: "r" }, pct(p.ltv, 0)));
      const open = () => ctx.navigate(`#/assets/${p.id}`);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
      return tr;
    }));
    tableSlot.replaceChildren(h("table", { class: "tbl" }, thead, tbody));
    return rows;
  }

  // persistent detail panels (charts morph between properties)
  const noiP = panel({ title: "Net operating income", sub: "Monthly actual and 2026 budget", table: () => noiTable(cur) });
  const occP = panel({ title: "Occupancy", sub: "Monthly actual and 2026 budget", table: () => occTable(cur) });
  const leaseSlot = h("div", { class: "grid g-32" });
  const ytdP = panel({ title: "Year to date against budget", sub: "", body: h("div", { class: "tbl-wrap", style: { maxHeight: "none" } }) });
  const arP = panel({ title: "Receivables aging", sub: "Open tenant balances", table: () => arTable(cur) });
  const loanBody = h("div", {});
  const loanP = panel({ title: "Debt and valuation", sub: "", body: loanBody });
  const headSlot = h("div", {});
  detail.append(headSlot, h("div", { class: "grid g-2" }, noiP.root, occP.root), leaseSlot,
    h("div", { class: "grid g-3" }, ytdP.root, arP.root, loanP.root));

  let cur = null;
  async function select(id) {
    const rows = visible();
    if (!id || !rows.some(p => p.id === id)) id = (rows.find(p => p.id === selected) || rows[0] || all.skyline[0]).id;
    selected = id;
    drawTable();
    const d = await ctx.api.get(`property/${id}`);
    cur = d;
    renderDetail(d);
  }

  function renderDetail(d) {
    const p = d.property, k = d.kpis;
    const t = theme();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 150 190");
    svg.setAttribute("class", "detail-elev");
    svg.setAttribute("aria-hidden", "true");
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "bldg");
    svg.append(g);
    const w = p.sector === "Industrial" ? 136 : p.sector === "Retail" ? 120 : p.sector === "Office" ? 76 : 92;
    const hgt = p.sector === "Office" ? 176 : p.sector === "Multifamily" ? 140 : p.sector === "Retail" ? 70 : 96;
    drawBuilding(g, { ...p, short: "" }, (150 - w) / 2, 182, w, hgt, { label: false });
    const size = p.size_unit === "units" ? `${p.size} units` : `${int(p.size)} sf`;
    headSlot.replaceChildren(h("div", { class: "detail-head" }, svg, h("div", {},
      h("h2", { class: "detail-name" }, p.name),
      h("p", { class: "detail-meta" },
        `${p.klass} ${p.sector.toLowerCase()} in ${p.submarket}, ${p.city} ${p.province}. ${size}, built ${p.year_built}. ` +
        `Acquired ${monthYear(p.acquired)} for ${money(p.acq_price)}${p.local_currency === "CAD" ? " (translated from CAD)" : ""}.`),
      h("div", { class: "mini-kpis" },
        kpi("Value", k.value, v => money(v), `<span class="${k.unrealized >= 0 ? "up" : "down"}">${k.unrealized >= 0 ? "▲" : "▼"} ${money(Math.abs(k.unrealized))}</span> vs. cost`),
        kpi("NOI, T12", k.noi_t12, v => money(v), `<span class="${k.noi_growth >= 0 ? "up" : "down"}">${k.noi_growth >= 0 ? "▲" : "▼"} ${pct(Math.abs(k.noi_growth), 1)}</span> year over year`),
        kpi("Cap rate", k.cap_rate, v => pct(v, 2)),
        kpi(p.sector === "Multifamily" ? "Occupied" : "Leased", k.occupancy, v => pct(v, 1)),
        k.walt ? kpi("WALT", k.walt, v => years(v)) : null,
        kpi("LTV", k.ltv, v => pct(v, 1), `DSCR ${mult(k.dscr)}`),
      ))));

    // NOI
    const nx = d.noi.periods.map(m => m + "-01"), bx = d.noi.budget_periods.map(m => m + "-01");
    plot(noiP.chart, [
      { type: "bar", name: "Actual", x: nx, y: d.noi.actual, marker: { color: sectorColor(p.sector), line: { color: t.panel, width: 1 } },
        hovertemplate: "%{x|%b %Y}<br>Actual %{y:$,.3s}<extra></extra>" },
      { type: "scatter", mode: "lines", name: "Budget", x: bx, y: d.noi.budget, line: { color: t.ink, width: 2, dash: "dot" },
        hovertemplate: "%{x|%b %Y}<br>Budget %{y:$,.3s}<extra></extra>" },
    ], baseLayout({ showlegend: true, margin: { t: 30 }, bargap: 0.25, yaxis: { tickprefix: "$", tickformat: ".2s" },
      xaxis: { tickformat: "%b %Y", dtick: "M6" } }));

    plot(occP.chart, [
      { type: "scatter", mode: "lines", name: "Actual", x: d.occupancy.periods.map(m => m + "-01"),
        y: d.occupancy.actual.map(v => v * 100), line: { color: sectorColor(p.sector), width: 2 },
        hovertemplate: "%{x|%b %Y}: %{y:.1f}%<extra>Actual</extra>" },
      { type: "scatter", mode: "lines", name: "Budget", x: d.occupancy.budget_periods.map(m => m + "-01"),
        y: d.occupancy.budget.map(v => v * 100), line: { color: t.ink, width: 2, dash: "dot" },
        hovertemplate: "%{x|%b %Y}: %{y:.1f}%<extra>Budget</extra>" },
    ], baseLayout({ showlegend: true, margin: { t: 30 }, yaxis: { ticksuffix: "%" }, xaxis: { tickformat: "%b %Y", dtick: "M6" } }));

    // leases or units
    leaseSlot.querySelectorAll(".chart").forEach(purge);
    if (p.sector === "Multifamily") {
      const mixP = panel({ title: "Unit mix", sub: `Trade-out: new leases ${fmtSigned(p.trade_out_new)}, renewals ${fmtSigned(p.trade_out_renewal)}`,
        body: h("div", { class: "tbl-wrap" }, renderTable({
          columns: [{ label: "Type" }, { label: "Units", align: "r" }, { label: "Occupied", align: "r" }, { label: "Avg sf", align: "r" },
            { label: "In-place rent", align: "r" }, { label: "Market rent", align: "r" }, { label: "Loss to lease", align: "r" }],
          rows: d.unit_mix.map(u => [u.unit_type, u.units, `${u.occupied} (${pct(u.occupied / u.units, 0)})`, int(u.avg_sf),
            moneyFull(u.in_place_rent), moneyFull(u.market_rent), pct((u.market_rent - u.in_place_rent) / u.market_rent, 1)]),
        })) });
      const rentP = panel({ title: "In-place against market rent", sub: "Monthly rent per unit" });
      leaseSlot.replaceChildren(mixP.root, rentP.root);
      plot(rentP.chart, [
        { type: "bar", name: "In-place", x: d.unit_mix.map(u => u.unit_type), y: d.unit_mix.map(u => u.in_place_rent),
          marker: { color: sectorColor(p.sector), line: { color: t.panel, width: 2 } }, hovertemplate: "%{x}<br>In-place %{y:$,.0f}<extra></extra>" },
        { type: "bar", name: "Market", x: d.unit_mix.map(u => u.unit_type), y: d.unit_mix.map(u => u.market_rent),
          marker: { color: t.ink3, line: { color: t.panel, width: 2 } }, hovertemplate: "%{x}<br>Market %{y:$,.0f}<extra></extra>" },
      ], baseLayout({ barmode: "group", showlegend: true, margin: { t: 30 }, yaxis: { tickprefix: "$", tickformat: ",.0f" } }));
    } else {
      const chk = d.rent_roll_check;
      const diff = chk.rent_roll_annual - chk.gl_annualized;
      const ok = Math.abs(diff) < 1;
      const rollP = panel({ title: "Rent roll", sub: `${d.rent_roll.length} leases, largest first`,
        body: h("div", {},
          h("div", { class: "tbl-wrap" }, renderTable({
            columns: [{ label: "Tenant" }, { label: "Suite" }, { label: "Area", align: "r" }, { label: "Share", align: "r" },
              { label: "Rent psf", align: "r" }, { label: "Annual rent", align: "r" }, { label: "Expires", align: "r" }],
            rows: d.rent_roll.map(r => [r.anchor ? h("strong", {}, r.tenant) : r.tenant, r.suite, `${int(r.sf)} sf`, pct(r.pct_gla, 1),
              `$${r.rent_psf.toFixed(2)}`,
              moneyFull(r.annual_rent), monthYear(r.expiry_date)]),
          })),
          h("p", { class: "check" },
            ok ? h("span", { html: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>' }) : badge("serious", "Check"),
            ok ? `Rent roll reconciles to the general ledger: ${moneyFull(chk.rent_roll_annual)} annualized base rent for ${monthLabel(chk.period)}.`
               : `Rent roll differs from the ledger by ${moneyFull(diff)} for ${monthLabel(chk.period)}.`)) });
      const expP = panel({ title: "Lease expiries", sub: "Area expiring by year", table: () => ({
        columns: [{ label: "Year" }, { label: "Area (sf)", align: "r" }, { label: "Share", align: "r" }],
        rows: d.expiry.buckets.map((b, i) => [b, int(d.expiry.series[0]?.sf[i] || 0), pct(d.expiry.series[0]?.pct[i] || 0, 1)]),
      }) });
      leaseSlot.replaceChildren(rollP.root, expP.root);
      const s = d.expiry.series[0];
      plot(expP.chart, [{ type: "bar", x: d.expiry.buckets, y: s.pct.map(v => v * 100), customdata: s.sf,
        marker: { color: sectorColor(p.sector) }, hovertemplate: "%{x}: %{y:.1f}% (%{customdata:,.0f} sf)<extra></extra>" }],
      baseLayout({ yaxis: { ticksuffix: "%" }, xaxis: { type: "category" }, margin: { t: 20 },
        annotations: [{ xref: "paper", yref: "paper", x: 1, y: 1.08, xanchor: "right", showarrow: false,
          text: `Vacant today: ${pct(d.expiry.vacant_pct, 1)}`, font: { color: t.ink2, size: 12 } }] }));
    }

    // YTD vs budget
    ytdP.root.querySelector(".panel-sub").textContent = `January to ${monthLabel(d.ytd.through)}, in thousands`;
    const ytdRows = d.ytd.rows.map(r => [r.name, thousandsFmt(r.actual), thousandsFmt(r.budget), varianceCell(r.actual, r.budget, r.kind)]);
    ytdRows.push([h("strong", {}, "Net operating income"), h("strong", {}, thousandsFmt(d.ytd.noi_actual)),
      h("strong", {}, thousandsFmt(d.ytd.noi_budget)), varianceCell(d.ytd.noi_actual, d.ytd.noi_budget, "revenue")]);
    ytdP.root.querySelector(".tbl-wrap").replaceChildren(renderTable({
      columns: [{ label: "Account" }, { label: "Actual", align: "r" }, { label: "Budget", align: "r" }, { label: "Variance", align: "r" }],
      rows: ytdRows, rowClass: i => (i === ytdRows.length - 1 ? "total" : ""),
    }));

    // AR aging
    const ramp = agingRamp();
    const buckets = [["current", "0–30 days"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"]];
    const ar = d.ar.slice().sort((a, b) => (b.d90_plus + b.d61_90) - (a.d90_plus + a.d61_90)).slice(0, 8);
    if (ar.length === 1) {
      // one ledger (residential): show the four buckets side by side
      purge(arP.chart);
      arP.chart.replaceChildren();
      plot(arP.chart, [{
        type: "bar", x: buckets.map(b => b[1]), y: buckets.map(([key]) => ar[0][key]),
        marker: { color: ramp }, text: buckets.map(([key]) => moneyFull(ar[0][key])), textposition: "outside", cliponaxis: false,
        textfont: { color: t.ink2, size: 11 }, hovertemplate: "%{x}: %{y:$,.0f}<extra></extra>",
      }], baseLayout({ margin: { t: 24 }, yaxis: { tickprefix: "$", tickformat: ".2s" }, xaxis: { type: "category" } }), { grow: false });
    } else if (ar.length) {
      if (!arP.chart.data || arP.chart.data.length !== 4) { purge(arP.chart); arP.chart.replaceChildren(); }
      plot(arP.chart, buckets.map(([key, label], i) => ({
        type: "bar", orientation: "h", name: label, y: ar.map(r => shorten(r.tenant)), x: ar.map(r => r[key]),
        customdata: ar.map(r => r.tenant),
        marker: { color: ramp[i], line: { color: t.panel, width: 2 } }, hovertemplate: `%{customdata}<br>${label}: %{x:$,.0f}<extra></extra>`,
      })), baseLayout({ barmode: "stack", showlegend: true, margin: { t: 30, l: 8 }, xaxis: { tickprefix: "$", tickformat: ".2s", showgrid: true },
        legend: { entrywidth: 58, entrywidthmode: "pixels" },
        yaxis: { autorange: "reversed", showgrid: false, tickfont: { size: 11 } } }), { grow: false });
    } else {
      purge(arP.chart);
      arP.chart.replaceChildren(h("p", { class: "empty" }, "No open balances."));
    }

    // loan & valuation
    const ln = d.loan;
    loanP.root.querySelector(".panel-sub").textContent = `${ln.lender_type} loan`;
    const vals = d.valuations;
    const valChart = h("div", { class: "chart short" });
    loanBody.querySelectorAll(".chart").forEach(purge);
    loanBody.replaceChildren(
      h("dl", { class: "loan-facts" },
        h("div", {}, h("dt", {}, "Balance"), h("dd", {}, money(ln.balance))),
        h("div", {}, h("dt", {}, "Rate"), h("dd", {}, pct(ln.rate, 2))),
        h("div", {}, h("dt", {}, "Matures"), h("dd", {}, dateLabel(ln.maturity_date))),
        h("div", {}, h("dt", {}, "Amortization"), h("dd", {}, ln.amort_years ? `${ln.amort_years} years` : "Interest only")),
        h("div", {}, h("dt", {}, "Debt service"), h("dd", {}, `${money(ln.annual_debt_service)} a year`)),
        h("div", {}, h("dt", {}, "Debt yield"), h("dd", {}, pct(k.debt_yield, 1)))),
      h("p", { class: "panel-sub", style: { margin: "14px 0 0" } }, "Appraised value by quarter"),
      valChart);
    plot(valChart, [{ type: "scatter", mode: "lines+markers", x: vals.map(v => v.quarter_end), y: vals.map(v => v.value),
      customdata: vals.map(v => v.cap_rate * 100), line: { color: sectorColor(p.sector), width: 2 }, marker: { size: 6 },
      hovertemplate: "%{x|%b %Y}<br>%{y:$,.3s} at a %{customdata:.2f}% cap<extra></extra>" }],
    baseLayout({ margin: { t: 6 }, yaxis: { tickprefix: "$", tickformat: ".2s" }, xaxis: { tickformat: "%b<br>%Y" } }));
  }

  await select(selected);

  return {
    select,
    update() { select(selected); },
    destroy() { view.querySelectorAll(".chart").forEach(purge); },
  };
}

const shorten = s => (s.length > 20 ? s.slice(0, 19) + "…" : s);
const fmtSigned = v => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const thousandsFmt = v => {
  const s = Math.round(Math.abs(v) / 1000).toLocaleString("en-US");
  return v < 0 ? `(${s})` : s;
};

function noiTable(d) {
  const b = Object.fromEntries(d.noi.budget_periods.map((m, i) => [m, d.noi.budget[i]]));
  return { columns: [{ label: "Month" }, { label: "Actual", align: "r" }, { label: "Budget", align: "r" }],
    rows: d.noi.periods.map((m, i) => [monthLabel(m), money(d.noi.actual[i]), b[m] !== undefined ? money(b[m]) : "–"]) };
}
function occTable(d) {
  return { columns: [{ label: "Month" }, { label: "Occupancy", align: "r" }],
    rows: d.occupancy.periods.map((m, i) => [monthLabel(m), pct(d.occupancy.actual[i], 1)]) };
}
function arTable(d) {
  return { columns: [{ label: "Tenant" }, { label: "0–30", align: "r" }, { label: "31–60", align: "r" }, { label: "61–90", align: "r" }, { label: "Over 90", align: "r" }],
    rows: d.ar.map(r => [r.tenant, moneyFull(r.current), moneyFull(r.d31_60), moneyFull(r.d61_90), moneyFull(r.d90_plus)]) };
}
