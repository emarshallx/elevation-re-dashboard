import { h, panel, kpi, renderTable, varianceCell } from "../lib/ui.js";
import { baseLayout, theme, agingRamp } from "../lib/theme.js";
import { plot, purge } from "../lib/charts.js";
import { money, moneyFull, pct, mult, years, monthLabel, dateLabel } from "../lib/format.js";

export const title = "Financials";

const K = v => {
  const s = Math.round(Math.abs(v) / 1000).toLocaleString("en-US");
  return v < 0 ? `(${s})` : s;
};

export async function mount(view, ctx) {
  let d = await ctx.api.get(`financials?${ctx.query()}`);

  const sub = h("p", { class: "page-sub" });
  const head = h("header", { class: "page-head" },
    h("div", {}, h("h1", { class: "page-title" }, "Financials"), sub), ctx.filterControls());

  const tiles = makeTiles(d);
  const band = h("section", { class: "kpis", "aria-label": "Key figures" }, Object.values(tiles));

  const stmtBody = h("div", { class: "tbl-wrap", style: { maxHeight: "none" } });
  const stmtP = panel({ title: "Operating statement", sub: "", body: stmtBody, cls: "stmt" });
  const bridgeP = panel({ title: "What moved NOI", sub: "", chartClass: "chart tall", table: () => bridgeTable(d) });
  const monthP = panel({ title: "Monthly NOI against budget", sub: "", table: () => monthTable(d) });
  const ffoP = panel({ title: "From NOI to AFFO", sub: "Trailing twelve months", table: () => ffoTable(d) });
  const ladderP = panel({ title: "Debt maturities", sub: "Loan balances by maturity year", table: () => ladderTable(d) });
  const arP = panel({ title: "Receivables aging", sub: "Open balances by property", table: () => arTable(d) });
  const loansBody = h("div", { class: "tbl-wrap", style: { maxHeight: "none" } });
  const loansP = panel({ title: "Loans", sub: "Sorted by maturity", body: loansBody });
  const topBody = h("div", { class: "tbl-wrap" });
  const topP = panel({ title: "Largest delinquent balances", sub: "Over 60 days first", body: topBody });
  const opexP = panel({ title: "Operating expense mix", sub: "Trailing twelve months", table: () => opexTable(d) });

  view.replaceChildren(head, band,
    stmtP.root,
    h("div", { class: "grid g-2" }, bridgeP.root, ffoP.root),
    h("div", { class: "grid g-2" }, monthP.root, ladderP.root),
    h("div", { class: "grid g-2" }, arP.root, opexP.root),
    loansP.root,
    topP.root);

  function draw() {
    const t = theme();
    const per = d.period;
    sub.textContent = `Year to date through ${monthLabel(per.ytd_through)} against the ${per.fy} budget. Bridge and FFO use the twelve months to ${monthLabel(per.t12_end)}.`;
    stmtP.root.querySelector(".panel-sub").textContent = `Year to date, in thousands of dollars`;
    stmtBody.replaceChildren(statementTable(d));

    // bridge (waterfall)
    const b = d.bridge;
    const steps = b.steps.filter(s => Math.abs(s.delta) >= 1000);
    bridgeP.root.querySelector(".panel-sub").textContent = `Trailing twelve months, ${monthLabel(b.start_label.split(" ")[1])} to ${monthLabel(b.end_label.split(" ")[1])}`;
    plot(bridgeP.chart, [{
      type: "waterfall", orientation: "h",
      measure: ["absolute", ...steps.map(() => "relative"), "total"],
      y: ["Prior 12 months", ...steps.map(s => s.label), "Latest 12 months"],
      x: [b.start, ...steps.map(s => s.delta), b.end],
      text: [money(b.start), ...steps.map(s => (s.delta >= 0 ? "+" : "−") + money(Math.abs(s.delta))), money(b.end)],
      textposition: "outside", textfont: { color: t.ink2, size: 11 }, cliponaxis: false,
      connector: { line: { color: t.lineStrong, width: 1 } },
      increasing: { marker: { color: t.good } }, decreasing: { marker: { color: t.critical } },
      totals: { marker: { color: t.ink3 } },
      hovertemplate: "%{y}: %{text}<extra></extra>",
    }], baseLayout({
      margin: { l: 8, r: 60, t: 6 }, xaxis: { tickprefix: "$", tickformat: ".2s", showgrid: true,
        range: waterfallRange(b, steps) },
      yaxis: { autorange: "reversed", showgrid: false, tickfont: { size: 11.5, color: t.ink2 } },
    }), { grow: false });

    // monthly
    monthP.root.querySelector(".panel-sub").textContent = `${per.fy} year to date`;
    const mx = d.monthly.periods.map(m => m + "-01");
    plot(monthP.chart, [
      { type: "bar", name: "Actual", x: mx, y: d.monthly.actual, marker: { color: t.ink3, line: { color: t.panel, width: 2 } },
        hovertemplate: "%{x|%b %Y}<br>Actual %{y:$,.3s}<extra></extra>" },
      { type: "scatter", mode: "lines+markers", name: "Budget", x: mx, y: d.monthly.budget, line: { color: t.light, width: 2 },
        marker: { size: 7, color: t.light, line: { color: t.panel, width: 2 } }, hovertemplate: "%{x|%b %Y}<br>Budget %{y:$,.3s}<extra></extra>" },
    ], baseLayout({ showlegend: true, margin: { t: 30 }, yaxis: { tickprefix: "$", tickformat: ".2s", rangemode: "tozero" },
      xaxis: { tickformat: "%b", dtick: "M1" } }));

    // FFO bridge
    const f = d.ffo.steps;
    plot(ffoP.chart, [{
      type: "waterfall", measure: f.map(s => s.kind), x: f.map(s => s.label.replace(" ", "<br>")), y: f.map(s => s.value),
      text: f.map(s => money(s.value)), textposition: "outside", textfont: { color: t.ink2, size: 11 }, cliponaxis: false,
      connector: { line: { color: t.lineStrong, width: 1 } },
      increasing: { marker: { color: t.good } }, decreasing: { marker: { color: t.critical } }, totals: { marker: { color: t.ink3 } },
      hovertemplate: "%{x}: %{text}<extra></extra>",
    }], baseLayout({ margin: { t: 24 }, yaxis: { tickprefix: "$", tickformat: ".2s" }, xaxis: { tickfont: { size: 11 } } }), { grow: false });
    ffoP.root.querySelector(".panel-sub").textContent = `Trailing twelve months. ${d.ffo.ga_note}; straight-line rent assumed at 1.5% of commercial base rent.`;

    // ladder
    const lad = d.debt.ladder;
    ladderP.root.querySelector(".panel-sub").textContent =
      `Balances by maturity year; the next two years are highlighted. Weighted rate ${pct(d.debt.kpis.wtd_rate, 2)}, remaining term ${years(d.debt.kpis.wtd_term)}.`;
    plot(ladderP.chart, [{
      type: "bar", x: lad.map(l => String(l.year)), y: lad.map(l => l.balance),
      text: lad.map(l => (l.balance ? money(l.balance) : "")), textposition: "outside", cliponaxis: false,
      textfont: { color: t.ink2, size: 11 },
      customdata: lad.map(l => l.loans.join("<br>") || "None"),
      marker: { color: lad.map(l => (l.year <= per.fy + 1 ? t.serious : t.ink3)) },
      hovertemplate: "%{x}: %{y:$,.3s}<br>%{customdata}<extra></extra>",
    }], baseLayout({ margin: { t: 24 }, yaxis: { tickprefix: "$", tickformat: ".2s" }, xaxis: { type: "category" } }));

    // AR
    const ramp = agingRamp();
    const bp = d.receivables.by_property.slice(0, 10);
    const buckets = [["current", "0–30 days"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"]];
    plot(arP.chart, buckets.map(([k, label], i) => ({
      type: "bar", orientation: "h", name: label, y: bp.map(r => r.name), x: bp.map(r => r[k]),
      marker: { color: ramp[i], line: { color: t.panel, width: 2 } }, hovertemplate: `%{y}<br>${label}: %{x:$,.0f}<extra></extra>`,
    })), baseLayout({ barmode: "stack", showlegend: true, margin: { t: 30 }, xaxis: { tickprefix: "$", tickformat: ".2s", showgrid: true },
      legend: { entrywidth: 64, entrywidthmode: "pixels" }, yaxis: { autorange: "reversed", showgrid: false } }));
    arP.root.querySelector(".panel-sub").textContent =
      `${money(d.receivables.total)} open, ${pct(d.receivables.totals.d90_plus / d.receivables.total, 0)} over 90 days`;

    loansBody.replaceChildren(renderTable({
      columns: [{ label: "Property" }, { label: "Lender" }, { label: "Balance", align: "r" }, { label: "Rate", align: "r" },
        { label: "Amortization", align: "r" }, { label: "Matures", align: "r" }, { label: "LTV", align: "r" }, { label: "DSCR", align: "r" }],
      rows: d.debt.loans.map(l => [l.name, l.lender_type, money(l.balance), pct(l.rate, 2), l.amort_years ? `${l.amort_years} yrs` : "Interest only",
        dateLabel(l.maturity_date), pct(l.ltv, 0), mult(l.dscr)]),
    }));

    topBody.replaceChildren(renderTable({
      columns: [{ label: "Tenant" }, { label: "Property" }, { label: "0–30", align: "r" }, { label: "31–60", align: "r" },
        { label: "61–90", align: "r" }, { label: "Over 90", align: "r" }, { label: "Total", align: "r" }],
      rows: d.receivables.top.map(r => [r.tenant, r.name, moneyFull(r.current), moneyFull(r.d31_60), moneyFull(r.d61_90), moneyFull(r.d90_plus), moneyFull(r.total)]),
    }));

    const om = d.opex_mix.slice().reverse();
    plot(opexP.chart, [{ type: "bar", orientation: "h", y: om.map(o => o.name), x: om.map(o => o.amount),
      marker: { color: t.ink3 }, text: om.map(o => money(o.amount)), textposition: "outside", cliponaxis: false,
      textfont: { color: t.ink2, size: 11 }, hovertemplate: "%{y}: %{x:$,.3s}<extra></extra>" }],
    baseLayout({ margin: { t: 6, r: 50 }, xaxis: { tickprefix: "$", tickformat: ".2s", showgrid: true }, yaxis: { showgrid: false } }));
  }
  draw();

  return {
    async update() {
      const next = await ctx.api.get(`financials?${ctx.query()}`);
      if (next.empty) return;
      d = next;
      updateTiles(tiles, d);
      draw();
    },
    destroy() { view.querySelectorAll(".chart").forEach(purge); },
  };
}

function find(d, key) { return d.statement.find(r => r.key === key); }

function makeTiles(d) {
  const noi = find(d, "NOI");
  const f = d.ffo.steps;
  return {
    ytd: kpi("NOI, year to date", noi.actual, v => money(v), varNote(noi.actual, noi.budget, "budget")),
    fcst: kpi(`Forecast NOI, ${d.period.fy}`, noi.forecast, v => money(v), varNote(noi.forecast, noi.fy_budget, "full-year budget"), 80),
    ffo: kpi("FFO, trailing 12", f.find(s => s.label === "FFO").value, v => money(v), "After corporate G&A and interest", 160),
    affo: kpi("AFFO, trailing 12", f.find(s => s.label === "AFFO").value, v => money(v), "After capital and leasing costs", 240),
    cash: kpi("Cash after debt service", d.cash.after_debt, v => money(v), `Debt service ${money(d.cash.debt_service)}`, 320),
    dso: kpi("Days sales outstanding", d.receivables.dso, v => (v === null ? "–" : `${v.toFixed(1)} days`), `${money(d.receivables.total)} receivable`, 400),
  };
}
function updateTiles(tiles, d) {
  const noi = find(d, "NOI");
  const f = d.ffo.steps;
  tiles.ytd.set(noi.actual, varNote(noi.actual, noi.budget, "budget"));
  tiles.fcst.set(noi.forecast, varNote(noi.forecast, noi.fy_budget, "full-year budget"));
  tiles.ffo.set(f.find(s => s.label === "FFO").value);
  tiles.affo.set(f.find(s => s.label === "AFFO").value);
  tiles.cash.set(d.cash.after_debt, `Debt service ${money(d.cash.debt_service)}`);
  tiles.dso.set(d.receivables.dso, `${money(d.receivables.total)} receivable`);
}
function varNote(a, b, what) {
  const diff = a - b;
  const good = diff >= 0;
  return `<span class="${good ? "up" : "down"}">${good ? "▲" : "▼"} ${money(Math.abs(diff))}</span> ${good ? "ahead of" : "behind"} ${what}`;
}

function statementTable(d) {
  const cls = r => (r.kind === "noi" ? "total" : r.kind.endsWith("_total") ? "sub" : "");
  const kind = r => (r.kind.startsWith("opex") ? "opex" : "revenue");
  const rows = d.statement;
  return h("table", { class: "tbl" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Account"), h("th", { class: "r" }, "Actual"), h("th", { class: "r" }, "Budget"),
      h("th", { class: "r" }, "Variance"), h("th", { class: "r" }, "Var %"), h("th", { class: "r" }, "Prior year"),
      h("th", { class: "r" }, "Year over year"), h("th", { class: "r" }, "FY forecast"))),
    h("tbody", {}, rows.map(r => {
      const diff = r.actual - r.budget;
      const fav = kind(r) === "opex" ? diff < 0 : diff > 0;
      return h("tr", { class: cls(r) },
        h("td", {}, r.name),
        h("td", { class: "r" }, K(r.actual)),
        h("td", { class: "r" }, K(r.budget)),
        h("td", { class: "r" }, h("span", { class: `var ${Math.abs(diff) < 500 ? "flat" : fav ? "good" : "bad"}` }, K(diff))),
        h("td", { class: "r" }, varianceCell(r.actual, r.budget, kind(r))),
        h("td", { class: "r" }, K(r.prior)),
        h("td", { class: "r" }, r.prior ? pct((r.actual - r.prior) / Math.abs(r.prior), 1, { sign: true }) : "–"),
        h("td", { class: "r" }, K(r.forecast)));
    })));
}

function waterfallRange(b, steps) {
  let run = b.start, lo = Math.min(b.start, b.end), hi = Math.max(b.start, b.end);
  for (const s of steps) { run += s.delta; lo = Math.min(lo, run); hi = Math.max(hi, run); }
  const pad = (hi - lo) * 0.25 + Math.abs(hi) * 0.01;
  return [Math.max(0, lo - pad * 2.5), hi + pad];
}

function bridgeTable(d) {
  const b = d.bridge;
  return { columns: [{ label: "Step" }, { label: "Change", align: "r" }],
    rows: [["Prior 12 months", money(b.start)], ...b.steps.map(s => [s.label, moneyFull(s.delta)]), ["Latest 12 months", money(b.end)]] };
}
function monthTable(d) {
  return { columns: [{ label: "Month" }, { label: "Actual", align: "r" }, { label: "Budget", align: "r" }, { label: "Variance", align: "r" }],
    rows: d.monthly.periods.map((m, i) => [monthLabel(m), money(d.monthly.actual[i]), money(d.monthly.budget[i]), moneyFull(d.monthly.actual[i] - d.monthly.budget[i])]) };
}
function ffoTable(d) {
  return { columns: [{ label: "Line" }, { label: "Amount", align: "r" }], rows: d.ffo.steps.map(s => [s.label, moneyFull(s.value)]) };
}
function ladderTable(d) {
  return { columns: [{ label: "Year" }, { label: "Maturing balance", align: "r" }, { label: "Loans" }],
    rows: d.debt.ladder.map(l => [l.year, money(l.balance), l.loans.join(", ") || "–"]) };
}
function arTable(d) {
  return { columns: [{ label: "Property" }, { label: "0–30", align: "r" }, { label: "31–60", align: "r" }, { label: "61–90", align: "r" }, { label: "Over 90", align: "r" }, { label: "Total", align: "r" }],
    rows: d.receivables.by_property.map(r => [r.name, moneyFull(r.current), moneyFull(r.d31_60), moneyFull(r.d61_90), moneyFull(r.d90_plus), moneyFull(r.total)]) };
}
function opexTable(d) {
  return { columns: [{ label: "Category" }, { label: "Trailing 12", align: "r" }], rows: d.opex_mix.map(o => [o.name, moneyFull(o.amount)]) };
}
