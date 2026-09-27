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
  renderContinueCard(); // first, so the covers below can avoid its painting
  renderExamples();
  renderGroups();
  fillSeriesList();
}

const lastUsed = (r) => Math.max(Date.parse(r.last_prayed_at || 0) || 0, r.created_at * 1000);
const touched = (r) => (r.day_states || []).some((d) => d.started || d.prayed_at);

// The card at the top ("Today"): the one day most worth praying next, with its painting,
// or else a retreat being made.
let todayPick = null; // { id, day }: the retreat and day in the Today card

function renderContinueCard() {
  todayPick = null;
  const cont = $("continue");
  cont.innerHTML = "";
  cont.hidden = true;
  cont.className = "today-card";
  // Your own retreats first, then an example you've begun, then (with nothing of your own) the first example.
  const candidates = [...library].sort((a, b) => lastUsed(b) - lastUsed(a))
    .concat(examples.filter(touched), library.length ? [] : examples.filter((r) => !touched(r)));
  for (const r of candidates) {
    const pick = nextDay(r, r.day_states || []);
    if (!pick) continue;
    todayPick = { id: r.id, day: pick.d.day };
    cont.append(...todayCard(r, pick));
    cont.classList.add(`mood-${hourMood().mood}`);
    cont.hidden = false;
    fillTodayCard(r, pick.d.day); // the painting, grace and length arrive with the full retreat
    return;
  }
  const making = library.find((r) => r.status === "planning" || r.status === "building");
  if (making) {
    cont.classList.add("making");
    cont.append(...beingMadeCard(making));
    cont.hidden = false;
  }
}

function todayLead(r, { d, s }) {
  if (r.read_only && !touched(r)) return "Start here · an example retreat";
  if (s.kind === "started") return `Continue · ${dayWords(d.day)}`;
  if (s.kind === "missed") return `You missed ${dayWords(d.day)}`;
  return `${hourMood().greeting} · ${dayWords(d.day)}`;
}

function todayCard(r, pick) {
  const { d, s } = pick;
  const praying = s.kind === "started" ? "Continue praying" : "Pray this day";
  if (isExercise(d, d)) return exerciseTodayCard(r, pick);
  return [
    el("figure", { class: "today-art", id: "today-art" }, el("div", { class: "frame" })),
    el("div", { class: "today-text" },
      el("p", { class: "rubric", text: todayLead(r, pick) }),
      el("h2", { class: "today-title", text: dayTitle(d.title) || `Day ${d.day}` }),
      el("p", { class: "meta", id: "today-ref", text: `${r.series?.length ? `Week ${r.series.length + 1} · ` : ""}${r.title}${r.demo ? ` · ${r.demo.label}` : ""}` }),
      el("p", { class: "today-grace", id: "today-grace", hidden: true }),
      el("div", { class: "today-actions" },
        el("a", { class: "button gold big", id: "today-pray", href: `./?r=${r.id}&pray=${d.day}`, "data-nav": "", text: praying }),
        el("span", { class: "meta", id: "today-length" })),
      el("a", { class: "quiet-link", href: `./?r=${r.id}`, "data-nav": "", text: "Open the retreat" })),
  ];
}

// An exercise day on the Today card: nothing to pray with, only a button to mark it done.
function exerciseTodayCard(r, { d }) {
  const done = el("button", { type: "button", class: "gold big", id: "today-pray", text: "Mark as complete" });
  done.onclick = async () => {
    done.disabled = true;
    try {
      await postJson(`/api/retreats/${r.id}/days/${d.day}/prayed`, { prayed: true });
      toast(prayedToast(d.day, true, true));
      openLibrary();
    } catch (err) {
      done.disabled = false;
      showMessage(err.message);
    }
  };
  return [
    el("figure", { class: "today-art", id: "today-art" }, el("div", { class: "frame" })),
    el("div", { class: "today-text" },
      el("p", { class: "rubric", text: "Today's exercise" }),
      el("h2", { class: "today-title", text: dayTitle(d.title) || `Day ${d.day}` }),
      el("p", { class: "meta", id: "today-ref", text: r.title }),
      el("p", { class: "today-grace", id: "today-grace", hidden: true }),
      el("p", { class: "today-note", text: "Go and do this exercise today, then mark it complete." }),
      el("div", { class: "today-actions" }, done, el("span", { class: "meta", id: "today-length" })),
      el("a", { class: "quiet-link", href: `./?r=${r.id}`, "data-nav": "", text: "Open the retreat" })),
  ];
}

