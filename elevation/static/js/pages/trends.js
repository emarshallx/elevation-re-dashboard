import { h, sourceLink } from "../lib/ui.js";
import { dateLabel } from "../lib/format.js";

export const title = "Trends & tools";

export async function mount(view, ctx) {
  const m = await ctx.api.get("markets");
  const f = m.proptech_funding;

  view.replaceChildren(
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title" }, "Trends & tools"),
        h("p", { class: "page-sub" }, `Six shifts shaping North American and European real estate, and the software asset managers and accountants are adopting. Compiled ${dateLabel(m.compiled)}.`))),
    h("div", { class: "trends" }, m.trends.map(tr => h("article", { class: "trend" },
      h("div", {}, h("div", { class: "trend-figure" }, tr.figure), h("div", { class: "trend-figure-label" }, tr.figure_label)),
      h("div", {},
        h("h2", { class: "trend-title" }, tr.title),
        h("p", { class: "trend-body" }, tr.summary),
        h("p", { class: "trend-so" }, tr.so_what),
        h("div", { class: "trend-src", html: `Sources: ${tr.sources.map(sourceLink).join(" ")}` }))))),
    h("h2", { class: "section-title" }, "Tools worth knowing"),
    h("p", { class: "page-sub", style: { margin: "-6px 0 16px" }, html:
      `${f.label}: <strong>${f.value}</strong>. ${f.note} ${sourceLink(f.source)}` }),
    h("div", { class: "tools" }, m.tools.map(t => h("article", { class: "tool" },
      h("h3", { class: "tool-name" }, t.name),
      h("p", { class: "tool-cat" }, `${t.category}, ${t.vendor}`),
      h("p", {}, t.whats_new),
      h("p", { class: "why" }, t.why),
      h("div", { class: "tool-foot" }, h("span", {}, t.date), h("span", { html: sourceLink(t.source) }))))),
  );
  return {};
}
