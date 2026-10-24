// Plotly wrapper: first render grows the marks up from the baseline,
// later renders morph in place (Plotly.react + transition).
import { plotConfig, reducedMotion } from "./theme.js";

const Plotly = window.Plotly;

function watchSize(div) {
  if (div.sizeWatch) return;
  let t;
  div.sizeWatch = new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (div.data && div.isConnected && div.offsetParent !== null) Plotly.Plots.resize(div).catch(() => {});
    }, 80);
  });
  div.sizeWatch.observe(div);
}

export async function plot(div, data, layout, opts = {}) {
  const animate = !reducedMotion() && opts.animate !== false;
  watchSize(div);
  if (div.data && div._fullLayout) {
    const l = { ...layout };
    if (animate && opts.morph !== false) l.transition = { duration: 650, easing: "cubic-in-out" };
    return Plotly.react(div, data, l, plotConfig);
  }
  if (!animate || opts.grow === false) return Plotly.newPlot(div, data, layout, plotConfig);

  div.style.visibility = "hidden";
  await Plotly.newPlot(div, data, layout, plotConfig);
  const horizontal = data.some(t => t.orientation === "h");
  const ax = horizontal ? "xaxis" : "yaxis";
  const key = horizontal ? "x" : "y";
  const range = div._fullLayout[ax].range.slice();
  await Plotly.relayout(div, { [`${ax}.range`]: range, [`${ax}.autorange`]: false });
  const idx = data.map((t, i) => (["bar", "scatter", undefined].includes(t.type) ? i : -1)).filter(i => i >= 0);
  // Plotly keeps references to our trace objects, so copy the targets before zeroing them.
  const targets = idx.map(i => (data[i][key] || []).slice());
  const start = idx.map(i => {
    const base = data[i].type === "bar" ? 0 : range[0];
    return (data[i][key] || []).map(v => (v === null ? null : base));
  });
  await Plotly.restyle(div, { [key]: start }, idx);
  div.style.visibility = "";
  const ms = opts.duration || 950;
  await Plotly.animate(div, { data: targets.map(v => ({ [key]: v })), traces: idx },
    { transition: { duration: ms, easing: "cubic-out" }, frame: { duration: ms, redraw: false } });
  // let later resizes / reacts autorange again
  div.layout[ax].autorange = layout[ax]?.autorange ?? true;
  if (layout[ax]?.range) div.layout[ax].range = layout[ax].range;
}

export function purge(div) {
  if (div && div.sizeWatch) { div.sizeWatch.disconnect(); div.sizeWatch = null; }
  if (div && div.data) Plotly.purge(div);
}