// The day's painting, grace and length need the whole retreat, fetched after the card shows.
async function fillTodayCard(r, dayNo) {
  let full;
  try {
    full = await api(`/api/retreats/${r.id}`);
  } catch {
    return;
  }
  const d = full.plan?.days.find((x) => x.day === dayNo);
  const st = full.days?.[String(dayNo)];
  if (!d || !$("today-art")) return;
  if (isExercise(d, st) && !$("continue").classList.contains("exercise")) {
    const cont = $("continue");
    cont.innerHTML = "";
    cont.classList.add("exercise");
    cont.append(...exerciseTodayCard(r, { d }));
  }
  const img = imagesOf(full, d)[0] || full.images?.find((x) => x.url);
  if (img) {
    const pic = el("img", { class: "drift", src: fileUrl(img.url), alt: img.description || "The painting for this day" });
    $("today-art").querySelector(".frame").append(pic);
    const pal = await paintingPalette(fileUrl(img.url));
    applyPalette($("continue"), pal);
  } else {
    $("today-art").hidden = true;
    $("continue").classList.add("no-art");
  }
  if (d.source_ref) $("today-ref").textContent = `${scriptureRef(d.source_ref)} · ${$("today-ref").textContent}`;
  if (d.grace && !isExercise(d, st)) {
    const grace = $("today-grace");
    grace.hidden = false;
    const text = d.grace.replace(/^ask for the grace\s*/i, "").replace(/^the grace\s*/i, "");
    grace.append(el("span", { class: "rubric-inline", text: "Ask for the grace " }), text);
  }
  if (st?.status === "ready" && !isExercise(d, st)) {
    const secs = totalSeconds(buildSequence(d, st));
    if (secs) $("today-length").textContent = `about ${formatMinutes(secs)}`;
  }
}

// The pictures of a day in any retreat (not only the open one).
function imagesOf(r, d) {
  const idx = d.image_indexes?.length ? d.image_indexes : d.image_index >= 0 ? [d.image_index] : [];
  return idx.map((i) => r.images?.[i]).filter((img) => img?.url);
}

function beingMadeCard(making) {
  const p = making.progress;
  const bar = el("div", { class: "build-bar compact", "aria-hidden": "true" });
  // From the summary: planning, then each day done, being made, or waiting.
  const days = making.day_states || [];
  const segments = [{ fill: making.status === "planning" ? Math.min(0.9, (Date.now() / 1000 - making.created_at) / PLANNING_SECONDS) : 1, state: making.status === "planning" ? "now" : "done" }]
    .concat(days.map((d) => ({ fill: d.status === "ready" ? 1 : d.status === "building" ? 0.5 : 0, state: d.status === "ready" ? "done" : d.status === "building" ? "now" : d.status === "failed" ? "failed" : "waiting" })));
  drawBuildBar(bar, segments);
  return [
    el("div", { class: "today-text" },
      el("p", { class: "rubric", text: "Being made" }),
      el("h2", { class: "today-title", text: making.status === "planning" ? "Your new retreat" : making.title }),
      el("p", { class: "meta", text: making.status === "planning" ? "Planning the days…" : `Day ${Math.min((p?.done || 0) + 1, p?.total || 1)} of ${p?.total || "?"}` }),
      bar,
      el("a", { class: "button", href: `./?r=${making.id}`, "data-nav": "", text: "See progress" })),
  ];
}

