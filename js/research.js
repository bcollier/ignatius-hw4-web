// ================================================================ research

async function openResearch(id) {
  show("research");
  $("research-days").innerHTML = "";
  $("research-toc").innerHTML = "";
  $("research-meta").textContent = "Loading…";
  let r;
  try {
    r = await api(`/api/retreats/${id}/research`);
  } catch (err) {
    $("research-meta").textContent = "";
    return showMessage(err.message);
  }
  document.title = `Research · ${r.title || "Retreat"} · Ignatius at Home`;
  $("research-title").textContent = `Research done for ${r.title || "this retreat"}`;
  $("research-meta").textContent = [r.source_filename && `Made from ${r.source_filename}`, r.model && `written by ${modelLabel(r.model)}`].filter(Boolean).join(", ");
  for (const d of r.days) {
    $("research-toc").append(el("a", { href: `#research-day-${d.day}`, text: `Day ${d.day}` }));
    $("research-days").append(renderResearchDay(d));
  }
  const target = location.hash && document.querySelector(location.hash);
  if (target) target.scrollIntoView();
}

function renderResearchDay(d) {
  const card = el("article", { class: "card research-day", id: `research-day-${d.day}` },
    el("p", { class: "meta", text: `Day ${d.day}${d.source_ref ? ` · ${d.source_ref}` : ""}` }),
    el("h2", { text: dayTitle(d.title) }));
  card.append(el("h3", { text: "From your document" }));
  for (const [k, v] of Object.entries(d.notes || {})) card.append(el("p", {}, el("strong", { text: `${k.replace("_", " ")}: ` }), v));
  card.append(el("p", { class: "passage", text: d.passage_text || "" }));
  const cited = new Set((d.cited || []).map(urlIn).filter(Boolean));
  card.append(el("h3", { text: "Research for the deep dive" }));
  if (d.research) card.append(...researchFound(d, cited));
  else card.append(el("p", { class: "hint", text: noResearchReason(d) }));
  if (d.cited?.length) card.append(...citedSources(d.cited));
  return card;
}

const urlIn = (line) => line.match(/https?:\/\/[^\s)]+/)?.[0];
const serviceName = (key) => options.search_providers?.[key] || key;

function noResearchReason(d) {
  if (d.web_search) return "This day was made before research was saved, so only the cited sources are known.";
  return d.status === "ready" ? "No web research was done for this day." : "This day hasn't been made yet.";
}

// Who searched, what was searched, and every result (the cited ones marked).
function researchFound(d, cited) {
  const f = d.research;
  const who = f.how === "model web search" ? "The model searched the web itself" : `Searched with ${d.research_service || f.service}`;
  const extra = f.contributors?.length ? ` (results from ${f.contributors.map(serviceName).join(", ")})` : "";
  const out = [el("p", { class: "meta", text: `${who}${extra} · ${f.results.length} results · ${cited.size} cited` })];
  if (f.skipped?.length) out.push(el("p", { class: "hint", text: `Skipped: ${f.skipped.join("; ")}` }));
  if (f.queries?.length) out.push(el("p", { class: "meta", text: "Searches" }), el("ol", { class: "research-queries" }, f.queries.map((q) => el("li", { text: q }))));
  out.push(el("ul", { class: "research-results" }, f.results.map((x) =>
    el("li", { class: cited.has(x.url) ? "cited" : "" },
      el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.title || x.url }),
      x.service && el("span", { class: "service", text: serviceName(x.service) }),
      cited.has(x.url) && el("span", { class: "service", text: "· cited" }),
      x.content && el("p", { class: "snippet", text: x.content })))));
  return out;
}

function citedSources(lines) {
  return [
    el("h3", { text: "Sources the deep dive cites" }),
    el("ul", { class: "sources" }, lines.map((line) => {
      const url = urlIn(line);
      return el("li", {}, url ? el("a", { href: url, target: "_blank", rel: "noopener", text: line }) : line);
    })),
  ];
}
