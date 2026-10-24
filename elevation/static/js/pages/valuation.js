import { h, panel, kpi, countUp, badge } from "../lib/ui.js";
import { baseLayout, theme, sectorColor } from "../lib/theme.js";
import { plot, purge } from "../lib/charts.js";
import { money, pct, mult } from "../lib/format.js";

export const title = "Valuation lab";

const FIELDS = [
  { group: "Income" },
  { key: "noi_year1", label: "Year-one NOI", min: 500000, max: 20000000, step: 50000, fmt: v => money(v) },
  { key: "noi_growth", label: "NOI growth a year", min: -0.02, max: 0.06, step: 0.0025, fmt: v => pct(v, 2) },
  { key: "going_in_cap", label: "Going-in cap rate", min: 0.035, max: 0.11, step: 0.0005, fmt: v => pct(v, 2) },
  { key: "capex_pct_noi", label: "Capital reserve, share of NOI", min: 0, max: 0.15, step: 0.005, fmt: v => pct(v, 1) },
  { group: "Exit" },
  { key: "hold_years", label: "Hold period", min: 3, max: 15, step: 1, fmt: v => `${v} years` },
  { key: "exit_cap", label: "Exit cap rate", min: 0.035, max: 0.12, step: 0.0005, fmt: v => pct(v, 2) },
  { key: "selling_costs_pct", label: "Selling costs", min: 0, max: 0.04, step: 0.0025, fmt: v => pct(v, 2) },
  { group: "Financing" },
  { key: "ltv", label: "Loan to value", min: 0, max: 0.75, step: 0.01, fmt: v => pct(v, 0) },
  { key: "interest_rate", label: "Interest rate", min: 0.02, max: 0.09, step: 0.0005, fmt: v => pct(v, 2) },
  { key: "amort_years", label: "Amortization", options: [[0, "Interest only"], [25, "25 years"], [30, "30 years"]] },
  { group: "Return targets" },
  { key: "discount_rate", label: "Discount rate for DCF value", min: 0.05, max: 0.14, step: 0.0025, fmt: v => pct(v, 2) },
  { key: "hurdle_irr", label: "Levered IRR hurdle", min: 0.06, max: 0.2, step: 0.0025, fmt: v => pct(v, 2) },
];

const DEFAULTS = { noi_year1: 5000000, noi_growth: 0.025, going_in_cap: 0.06, exit_cap: 0.065, hold_years: 10,
  discount_rate: 0.08, capex_pct_noi: 0.06, acquisition_costs_pct: 0.015, selling_costs_pct: 0.02, ltv: 0.55,
  interest_rate: 0.0575, amort_years: 30, hurdle_irr: 0.10 };