// Your retreats as covers, grouped by series (a series gets a heading), then a last
// cover for making a new one.
function renderGroups() {
  const groups = $("groups");
  groups.innerHTML = "";
  let order = 0;
  for (const group of seriesGroups()) {
    if (group.length > 1) {
      const prayed = group.reduce((n, r) => n + (r.days_prayed || 0), 0);
      const total = group.reduce((n, r) => n + (r.days || 0), 0);
      groups.append(el("div", { class: "series-head" },
        el("h3", { text: `A series of ${group.length} weeks` }),
        el("span", { class: "rubric small", text: total ? `${prayed} of ${total} days prayed` : "" })));
    }
    group.forEach((r, i) => groups.append(retreatCover(r, { weekNo: group.length > 1 ? i + 1 : null, order: order++ })));
  }
  if (library.length) {
    groups.append(el("a", { class: "cover new-cover", href: "./?new", "data-nav": "", style: `--i:${order}` },
      icon("newbook", 40),
      el("span", { class: "cover-title", text: "Make a new retreat" }),
      el("span", { class: "hint", text: "A handout, a few passages, or pasted text becomes a retreat with a painting for each day." })));
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
  examples.forEach((r, i) => list.append(retreatCover(r, { order: i, example: true })));
}

// A retreat's cover painting: its first, unless that's the painting already in the
// Today card above; then another day's, so the page never shows the same one twice.
function coverArt(r) {
  if (todayPick?.id !== r.id || !r.day_covers?.length) return r.cover;
  const today = r.day_covers.find((c) => c.day === todayPick.day)?.url;
  if (r.cover !== today) return r.cover;
  return r.day_covers.find((c) => c.url !== today)?.url || r.cover;
}

// One retreat as a book-like cover: its painting in an arched window, colored by it.
function retreatCover(r, { weekNo = null, order = 0, example = false } = {}) {
  const art = coverArt(r);
  const status = r.status === "planning" ? "planning…" : r.status === "building" ? "being made…" : r.status === "failed" ? "failed" : "";
  const sub = example ? (r.demo?.kind === "premium" ? "premium example" : "free example")
    : status || (r.days ? `${r.days_prayed || 0} of ${r.days} days prayed` : new Date(r.created_at * 1000).toLocaleDateString());
  const days = el("span", { class: "cover-days" }, (r.day_states || []).map((d) => {
    const s = dayState(r, d);
    return el("i", { class: s.kind, title: `Day ${d.day}: ${s.kind}` });
  }));
  const cover = el("a", { class: "cover", href: `./?r=${r.id}`, "data-nav": "", style: `--i:${order}` },
    el("span", { class: "arch" }, art ? el("img", { src: fileUrl(art), alt: "", loading: "lazy" }) : el("span", { class: "arch-empty" })),
    el("span", { class: "cover-sub", text: sub }),
    el("span", { class: "cover-title", text: `${weekNo ? `Week ${weekNo} · ` : ""}${r.title}` }),
    example && r.demo?.label && el("span", { class: "cover-note", text: r.demo.label.replace(/^Example retreat · /, "") }),
    days);
  if (art) paintingPalette(fileUrl(art)).then((pal) => pal && colorCover(cover, pal));
  if (example) return cover;
  const del = el("button", { type: "button", class: "link danger", text: "Delete" });
  confirmTwice(del, "Click again to delete", async () => {
    try {
      await api(`/api/retreats/${r.id}`, { method: "DELETE" });
      openLibrary();
    } catch (err) {
      showMessage(err.message);
    }
  });
  return el("div", { class: "cover-wrap", style: `--i:${order}` }, cover, el("span", { class: "cover-actions" }, del));
}

function colorCover(cover, pal) {
  cover.style.setProperty("--cover-bg", pal.deep);
  cover.style.setProperty("--cover-ring", pal.accent);
  cover.style.setProperty("--cover-ink", readableOn(pal.deep));
}

async function upgradeGuest(event) {
  event.preventDefault();
  const email = $("upgrade-email").value.trim();
  const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
  const taken = error && /already (been )?registered|already exists/i.test(error.message);
  $("upgrade-note").hidden = false;
  $("upgrade-note").textContent = taken
    ? `${email} already has an account. Sign in to it instead (what you made as a guest stays in this guest session).`
    : error ? `Couldn't add that email: ${error.message}` : `Check ${email} and click the confirmation link. Your retreats stay with you.`;
  $("upgrade-signin").hidden = !taken;
}

// Leave the guest session for a real account: sign out, then email the link and show
// the box to paste it into.
async function guestToSignIn(email) {
  await sb.auth.signOut();
  showSignedOut();
  if (email) await sendLinkTo(email);
  else $("email").focus();
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
