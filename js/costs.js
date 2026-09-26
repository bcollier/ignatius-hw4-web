// ================================================================ costs (tucked away: ?costs)
// The only place the app shows what things cost: each retreat by part and by company,
// a total by company, what isn't tied to a retreat, and the prices used.

async function openCosts() {
  show("costs");
  document.title = "Costs · Ignatius at Home";
  const body = $("costs-page");
  body.innerHTML = "";
  body.append(el("p", { class: "meta", text: "Loading…" }));
  let r;
  try {
    r = await api("/api/costs");
  } catch (err) {
    body.innerHTML = "";
    return showMessage(err.message);
  }
  body.innerHTML = "";
  body.append(costTotalsCard(r));
  if (!r.retreats.length) body.append(el("p", { class: "hint", text: "No retreats yet." }));
  for (const t of r.retreats) body.append(costRetreatCard(t));
  if (r.other.usd > 0) body.append(costOtherCard(r.other));
  body.append(costPricesCard(r.prices));
}

// A small table: rows of data, columns as [heading, (row) => cell text].
function costTable(rows, cols) {
  return el("table", { class: "cost-table" },
    el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: c[0] })))),
    el("tbody", {}, rows.map((row) => el("tr", {}, cols.map((c) => el("td", { text: c[1](row) }))))));
}

const costOrFree = (n) => (n > 0 ? money(n) : "free");

function costDetail(x) {
  return [
    x.input_tokens ? `${Math.round(x.input_tokens / 1000)}k tokens in, ${Math.round((x.output_tokens || 0) / 1000)}k out` : "",
    x.searches ? `${x.searches} searches` : "",
    x.characters ? `${x.characters.toLocaleString()} characters` : "",
    x.free_characters ? `${x.free_characters.toLocaleString()} free-voice characters` : "",
    x.seconds ? `${formatMinutes(x.seconds)} of conversation` : "",
  ].filter(Boolean).join(", ");
}

function costTotalsCard(r) {
  return el("div", { class: "card" },
    el("h2", { text: `All together: ${money(r.total_usd)}` }),
    costTable(r.by_vendor, [["Company", (v) => v.name], ["Cost", (v) => costOrFree(v.usd)]]));
}

function costRetreatCard(t) {
  const columns = (first) => [[first, (x) => x.name], ["Cost", (x) => costOrFree(x.usd)], ["Details", costDetail]];
  return el("details", { class: "card cost-retreat" },
    el("summary", {}, el("strong", { text: t.example ? `${t.title} (example)` : t.title }),
      el("span", { class: "meta", text: ` · ${new Date(t.created_at * 1000).toLocaleDateString()} · ${modelLabel(t.model)} · ${money(t.total_usd)}` })),
    el("h3", { text: "By part" }),
    costTable(t.sections, columns("Part")),
    el("h3", { text: "By company" }),
    costTable(t.vendors, columns("Company")));
}

function costOtherCard(other) {
  return el("div", { class: "card" }, el("h3", { text: `Not tied to a retreat: ${money(other.usd)}` }),
    el("p", { class: "hint", text: "Summarizing About me, the conversation companion's memory, and retreats since deleted." }),
    costTable(other.vendors, [["Company", (x) => x.name], ["Cost", (x) => costOrFree(x.usd)]]));
}

function costPricesCard(p) {
  const bal = p.elevenlabs_balance;
  const e = options && !isFree() ? estimateRetreat() : null;
  return el("div", { class: "card" },
    el("h3", { text: "Prices" }),
    p.models.length ? costTable(p.models, [["Model", (m) => m.label], ["Per million tokens", (m) => `$${m.input_per_m} in, $${m.output_per_m} out`]]) : "",
    el("p", { text: `ElevenLabs voices are counted at $${p.elevenlabs_usd_per_1k_chars.toFixed(2)} per 1,000 characters (list price; your plan may cost less).${bal ? ` This period: ${bal.remaining.toLocaleString()} of ${bal.limit.toLocaleString()} characters left.` : ""}` }),
    el("p", { text: `Talk it over: OpenAI about $${p.talk_usd_per_minute.openai.toFixed(2)} a minute, Grok about $${p.talk_usd_per_minute.xai.toFixed(2)} a minute. Microsoft voices, the free open models and most search services' free tiers cost nothing.` }),
    e ? el("p", { text: `A new seven-day retreat with your current Advanced settings (${modelLabel(e.model.id)}${e.voice ? ", ElevenLabs voices" : ""}) would cost about ${money(e.total)}.` }) : "",
    el("p", { class: "hint", text: "Model, search and conversation costs come from the log of every call (the llm_calls table). Voice costs count the recordings each retreat has now." }));
}
