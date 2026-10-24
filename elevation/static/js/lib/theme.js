// Reads the CSS design tokens so charts always match the active theme.

export const SECTORS = ["Office", "Industrial", "Retail", "Multifamily"];
export const COMMERCIAL = ["Office", "Industrial", "Retail"];

export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function sectorColor(sector) {
  return token(`--s-${sector.toLowerCase()}`);
}

// Market / central-bank series reuse the categorical order (slots 1-4).
export function slotColor(i) {
  return [token("--s-office"), token("--s-industrial"), token("--s-retail"), token("--s-multifamily")][i % 4];
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function theme() {
  return {
    ink: token("--ink"), ink2: token("--ink-2"), ink3: token("--ink-3"),
    line: token("--line"), lineStrong: token("--line-strong"),
    panel: token("--panel"), panel2: token("--panel-2"), page: token("--page"),
    light: token("--light"), good: token("--good"), critical: token("--critical"),
    serious: token("--serious"), warning: token("--warning"),
    neg: token("--div-neg"), mid: token("--div-mid"), pos: token("--div-pos"),
    bldg: token("--bldg"),
  };
}

const FONT = 'Archivo, system-ui, -apple-system, "Segoe UI", sans-serif';

export function baseLayout(extra = {}) {
  const t = theme();
  const axis = {
    gridcolor: t.line, linecolor: t.lineStrong, zerolinecolor: t.lineStrong,
    tickfont: { color: t.ink3, size: 11 }, title: { font: { color: t.ink3, size: 12 } },
    zeroline: false, showline: false, ticks: "", automargin: true,
  };
  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: FONT, color: t.ink2, size: 12 },
    margin: { l: 8, r: 12, t: 8, b: 8 },
    xaxis: { ...axis, showgrid: false, linecolor: t.lineStrong, showline: true },
    yaxis: { ...axis, showgrid: true },
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", xanchor: "left", traceorder: "normal", font: { color: t.ink2, size: 12 }, bgcolor: "rgba(0,0,0,0)" },
    hoverlabel: { bgcolor: t.panel2, bordercolor: t.lineStrong, font: { family: FONT, color: t.ink, size: 12 }, align: "left" },
    hovermode: "closest",
    bargap: 0.28,
    showlegend: false,
  };
  return deepMerge(layout, extra);
}

export const plotConfig = {
  displayModeBar: false,
  responsive: true,
  topojsonURL: (window.ELEVATION_STATIC || "/static/") + "vendor/topojson/",
};

export function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && a && typeof a[k] === "object" && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Ordinal ramp for receivable aging buckets (lightest = current).
export function agingRamp() {
  const dark = document.documentElement.dataset.theme !== "light";
  return dark
    ? ["#5a8fc9", "#c9a14a", "#e07b4f", "#ff7a7a"]
    : ["#86b6ef", "#d8a531", "#d9693f", "#c02e2e"];
}
