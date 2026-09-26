// ================================================================ library

async function openLibrary() {
  show("library");
  document.title = "Ignatius at Home";
  $("free-banner").hidden = !isFree();
  $("free-banner").textContent = "Free mode: retreats are written by open models, researched on the web, and read by free voices.";
  $("upgrade-box").hidden = !me?.anonymous;
  try {
    const body = await api("/api/retreats");
    library = body.retreats;
    examples = body.examples || [];
    hiddenExamples = body.hidden_examples || [];
  } catch (err) {
    return showMessage(err.message);
  }
  renderLibrary();
  if (library.some((r) => r.status === "planning" || r.status === "building")) {
    pollTimer = setTimeout(() => params().toString() === "" && openLibrary(), 8000);
  }
}

// A day's state, from the library summary or the full retreat.
function dayState(r, d) {
  const status = d.status;
  const prayed = !!d.prayed_at;
  const started = d.started ?? !!d.listening?.parts_played?.length;
  const finished = d.finished ?? !!d.listening?.finished_at;
  const date = r.start_date ? addDays(r.start_date, d.day - 1) : null;
  const today = date === localToday();
  const past = date && date < localToday();
  const ready = status === "ready";
  let kind = "idle";
  if (status === "queued" || status === "building") kind = "making";
  else if (status === "failed") kind = "failed";
  else if (prayed) kind = "prayed";
  else if (ready && started && !finished) kind = "started";
  else if (ready && past) kind = "missed";
  else if (ready) kind = "ready";
  return { kind, prayed, started, finished, today, date, ready };
}

// The next day worth praying: one started, then one missed, then today, then the first unprayed.
function nextDay(r, days) {
  const states = days.map((d) => ({ d, s: dayState(r, d) }));
  return (
    states.find((x) => x.s.kind === "started") ||
    states.find((x) => x.s.kind === "missed") ||
    states.find((x) => x.s.today && x.s.ready && !x.s.prayed) ||
    states.find((x) => x.s.ready && !x.s.prayed) ||
    null
  );
}

// Retreats grouped by series: each retreat joins the group of the first earlier week it names.
function seriesGroups() {
  const byId = Object.fromEntries(library.map((r) => [r.id, r]));
  const rootOf = (r, seen = new Set()) => {
    const first = (r.series || []).find((id) => byId[id]);
    if (!first || seen.has(first)) return r.id;
    seen.add(first);
    return rootOf(byId[first], seen);
  };
  const groups = new Map();
  for (const r of [...library].sort((a, b) => a.created_at - b.created_at)) {
    const key = rootOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].sort((a, b) => b[b.length - 1].created_at - a[a.length - 1].created_at);
}

function renderLibrary() {
  $("library-empty").hidden = library.length > 0;
  renderExamples();
  renderContinueCard();
  renderGroups();
  fillSeriesList();
}

const lastUsed = (r) => Math.max(Date.parse(r.last_prayed_at || 0) || 0, r.created_at * 1000);
const touched = (r) => (r.day_states || []).some((d) => d.started || d.prayed_at);

// The card at the top: the one day most worth praying next, or else a retreat being made.
function renderContinueCard() {
  const cont = $("continue");
  cont.innerHTML = "";
  cont.hidden = true;
  // Your own retreats first, then an example you've begun, then (with nothing of your own) the first example.
  const candidates = [...library].sort((a, b) => lastUsed(b) - lastUsed(a))
    .concat(examples.filter(touched), library.length ? [] : examples.filter((r) => !touched(r)));
  for (const r of candidates) {
    const pick = nextDay(r, r.day_states || []);
    if (!pick) continue;
    cont.append(...continueCard(r, pick));
    cont.style.setProperty("--cover", r.cover ? `url("${fileUrl(r.cover)}")` : "none");
    cont.hidden = false;
    return;
  }
  const making = library.find((r) => r.status === "planning" || r.status === "building");
  if (making) {
    cont.append(...beingMadeCard(making));
    cont.hidden = false;
  }
}

function continueCard(r, { d, s }) {
  const fresh = r.read_only && !touched(r);
  const lead = fresh ? "Start here · an example retreat" : s.kind === "started" ? "Continue where you left off" : s.kind === "missed" ? `You missed Day ${d.day}` : s.today ? "Today" : "Next";
  return [
    el("p", { class: "eyebrow", text: lead }),
    el("h3", { text: `Day ${d.day}${d.title ? ` · ${dayTitle(d.title)}` : ""}` }),
    el("p", { class: "meta", text: `${r.series?.length ? `Week ${r.series.length + 1} · ` : ""}${r.title}${r.demo ? ` · ${r.demo.label}` : ""}` }),
    el("div", { class: "row-buttons" },
      el("a", { class: "button big", href: `./?r=${r.id}&pray=${d.day}`, "data-nav": "", text: s.kind === "started" ? "Continue praying" : "Pray this day" }),
      el("a", { href: `./?r=${r.id}`, "data-nav": "", text: "Open the retreat" })),
  ];
}