export async function mount(view, ctx) {
  const port = await ctx.api.get("portfolio");
  const inputs = { ...DEFAULTS };
  const controls = {};

  const picker = h("select", { id: "lab-prop" },
    h("option", { value: "" }, "A hypothetical acquisition"),
    port.skyline.map(p => h("option", { value: p.id }, `${p.name} (${p.city})`)));
  picker.addEventListener("change", () => {
    const p = port.skyline.find(x => x.id === picker.value);
    if (p) {
      Object.assign(inputs, {
        noi_year1: Math.round(p.noi * 1.02 / 50000) * 50000, going_in_cap: p.cap_rate,
        exit_cap: Math.round((p.cap_rate + 0.0025) / 0.0005) * 0.0005, ltv: Math.min(0.75, Math.round(p.ltv * 100) / 100),
        noi_growth: p.sector === "Office" ? 0.01 : p.sector === "Industrial" ? 0.035 : 0.025,
      });
    } else Object.assign(inputs, DEFAULTS);
    syncControls();
    run();
  });

  const form = h("div", {}, h("div", { class: "field" }, h("label", { for: "lab-prop" }, "Start from"), picker));
  for (const f of FIELDS) {
    if (f.group) { form.append(h("p", { class: "group-label" }, f.group)); continue; }
    const out = h("output", { for: `f-${f.key}` });
    let input;
    if (f.options) {
      input = h("select", { id: `f-${f.key}` }, f.options.map(([v, l]) => h("option", { value: v }, l)));
      input.addEventListener("change", () => { inputs[f.key] = +input.value; run(); });
    } else {
      input = h("input", { id: `f-${f.key}`, type: "range", min: f.min, max: f.max, step: f.step });
      input.addEventListener("input", () => { inputs[f.key] = +input.value; out.textContent = f.fmt(+input.value); schedule(); });
    }
    controls[f.key] = { input, out, f };
    form.append(h("div", { class: "field" }, h("div", { class: "field-row" }, h("label", { for: `f-${f.key}` }, f.label), f.options ? null : out), input));
  }
  function syncControls() {
    for (const { input, out, f } of Object.values(controls)) {
      input.value = inputs[f.key];
      if (!f.options) out.textContent = f.fmt(inputs[f.key]);
    }
  }
  syncControls();

  const irrEl = h("div", { class: "irr-figure" }, "–");
  const irrLabel = h("div", { class: "irr-label" });
  const hurdle = h("div", { class: "hurdle" });
  const stats = {
    unlev: kpi("Unlevered IRR", null, v => pct(v, 1)),
    em: kpi("Equity multiple", null, v => mult(v)),
    price: kpi("Price at going-in cap", null, v => money(v)),
    dcf: kpi("DCF value", null, v => money(v)),
    dscr: kpi("Year-one DSCR", null, v => mult(v)),
    coc: kpi("Year-one cash yield", null, v => pct(v, 1)),
  };
  const cfP = panel({ title: "Cash flows to equity", sub: "Each bar is NOI after capital reserve, split between lender and equity", table: () => cfTable(last) });
  const senP = panel({ title: "Levered IRR sensitivity", sub: "", chartClass: "chart tall", table: () => senTable(last) });

  view.replaceChildren(
    h("header", { class: "page-head" }, h("div", {},
      h("h1", { class: "page-title" }, "Valuation lab"),
      h("p", { class: "page-sub" }, "Direct capitalization and a ten-year discounted cash flow, computed in Python as you move the sliders. Start from one of the sample assets or a blank deal."))),
    h("div", { class: "lab" },
      h("section", { class: "panel lab-inputs", "aria-label": "Deal assumptions" }, form),
      h("div", {},
        h("section", { class: "lab-hero" }, h("div", {}, irrEl, irrLabel, hurdle), h("div", { class: "lab-stats" }, Object.values(stats))),
        cfP.root, senP.root)));

  let last = null, lastIrr = 0, timer = null, seq = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 90); }
  async function run() {
    const id = ++seq;
    const res = await ctx.api.post("valuation", inputs);
    if (id !== seq) return;
    last = res;
    const r = res.result;
    countUp(irrEl, r.levered_irr, v => (v === null ? "n/a" : pct(v, 1)), 600, lastIrr);
    lastIrr = r.levered_irr ?? 0;
    irrLabel.textContent = `Levered IRR over ${res.inputs.hold_years} years on ${money(r.equity)} of equity`;
    const clears = r.levered_irr !== null && r.levered_irr >= inputs.hurdle_irr;
    hurdle.replaceChildren(badge(clears ? "good" : "critical", clears ? `Clears the ${pct(inputs.hurdle_irr, 1)} hurdle` : `Below the ${pct(inputs.hurdle_irr, 1)} hurdle`));
    stats.unlev.set(r.unlevered_irr);
    stats.em.set(r.equity_multiple);
    stats.price.set(r.price);
    const prem = r.dcf_value / r.price - 1;
    stats.dcf.set(r.dcf_value, `${prem >= 0 ? "▲" : "▼"} ${pct(Math.abs(prem), 1)} ${prem >= 0 ? "above" : "below"} price at ${pct(inputs.discount_rate, 2)}`);
    stats.dscr.set(r.dscr_y1, r.dscr_y1 ? (r.dscr_y1 < 1.25 ? "Below a typical 1.25× covenant" : `Debt yield ${pct(r.debt_yield_y1, 1)}`) : "No debt");
    stats.coc.set(r.cash_on_cash_y1, `Exit price ${money(r.sale_price)}`);
    drawCash(res);
    drawSens(res);
  }

  function drawCash(res) {
    const t = theme();
    const y = res.years;
    const years = y.map(r => `Year ${r.year}`);
    plot(cfP.chart, [
      { type: "bar", name: "Debt service", x: years, y: y.map(r => r.debt_service), marker: { color: t.ink3, line: { color: t.panel, width: 2 } },
        hovertemplate: "%{x}<br>Debt service %{y:$,.3s}<extra></extra>" },
      { type: "bar", name: "Cash to equity", x: years, y: y.map(r => r.levered_cf), marker: { color: sectorColor("Industrial"), line: { color: t.panel, width: 2 } },
        hovertemplate: "%{x}<br>Cash to equity %{y:$,.3s}<extra></extra>" },
      { type: "bar", name: "Sale proceeds after loan payoff", x: years, y: y.map(r => r.sale_proceeds - r.loan_payoff),
        marker: { color: t.light, line: { color: t.panel, width: 2 } }, hovertemplate: "%{x}<br>Net sale to equity %{y:$,.3s}<extra></extra>" },
    ], baseLayout({ barmode: "relative", showlegend: true, margin: { t: 30 }, bargap: 0.3, yaxis: { tickprefix: "$", tickformat: ".2s" } }));
  }

  function drawSens(res) {
    const t = theme();
    const s = res.sensitivity;
    const z = s.levered_irr.map(row => row.map(v => (v === null ? null : v * 100)));
    const hz = inputs.hurdle_irr * 100;
    const span = Math.max(4, ...z.flat().filter(v => v !== null).map(v => Math.abs(v - hz)));
    senP.root.querySelector(".panel-sub").textContent = `Exit cap rate against NOI growth. Blue clears the ${pct(inputs.hurdle_irr, 1)} hurdle, red falls short; the outlined cell is your base case.`;
    plot(senP.chart, [{
      type: "heatmap", z, x: s.growth.map(g => pct(g, 2)), y: s.exit_caps.map(c => pct(c, 2)),
      zmin: hz - span, zmax: hz + span, zmid: hz, colorscale: [[0, t.neg], [0.5, t.mid], [1, t.pos]], showscale: false,
      xgap: 2, ygap: 2, texttemplate: "%{z:.1f}%", textfont: { size: 11, color: t.ink },
      hovertemplate: "Exit cap %{y}, NOI growth %{x}<br>Levered IRR %{z:.1f}%<extra></extra>",
    }], baseLayout({
      margin: { t: 6, l: 8, b: 8 },
      xaxis: { title: { text: "NOI growth a year" }, type: "category", showgrid: false, side: "bottom" },
      yaxis: { title: { text: "Exit cap rate" }, type: "category", showgrid: false, autorange: "reversed" },
      shapes: [{ type: "rect", xref: "x", yref: "y", x0: 3.5, x1: 4.5, y0: 3.5, y1: 4.5, line: { color: t.light, width: 2.5 } }],
    }), { grow: false });
  }

  await run();
  return { destroy() { clearTimeout(timer); view.querySelectorAll(".chart").forEach(purge); } };
}

function cfTable(res) {
  if (!res) return { columns: [], rows: [] };
  return { columns: [{ label: "Year" }, { label: "NOI", align: "r" }, { label: "Capital reserve", align: "r" }, { label: "Debt service", align: "r" },
    { label: "Cash to equity", align: "r" }, { label: "Net sale", align: "r" }],
  rows: res.years.map(r => [r.year, money(r.noi), money(r.capex), money(r.debt_service), money(r.levered_cf), r.sale_proceeds ? money(r.sale_proceeds - r.loan_payoff) : "–"]) };
}
function senTable(res) {
  if (!res) return { columns: [], rows: [] };
  const s = res.sensitivity;
  return { columns: [{ label: "Exit cap" }, ...s.growth.map(g => ({ label: pct(g, 2), align: "r" }))],
    rows: s.exit_caps.map((c, i) => [pct(c, 2), ...s.levered_irr[i].map(v => (v === null ? "–" : pct(v, 1)))]) };
}
