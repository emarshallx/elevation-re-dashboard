// The portfolio drawn as a night skyline.
//   height of each building  = appraised value (top of the roof = value on the axis)
//   width                    = size of the asset (square feet; apartments at ~950 sf/unit)
//   lit windows              = share of space leased / units occupied (exact fraction)
//   roof shape + base strip  = sector (office crown, industrial sawtooth, retail parapet, residential gable)
import { SECTORS, sectorColor, reducedMotion } from "./lib/theme.js";
import { money, pct, years } from "./lib/format.js";
import { showTip, hideTip } from "./lib/ui.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
};

const WINDOW = {
  Office: { w: 4, h: 6, gx: 3, gy: 4, pad: 6, top: 8 },
  Industrial: { w: 11, h: 4, gx: 5, gy: 7, pad: 8, top: 9 },
  Retail: { w: 8, h: 8, gx: 5, gy: 6, pad: 7, top: 9 },
  Multifamily: { w: 5, h: 7, gx: 5, gy: 6, pad: 6, top: 8 },
};
const ROOF_H = { Office: 16, Industrial: 9, Retail: 7, Multifamily: 12 };

function seeded(str) {
  let s = 0;
  for (const c of str) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function niceMax(v) {
  const step = v > 300e6 ? 100e6 : 50e6;
  return Math.ceil(v / step) * step;
}

/** Draw one building into group `g`. (x, ground) is the bottom-left corner. */
export function drawBuilding(g, p, x, ground, w, totalH, { delayBase = 0, label = true, rnd = Math.random } = {}) {
  const roofH = Math.min(ROOF_H[p.sector], totalH * 0.3);
  const bodyH = Math.max(totalH - roofH, 6);
  const top = ground - bodyH;
  const rise = svgEl("g", { class: "rise" });
  g.append(rise);

  // roof
  if (p.sector === "Office") {
    const cw = w * 0.62, ch = roofH * 0.55;
    rise.append(svgEl("rect", { class: "roof", x: x + (w - cw) / 2, y: top - ch, width: cw, height: ch }));
    rise.append(svgEl("rect", { class: "roof", x: x + w / 2 - 1, y: ground - totalH, width: 2, height: roofH - ch }));
  } else if (p.sector === "Industrial") {
    const teeth = Math.max(3, Math.round(w / 22));
    const tw = w / teeth;
    let d = `M${x},${top}`;
    for (let i = 0; i < teeth; i++) d += ` L${x + i * tw},${top - roofH} L${x + (i + 1) * tw},${top}`;
    rise.append(svgEl("path", { class: "roof", d: d + " Z" }));
  } else if (p.sector === "Retail") {
    rise.append(svgEl("rect", { class: "roof", x: x - 3, y: top - roofH, width: w + 6, height: roofH }));
  } else {
    rise.append(svgEl("path", { class: "roof", d: `M${x},${top} L${x + w / 2},${top - roofH} L${x + w},${top} Z` }));
  }
  rise.append(svgEl("rect", { class: "body", x, y: top, width: w, height: bodyH }));

  // windows: lit share == occupancy, exactly
  const spec = WINDOW[p.sector];
  const cols = Math.max(1, Math.floor((w - 2 * spec.pad + spec.gx) / (spec.w + spec.gx)));
  const rows = Math.max(1, Math.floor((bodyH - spec.top - 6 + spec.gy) / (spec.h + spec.gy)));
  const total = cols * rows;
  const lit = Math.round(total * p.occupancy);
  const order = Array.from({ length: total }, (_, i) => i).sort(() => rnd() - 0.5);
  const onSet = new Set(order.slice(0, lit));
  const usedW = cols * spec.w + (cols - 1) * spec.gx;
  const x0 = x + (w - usedW) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const on = onSet.has(i);
      const win = svgEl("rect", {
        class: on ? "win on" : "win", x: x0 + c * (spec.w + spec.gx), y: top + spec.top + r * (spec.h + spec.gy),
        width: spec.w, height: spec.h,
      });
      if (on) win.style.transitionDelay = `${delayBase + rnd() * 1400}ms`;
      rise.append(win);
    }
  }
  g.append(svgEl("rect", { class: "base", x: x - 1, y: ground, width: w + 2, height: 4, fill: sectorColor(p.sector) }));

  if (label) {
    const words = p.short.split(" ");
    const lines = p.short.length * 6.1 > w + 14 && words.length > 1
      ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
      : [p.short];
    lines.forEach((ln, i) => {
      const t = svgEl("text", { class: "label", x: x + w / 2, y: ground + 19 + i * 13 });
      t.textContent = ln;
      g.append(t);
    });
    const c = svgEl("text", { class: "label-2", x: x + w / 2, y: ground + 19 + lines.length * 13 });
    c.textContent = p.city;
    g.append(c);
  }
  return { windows: total, lit };
}

