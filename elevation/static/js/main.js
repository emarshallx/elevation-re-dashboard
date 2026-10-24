// App shell: routing, shared filter state, theme switching and API access.
import { h, segmented } from "./lib/ui.js";
import { sectorColor } from "./lib/theme.js";
import * as portfolio from "./pages/portfolio.js";
import * as assets from "./pages/assets.js";
import * as financials from "./pages/financials.js";
import * as markets from "./pages/markets.js";
import * as trends from "./pages/trends.js";
import * as valuation from "./pages/valuation.js";

const PAGES = { portfolio, assets, financials, markets, trends, valuation };
const view = document.getElementById("view");

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const cache = new Map();
const api = {
  async get(path) {
    if (cache.has(path)) return cache.get(path);
    const p = fetch(`/api/${path}`).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for /api/${path}`);
      return r.json();
    });
    cache.set(path, p);
    p.catch(() => cache.delete(path));
    return p;
  },
  async post(path, body) {
    const r = await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} for /api/${path}`);
    return r.json();
  },
};

const ctx = {
  api,
  meta: null,
  state: store.get("elevation-filters", { region: "all", sector: "all" }),
  navigate(hash) { location.hash = hash; },
  query() { return `region=${encodeURIComponent(ctx.state.region)}&sector=${encodeURIComponent(ctx.state.sector)}`; },
  setFilter(patch) {
    ctx.state = { ...ctx.state, ...patch };
    store.set("elevation-filters", ctx.state);
    if (current && current.update) current.update(ctx.state);
  },
  filterControls() {
    const sectors = [{ value: "all", label: "All sectors" },
      ...ctx.meta.sectors.map(s => ({ value: s, label: s, swatch: sectorColor(s) }))];
    return h("div", { class: "filters" },
      segmented([{ value: "all", label: "US + Canada" }, { value: "US", label: "US" }, { value: "Canada", label: "Canada" }],
        ctx.state.region, v => ctx.setFilter({ region: v }), "Region"),
      segmented(sectors, ctx.state.sector, v => ctx.setFilter({ sector: v }), "Sector"));
  },
};

let current = null;
let currentName = null;

function parse() {
  const [, name = "portfolio", arg = null] = (location.hash || "#/portfolio").split("/");
  return { name: PAGES[name] ? name : "portfolio", arg };
}

function moveCar(name) {
  const link = document.querySelector(`.nav-link[data-page="${name}"]`);
  document.querySelectorAll(".nav-link").forEach(a => a.removeAttribute("aria-current"));
  if (!link) return;
  link.setAttribute("aria-current", "page");
  const car = document.querySelector(".nav-car");
  car.style.transform = `translateY(${link.offsetTop}px)`;
}

async function route() {
  const { name, arg } = parse();
  moveCar(name);
  if (name === currentName && current && current.select) { current.select(arg); return; }
  if (current && current.destroy) current.destroy();
  current = null;
  currentName = name;
  view.classList.remove("is-entering");
  view.replaceChildren(h("p", { class: "loading" }, "Loading…"));
  try {
    const page = PAGES[name];
    document.title = `${page.title} – Elevation`;
    const mounted = await page.mount(view, ctx, arg);
    if (currentName !== name) return; // navigated away while loading
    current = mounted || {};
    void view.offsetWidth;
    view.classList.add("is-entering");
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    view.replaceChildren(h("p", { class: "error" },
      `This page could not load: ${err.message}. Check the terminal running run.py for details, then reload.`));
  }
}

function applyThemeLabel() {
  const dark = document.documentElement.dataset.theme !== "light";
  document.getElementById("themeLabel").textContent = dark ? "Vellum theme" : "Blueprint theme";
}

document.getElementById("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("elevation-theme", next); } catch { /* ignore */ }
  applyThemeLabel();
  currentName = null; // force a full redraw so charts pick up the new tokens
  route();
});

window.addEventListener("hashchange", route);
window.addEventListener("resize", () => moveCar(parse().name));

(async function boot() {
  applyThemeLabel();
  try {
    ctx.meta = await api.get("meta");
  } catch (err) {
    view.replaceChildren(h("p", { class: "error" }, `Could not reach the Elevation API (${err.message}). Is run.py still running?`));
    return;
  }
  if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]);
  route();
})();