function beingMadeCard(making) {
  const p = making.progress;
  return [
    el("p", { class: "eyebrow", text: "Being made" }),
    el("h3", { text: making.title }),
    el("p", { class: "meta", text: making.status === "planning" ? "Planning the days…" : `Day ${Math.min((p?.done || 0) + 1, p?.total || 1)} of ${p?.total || "?"}` }),
    el("a", { class: "button", href: `./?r=${making.id}`, "data-nav": "", text: "See progress" }),
  ];
}

// Your retreats, one card per series (a single retreat is a series of one).
function renderGroups() {
  const groups = $("groups");
  groups.innerHTML = "";
  for (const group of seriesGroups()) {
    const prayed = group.reduce((n, r) => n + (r.days_prayed || 0), 0);
    const total = group.reduce((n, r) => n + (r.days || 0), 0);
    // A single retreat is one card; a series gets a heading with its total.
    const card = el("div", { class: "group" },
      group.length > 1 && el("div", { class: "group-head" },
        el("h3", { text: `A series of ${group.length} weeks` }),
        el("span", { class: "meta", text: total ? `${prayed} of ${total} days prayed` : "" })));
    group.forEach((r, i) => card.append(renderWeek(r, group.length > 1 ? i + 1 : null)));
    groups.append(card);
  }
}

function renderExamples() {
  $("examples").hidden = !examples.length;
  renderHiddenExamplesLink();
  // With nothing of your own yet, the examples come first.
  const head = document.querySelector("#view-library .library-head");
  if (!library.length) head.before($("examples"));
  else $("groups").after($("examples"));
  const list = $("example-list");
  list.innerHTML = "";
  for (const r of examples) {
    const prayed = r.days_prayed || 0;
    list.append(el("a", { class: "card example", href: `./?r=${r.id}`, "data-nav": "" },
      r.cover ? el("img", { src: fileUrl(r.cover), alt: "", loading: "lazy" }) : el("span"),
      el("div", { class: "example-body" },
        el("span", { class: "tag", text: r.demo?.kind === "premium" ? "Premium example" : "Free example" }),
        el("h3", { text: r.title }),
        el("span", { class: "meta", text: r.demo?.label || "" }),
        el("span", { class: "meta", text: prayed ? `${prayed} of ${r.days} days prayed` : `${r.days} days` }))));
  }
}

function renderWeek(r, weekNo) {
  const chips = el("div", { class: "chips" }, (r.day_states || []).map((d) => {
    const s = dayState(r, d);
    return el("span", { class: `mini ${s.kind}`, title: `Day ${d.day}: ${s.kind}` });
  }));
  const del = el("button", { type: "button", class: "link danger", text: "Delete" });
  confirmTwice(del, "Click again to delete", async () => {
    try {
      await api(`/api/retreats/${r.id}`, { method: "DELETE" });
      openLibrary();
    } catch (err) {
      showMessage(err.message);
    }
  });
  const status = r.status === "planning" ? "planning…" : r.status === "building" ? "being made…" : r.status === "failed" ? "failed" : "";
  const prayedLine = r.days ? `${r.days_prayed || 0} of ${r.days} days prayed` : "";
  return el("div", { class: `week${r.cover ? " with-cover" : ""}` },
    r.cover && el("a", { class: "week-cover", href: `./?r=${r.id}`, "data-nav": "", "aria-hidden": "true", tabindex: "-1" },
      el("img", { src: fileUrl(r.cover), alt: "", loading: "lazy" })),
    el("div", { class: "week-body" },
      el("a", { href: `./?r=${r.id}`, "data-nav": "", text: `${weekNo ? `Week ${weekNo} · ` : ""}${r.title}` }),
      chips,
      el("span", { class: "meta" }, [status, prayedLine, new Date(r.created_at * 1000).toLocaleDateString()].filter(Boolean).join(" · "))),
    el("span", { class: "week-actions" }, del));
}

async function upgradeGuest(event) {
  event.preventDefault();
  const email = $("upgrade-email").value.trim();
  const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
  $("upgrade-note").hidden = false;
  $("upgrade-note").textContent = error ? `Couldn't add that email: ${error.message}` : `Check ${email} and click the confirmation link. Your retreats stay with you.`;
}


// Examples someone dismissed can come back with one click.
function renderHiddenExamplesLink() {
  const link = $("show-examples");
  link.hidden = !hiddenExamples.length;
  link.textContent = hiddenExamples.length === 1 ? `Show the example "${hiddenExamples[0].title}" again` : `Show the ${hiddenExamples.length} hidden examples again`;
  link.onclick = async () => {
    await Promise.all(hiddenExamples.map((x) => postJson(`/api/retreats/${x.id}/hidden`, { hidden: false })));
    openLibrary();
  };
}