export function createSkyline(container, props, { onSelect } = {}) {
  let filter = { region: "all", sector: "all" };
  let groups = new Map();
  let firstPaint = true;

  function render() {
    const W = Math.max(container.clientWidth, 760);   // narrower screens scroll sideways
    const H = container.clientHeight || 340;
    const gutter = 52, ground = H - 58, topPad = 16;
    const svg = svgEl("svg", { class: "skyline", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
      "aria-label": "Portfolio skyline: building height shows value, lit windows show occupancy" });

    const defs = svgEl("defs");
    const grad = svgEl("radialGradient", { id: "skyGlow", cx: "50%", cy: "100%", r: "70%" });
    grad.append(svgEl("stop", { offset: "0%", "stop-color": "var(--light)", "stop-opacity": "0.10" }));
    grad.append(svgEl("stop", { offset: "100%", "stop-color": "var(--light)", "stop-opacity": "0" }));
    defs.append(grad);
    svg.append(defs, svgEl("rect", { class: "glow", x: 0, y: 0, width: W, height: ground }));

    const sorted = [...props].sort((a, b) =>
      SECTORS.indexOf(a.sector) - SECTORS.indexOf(b.sector) || b.value - a.value);
    const vmax = niceMax(Math.max(...sorted.map(p => p.value)));
    const maxH = ground - topPad;
    const scale = v => (v / vmax) * maxH;

    // value axis
    const axis = svgEl("g", { class: "axis" });
    const step = vmax > 300e6 ? 100e6 : 50e6;
    for (let v = step; v <= vmax; v += step) {
      const y = ground - scale(v);
      axis.append(svgEl("line", { x1: gutter - 6, x2: W, y1: y, y2: y }));
      const t = svgEl("text", { x: 0, y: y + 4 });
      t.textContent = money(v, { digits: 0 });
      axis.append(t);
    }
    svg.append(axis);

    // widths ~ sqrt(size), gaps between buildings and wider gaps between sectors
    const area = p => (p.size_unit === "units" ? p.size * 950 : p.size);
    const raw = sorted.map(p => Math.sqrt(area(p)));
    const sectorBreaks = sorted.filter((p, i) => i > 0 && p.sector !== sorted[i - 1].sector).length;
    const gap = 12, sectorGap = 30;
    const avail = W - gutter - 10 - gap * (sorted.length - 1) - sectorGap * sectorBreaks;
    const k = avail / raw.reduce((a, b) => a + b, 0);
    const widths = raw.map(r => Math.max(40, r * k));
    const over = widths.reduce((a, b) => a + b, 0) - avail;
    if (over > 0) { const shrink = (avail) / (avail + over); widths.forEach((w, i) => (widths[i] = w * shrink)); }

    let x = gutter + 4;
    groups = new Map();
    const rise = svgEl("g");
    svg.append(rise);
    sorted.forEach((p, i) => {
      if (i > 0) x += sorted[i - 1].sector !== p.sector ? sectorGap : gap;
      const g = svgEl("g", { class: "bldg", tabindex: "0", role: "link",
        "aria-label": `${p.name}, ${p.city}. Value ${money(p.value)}, occupancy ${pct(p.occupancy, 0)}. Open asset.` });
      const delay = firstPaint ? i * 70 : 0;
      g.style.setProperty("--d", `${delay}ms`);
      drawBuilding(g, p, x, ground, widths[i], scale(p.value), { delayBase: firstPaint ? 900 + i * 70 : 0, rnd: seeded(p.id) });
      g.addEventListener("mousemove", e => showTip(tipHtml(p), e.clientX, e.clientY));
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("focus", () => { const r = g.getBoundingClientRect(); showTip(tipHtml(p), r.left + r.width / 2, r.top); });
      g.addEventListener("blur", hideTip);
      g.addEventListener("click", () => { hideTip(); onSelect && onSelect(p.id); });
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect && onSelect(p.id); } });
      rise.append(g);
      groups.set(p.id, { g, p });
      x += widths[i];
    });
    const groundLine = svgEl("line", { class: "ground", x1: gutter - 6, x2: W, y1: ground + 0.5, y2: ground + 0.5 });
    svg.append(groundLine);

    container.replaceChildren(svg);
    applyFilter();

    if (firstPaint && !reducedMotion()) {
      svg.classList.add("is-down");
      const len = W - gutter + 6;
      groundLine.style.strokeDasharray = `${len}`;
      groundLine.style.strokeDashoffset = `${len}`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        svg.classList.remove("is-down");
        svg.classList.add("is-up");
        groundLine.style.transition = "stroke-dashoffset 900ms cubic-bezier(.6,0,.2,1)";
        groundLine.style.strokeDashoffset = "0";
        setTimeout(() => svg.classList.add("is-lit"), 200);
      }));
    } else {
      svg.classList.add("is-up", "is-lit", "no-anim");
    }
    firstPaint = false;
  }

  function applyFilter() {
    for (const { g, p } of groups.values()) {
      const inRegion = filter.region === "all" || p.country === filter.region;
      const inSector = filter.sector === "all" || p.sector === filter.sector;
      g.classList.toggle("is-out", !(inRegion && inSector));
    }
  }

  let t, lastWidth = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (container.clientWidth === lastWidth) return;   // the observer also fires once on observe()
    lastWidth = container.clientWidth;
    clearTimeout(t);
    t = setTimeout(render, 120);
  });
  ro.observe(container);
  render();

  return {
    setFilter(f) { filter = f; applyFilter(); },
    highlight(id, on) { const x = groups.get(id); if (x) x.g.classList.toggle("is-hot", on); },
    destroy() { ro.disconnect(); },
  };
}

function tipHtml(p) {
  const size = p.size_unit === "units" ? `${p.size} units` : `${Math.round(p.size / 1000)}K sf`;
  return `<h4>${p.name}</h4>
    <div class="tip-sub">${p.klass} ${p.sector.toLowerCase()}, ${p.city} ${p.province}</div>
    <dl>
      <dt>Value</dt><dd>${money(p.value)}</dd>
      <dt>NOI, trailing 12</dt><dd>${money(p.noi)}</dd>
      <dt>Cap rate</dt><dd>${pct(p.cap_rate, 2)}</dd>
      <dt>${p.sector === "Multifamily" ? "Occupied" : "Leased"}</dt><dd>${pct(p.occupancy, 1)}</dd>
      <dt>Size</dt><dd>${size}</dd>
      <dt>Loan to value</dt><dd>${pct(p.ltv, 0)}</dd>
      ${p.walt ? `<dt>WALT</dt><dd>${years(p.walt)}</dd>` : ""}
    </dl>`;
}
