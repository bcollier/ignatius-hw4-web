// ================================================================ retreat

async function openRetreat(id, prayDay) {
  show("retreat");
  if (retreat?.id !== id) {
    retreat = null;
    selectedDay = null;
    $("retreat-title").textContent = "";
    $("days-area").hidden = true;
    $("progress").hidden = true;
    stopQuotes($("build-quote"));
  }
  try {
    retreat = await api(`/api/retreats/${id}`);
  } catch (err) {
    return showMessage(err.message);
  }
  if (!library.length) api("/api/retreats").then((b) => { library = b.retreats; }).catch(() => {});
  const linkedDay = Number(params().get("day")); // ./?r=ID&day=N, e.g. from a calendar event
  if (linkedDay) selectedDay = linkedDay;
  renderRetreat();
  if (prayDay) startPrayer(Number(prayDay));
  schedulePoll();
}

const busy = () =>
  retreat && (retreat.status === "planning" || retreat.status === "building" ||
    Object.values(retreat.days).some((d) => d.status === "building" || d.status === "queued"));

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!busy()) return;
  pollTimer = setTimeout(async () => {
    if (!retreat || params().get("r") !== retreat.id) return;
    const wasMaking = retreat.status !== "ready";
    try {
      retreat = await api(`/api/retreats/${retreat.id}`);
    } catch (err) {
      showMessage(err.message);
    }
    if (!document.body.classList.contains("praying")) renderRetreat();
    if (wasMaking && retreat.status === "ready") retreatReady();
    schedulePoll();
  }, POLL_MS);
}

function retreatReady() {
  toast("Your retreat is ready to pray.");
  if (store.get("notify") && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Your retreat is ready", { body: retreat.plan?.title || "", icon: "icons/icon-192.png" });
    } catch {}
  }
}

const planDay = (n) => retreat.plan?.days.find((d) => d.day === n);

function renderRetreat() {
  const plan = retreat.plan;
  // Until the plan has a title, a plain name, with the uploaded file under it.
  $("retreat-title").textContent = plan?.title || "Your new retreat";
  $("retreat-file").hidden = !!plan?.title;
  $("retreat-file").textContent = plan?.title ? "" : retreat.filename || "";
  document.title = `${plan?.title || "Retreat"} · Ignatius at Home`;
  renderSeriesLine();
  renderHeaderButtons(plan);
  renderFootLinks(plan);
  $("retreat-error").hidden = retreat.status !== "failed";
  $("retreat-error").textContent = retreat.status === "failed" ? `Making this retreat failed: ${retreat.error}` : "";
  // While planning or building, the progress card; afterwards, the days.
  const making = retreat.status === "planning" || retreat.status === "building";
  $("progress").hidden = !making;
  if (!making) stopQuotes($("build-quote"));
  if (making) renderProgress();
  renderIntroduction(plan, making);
  $("days-area").hidden = !plan || making;
  if (plan && !making) {
    renderStrip();
    renderDay();
  }
}

function renderSeriesLine() {
  const series = retreat.series?.length;
  $("retreat-series").hidden = !series;
  if (!series) return;
  const titles = retreat.series.map((id) => library.find((r) => r.id === id)?.title).filter(Boolean);
  $("retreat-series").textContent = `Week ${retreat.series.length + 1} of a series${titles.length ? `, after ${titles.join(" → ")}` : ""}.`;
}

function renderHeaderButtons(plan) {
  // The whole-retreat PDF only once the retreat is finished (each day has its own PDF link sooner).
  const written = Object.values(retreat.days).some((d) => d.tracks?.heart?.script && d.tracks?.deep?.script);
  $("retreat-pdf").hidden = !written || retreat.status !== "ready" || busy();
  showTalkButton(!!options.talk?.enabled && !!plan);
  const ro = !!retreat.read_only;
  $("example-note").hidden = !ro;
  $("example-note").textContent = ro ? `${retreat.demo?.label || "An example retreat"}. It's ready to listen to and pray; your progress and notes are yours alone. ` : "";
  if (ro) $("example-note").append(el("button", { type: "button", class: "link", text: "Remove it from my home page", onclick: hideThisExample }));
}

// The build log and research notes, tucked away at the foot of the page (on a computer).
function renderFootLinks(plan) {
  const inProgress = busy();
  // The build log opens by itself while a retreat you chose to watch is being made.
  if (debugMode() && inProgress && (store.get(`watch.${retreat.id}`) || store.get("watchBuild")) && !logState) openLog(retreat.id);
  if (logState && logState.rid !== retreat.id) closeLog();
  $("log-link").hidden = !debugMode() || !plan || inProgress;
  $("log-toggle").hidden = !debugMode();
}

function renderProgress() {
  renderBuildBar();
  const planning = retreat.status === "planning";
  const p = retreat.progress;
  $("progress-title").textContent = planning ? "Planning your retreat" : "Writing and recording each day";
  $("progress-lede").textContent = planning
    ? `Reading ${retreat.filename} and planning the days. This takes a few minutes.`
    : `Day ${Math.min((p?.done || 0) + 1, p?.total || 1)} of ${p?.total}. Each day takes a few minutes.`;
  const list = $("progress-days");
  list.innerHTML = "";
  for (const d of retreat.plan?.days || []) {
    const st = retreat.days[String(d.day)];
    const cls = st.status === "ready" ? "done" : st.status === "building" ? "now" : st.status === "failed" ? "failed" : "";
    let detail = "";
    if (st.status === "building") {
      const parts = Object.entries(st.tracks || {}).map(([k, t]) => `${TRACK_LABELS[k]}: ${STATUS_WORDS[t.status] || t.status}`);
      const g = Object.values(st.guide || {});
      if (g.length) parts.push(`guidance: ${g.filter((c) => c.status === "ready").length} of ${g.length}`);
      detail = parts.join(" · ");
    } else if (st.status === "failed") detail = st.error || "failed";
    else if (st.status === "queued") detail = "waiting its turn";
    list.append(el("li", { class: cls },
      el("span", { class: "mark" }, st.status === "ready" ? icon("check", 14) : st.status === "failed" ? "!" : ""),
      el("span", {}, `Day ${d.day} · ${dayTitle(d.title)}`, detail && el("span", { class: "detail", text: detail }))));
  }
  $("notify-button").hidden = !("Notification" in window) || Notification.permission !== "default";
}

function renderStrip() {
  const strip = $("day-strip");
  strip.innerHTML = "";
  const days = retreat.plan.days;
  if (!selectedDay || !planDay(selectedDay)) {
    const pick = nextDay(retreat, days.map((d) => ({ ...retreat.days[String(d.day)], day: d.day })));
    selectedDay = pick?.d.day || days[0].day;
  }
  for (const d of days) {
    const s = dayState(retreat, { ...retreat.days[String(d.day)], day: d.day });
    const chip = el("button", {
      type: "button", role: "tab", class: `chip ${s.kind}${s.today ? " today" : ""}`,
      "aria-selected": d.day === selectedDay ? "true" : "false",
      title: `${dayTitle(d.title)} · ${s.kind}${s.today ? " · today" : ""}`,
    }, el("span", { text: String(d.day) }), el("small", { text: s.date ? weekday(s.date) : "" }));
    chip.onclick = () => {
      selectedDay = d.day;
      renderStrip();
      renderDay();
    };
    strip.append(chip);
  }
}

function dayImages(d) {
  const idx = d.image_indexes?.length ? d.image_indexes : d.image_index >= 0 ? [d.image_index] : [];
  return idx.map((i) => retreat.images[i]).filter((img) => img?.url);
}

// The selected day as a two-page spread: the painting on the left page, and on the
// right the day's words, where you are with it, and what you can do.
function renderDay() {
  const d = planDay(selectedDay);
  const st = retreat.days[String(d.day)];
  const s = dayState(retreat, { ...st, day: d.day });
  const panel = $("day-panel");
  panel.innerHTML = "";
  const img = dayImages(d)[0];
  panel.classList.toggle("no-art", !img);
  if (img) panel.append(dayArt(img));
  if (isExercise(d, st) && st.status === "ready") {
    panel.append(exercisePage(d, st, s));
    return colorDay(img);
  }
  const page = el("div", { class: "page-text", "data-hl-day": d.day }, lastPrayedLine(st), ...dayHeading(d, s));
  const line = listeningLine(st, s);
  if (line) page.append(el("p", { class: `state-line ${s.kind === "missed" ? "missed" : ""}`, text: line }));
  page.append(...dayActions(d, st, s));
  if (st.journal?.word || st.journal?.note) page.append(journalBox(st.journal));
  const tracks = Object.keys(TRACK_LABELS).filter((k) => st.tracks?.[k]?.status === "ready");
  if (tracks.length) {
    const parts = el("details", { class: "parts" }, el("summary", { text: "Listen to a part" }));
    for (const k of tracks) parts.append(renderTrack(k, st.tracks[k]));
    page.append(parts);
  }
  panel.append(page);
  colorDay(img);
}

// The left page: the painting (drifting slowly), a museum caption, and its colors.
function dayArt(img) {
  const caption = (img.description || "The painting for this day").split(/(?<=\.)\s/)[0];
  return el("figure", { class: "page-art" },
    el("div", { class: "frame" }, el("img", { class: "drift", src: fileUrl(img.url), alt: img.description || "The painting for this day" })),
    el("figcaption", {}, el("span", { text: caption })));
}

// The day's colors, taken from its painting, quietly tint the retreat page and the day strip.
async function colorDay(img) {
  const view = $("view-retreat");
  if (!img) return applyPalette(view, null);
  const pal = await paintingPalette(fileUrl(img.url));
  if (planDay(selectedDay) && dayImages(planDay(selectedDay))[0]?.url !== img.url) return; // another day was chosen meanwhile
  applyPalette(view, pal);
}

function dayHeading(d, s) {
  const head = [retreat.plan.title, dayWords(d.day), s.date ? longWeekday(s.date) : "", s.today ? "today" : ""].filter(Boolean).join(" · ");
  const out = [
    el("p", { class: "running-head", text: head }),
    el("h2", { class: "day-title", text: dayTitle(d.title) }),
  ];
  // The reference only when it says something the title doesn't.
  if (d.source_ref) out.push(el("p", { class: "meta source-ref", text: scriptureRef(d.source_ref) }));
  if (d.grace) {
    const text = d.grace.replace(/^ask for the grace\s*/i, "").replace(/^the grace\s*/i, "");
    out.push(el("p", { class: "grace" }, el("span", { class: "rubric-inline", text: "The grace " }), text));
  }
  out.push(el("p", { class: "fleuron", "aria-hidden": "true" }, icon("fleuron", 22)));
  out.push(el("p", { class: "passage", "data-hl-part": "passage", text: d.passage_text }));
  return out;
}

// An exercise day: the handout's instruction, to go and do, then mark complete.
function exercisePage(d, st, s) {
  const head = [retreat.plan.title, dayWords(d.day), s.date ? longWeekday(s.date) : "", s.today ? "today" : ""].filter(Boolean).join(" · ");
  const page = el("div", { class: "page-text exercise", "data-hl-day": d.day }, lastPrayedLine(st),
    el("p", { class: "running-head", text: head }),
    el("p", { class: "rubric", text: s.today || !s.date ? "Today's exercise" : "An exercise" }),
    el("h2", { class: "day-title", text: dayTitle(d.title) }),
    d.source_ref && el("p", { class: "meta source-ref", text: scriptureRef(d.source_ref) }),
    el("p", { class: "exercise-text", text: d.passage_text }));
  if (s.prayed) {
    page.append(el("p", { class: "state-line done", text: `Completed · ${longDate(st.prayed_at)}` }),
      el("div", { class: "quiet-row" },
        el("button", { type: "button", class: "link", text: "Mark as not complete", onclick: () => markPrayed(d.day, { prayed: false }) })));
  } else {
    if (/dossier|life.?s faith story/i.test(`${d.title} ${d.passage_text}`)) {
      page.append(el("p", { class: "state-line", text: "There's a guided version: a voice leads you through your life's faith story, with time to write after each question (thirty minutes)." }),
        el("div", { class: "pray-row" }, el("a", { class: "button gold", href: "./?practice=dossier", "data-nav": "", text: "Do the guided exercise" })));
    }
    page.append(el("p", { class: "state-line", text: "Go and do this exercise today, then mark it complete." }),
      el("div", { class: "pray-row" },
        el("button", { type: "button", class: "big gold", text: "Mark as complete", onclick: (e) => { e.target.disabled = true; markPrayed(d.day, { prayed: true }); } })));
  }
  if (st.journal?.word || st.journal?.note) page.append(journalBox(st.journal));
  return page;
}

function listeningLine(st, s) {
  const l = st.listening;
  if (s.prayed) return ""; // "Last prayed …" at the top of the day says it
  if (s.kind === "started") return `You listened as far as ${l.last_part || "part of it"} on ${longDate(l.updated_at)}, then stopped.`;
  if (s.kind === "missed") return "You haven't prayed this day yet.";
  return "";
}

// What can be done with the day depends on where it is: ready, failed, not made, or being made.
function dayActions(d, st, s) {
  if (st.status === "ready") return readyDayActions(d, st, s);
  if (st.status === "failed") return failedDayActions(d, st);
  if (st.status === "idle") {
    return [el("div", { class: "pray-row" }, el("button", { type: "button", text: "Make this day", onclick: () => rebuildDay(d.day, false) }))];
  }
  return [el("p", { class: "state-line", text: "This day is being made…" })];
}

function readyDayActions(d, st, s) {
  const seq = buildSequence(d, st);
  const total = totalSeconds(seq);
  const l = st.listening;
  const pray = (from) => () => go(`?r=${retreat.id}&pray=${d.day}&from=${from}`);
  const row = el("div", { class: "pray-row" });
  if (s.kind === "started" && l?.last_step > 0) {
    row.append(el("button", { type: "button", class: "big gold", onclick: pray("resume") }, icon("play", 18), " Continue praying"));
    row.append(el("button", { type: "button", class: "secondary icon-text", title: "Start from the beginning", onclick: pray("start") }, icon("restart", 18), " Start over"));
  } else {
    row.append(el("button", { type: "button", class: "big gold", text: "Pray this day", onclick: pray("start") }));
  }
  row.append(el("span", { class: "meta", text: total == null ? "" : `About ${formatMinutes(total)}` }));
  if (total == null) probeDurations(seq); // the length appears once the clips' durations are known
  return [row, el("div", { class: "quiet-row" },
    el("button", { type: "button", class: "link", text: s.prayed ? "Mark as not prayed" : "Mark as prayed", onclick: () => markPrayed(d.day, { prayed: !s.prayed }) }),
    s.prayed && el("a", { class: "link", href: googleCalendarLink(d, st), target: "_blank", rel: "noopener", text: "Add to Google Calendar" }),
    el("button", { type: "button", class: "link", text: "Printable script (PDF)", onclick: (e) => downloadScript(d.day, e.target) }),
    el("a", { class: "link desktop-only", href: `./?r=${retreat.id}&research#research-day-${d.day}`, "data-nav": "", text: "Research notes" }),
    dayMenu(d, st))];
}

function failedDayActions(d, st) {
  // When every failed part still has its script, only those parts are recorded again.
  const clips = [...Object.values(st.tracks || {}), ...Object.values(st.guide || {})];
  const fromScripts = !retreat.read_only && st.params && clips.every((c) => c.status === "ready" || c.script);
  return [
    el("p", { class: "state-line missed", text: `Making this day didn't finish: ${st.error || "unknown error"}` }),
    el("div", { class: "pray-row" },
      !retreat.read_only && el("button", { type: "button", text: "Try again", onclick: () => (fromScripts ? retryDay(d.day) : rebuildDay(d.day, false)) }),
      fromScripts && el("span", { class: "hint", text: "Only the parts that failed are recorded again." }),
      dayMenu(d, st)),
  ];
}

function journalBox(journal) {
  return el("div", { class: "journal" },
    journal.word && el("p", {}, el("strong", { text: "The word that stayed: " }), journal.word),
    journal.note && el("p", { text: journal.note }));
}

function renderTrack(key, track) {
  const box = el("div", { class: "track" }, el("h4", { text: `${TRACK_LABELS[key]}${track.seconds ? ` · ${formatClock(track.seconds)}` : ""}` }));
  box.append(el("audio", { controls: true, preload: "none", src: fileUrl(track.url), onplay: (e) => atVoiceSpeed(e.target) }));
  const details = el("details", {}, el("summary", { text: track.trimmed ? "Script (trimmed to fit)" : "Script" }), el("p", { class: "script", "data-hl-part": key, text: track.script }));
  if (track.sources?.length) {
    details.append(el("p", { class: "meta", text: track.web_search ? `Sources checked with web search${track.research ? ` (${track.research})` : ""}:` : "Sources suggested by the model, not checked:" }));
    details.append(el("ul", { class: "sources" }, track.sources.map((line) => {
      const url = line.match(/https?:\/\/\S+/)?.[0];
      return el("li", {}, url ? el("a", { href: url, target: "_blank", rel: "noopener", text: line }) : line);
    })));
  }
  box.append(details);
  return box;
}

function dayMenu(d, st) {
  const wrap = el("span", { class: "menu" });
  const btn = el("button", { type: "button", class: "link", text: "More…", "aria-expanded": "false" });
  const list = el("div", { class: "menu-list", hidden: true });
  const close = () => {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    btn.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden) document.addEventListener("click", close, { once: true });
  };
  const item = (text, fn) => list.append(el("button", { type: "button", text, onclick: () => { close(); fn(); } }));
  if (!retreat.read_only) {
    if (st.tracks?.heart?.script) item("Re-record with other voices…", () => openRebuild(d.day, true));
    item("Rewrite and record this day…", () => openRebuild(d.day, false));
  }
  if (!list.children.length) return el("span");
  if (st.journal || st.prayed_at) item("Edit what I noted…", () => showAfter(d.day, st.journal));
  wrap.append(btn, list);
  return wrap;
}

// ---------------------------------------------------------------- marking, rebuilding, prayer settings

// The little confirmation after marking a day: "Day 3 marked as prayed."
function prayedToast(day, prayed, exercise) {
  const done = exercise ? "complete" : "prayed";
  return prayed ? `Day ${day} marked as ${done}.` : `Day ${day} marked as not ${done}.`;
}

async function markPrayed(day, body) {
  try {
    retreat = await postJson(`/api/retreats/${retreat.id}/days/${day}/prayed`, body);
    if (params().get("r")) renderRetreat();
    toast(prayedToast(day, body.prayed, isExercise(retreat.plan?.days?.find((d) => d.day === day) || {}, retreat.days?.[String(day)] || {})));
  } catch (err) {
    showMessage(err.message);
  }
}

function openRebuild(day, keep) {
  $("settings-title").textContent = keep ? `Re-record Day ${day}` : `Rewrite Day ${day}`;
  $("settings-lede").textContent = keep
    ? "Choose voices; the reflection, deep dive and guidance stay as written."
    : "The reflection, deep dive and guidance are written again with these options, then recorded.";
  $("settings-slot").append($("advanced"));
  const primary = $("settings-primary");
  primary.hidden = false;
  primary.textContent = keep ? "Re-record" : "Rewrite and record";
  primary.onclick = () => {
    $("settings-dialog").close();
    rebuildDay(day, keep);
  };
  $("settings-secondary").hidden = true;
  $("settings-dialog").showModal();
}

async function rebuildDay(day, keep) {
  try {
    retreat = await postJson(`/api/retreats/${retreat.id}/days/${day}/build`, buildOptions(keep));
    renderRetreat();
    schedulePoll();
  } catch (err) {
    showMessage(err.message);
  }
}

async function retryDay(day) {
  try {
    retreat = await postJson(`/api/retreats/${retreat.id}/days/${day}/retry`, {});
    renderRetreat();
    schedulePoll();
  } catch (err) {
    showMessage(err.message);
  }
}

function openPlaybackSettings() {
  $("settings-title").textContent = "Prayer settings";
  $("settings-lede").textContent = "How the prayer is played. These cost nothing to change.";
  $("settings-slot").append($("playback-fields"));
  $("start-date").value = retreat?.start_date || localToday();
  $("start-date").onchange = async () => {
    if (!retreat) return;
    try {
      retreat = await postJson(`/api/retreats/${retreat.id}`, { start_date: $("start-date").value }, "PATCH");
      renderRetreat();
    } catch (err) {
      showMessage(err.message);
    }
  };
  $("settings-primary").hidden = true;
  $("settings-secondary").hidden = true;
  $("settings-dialog").showModal();
}

$("settings-dialog").addEventListener("close", () => {
  const adv = $("advanced");
  const pf = $("playback-fields");
  if (pf.parentElement === $("settings-slot")) adv.querySelectorAll("fieldset")[1].after(pf);
  if (adv.parentElement === $("settings-slot")) $("panel-advanced").append(adv);
  $("start-date").onchange = null;
});

// ================================================================ pdf

async function downloadScript(day, button) {
  const { order, graceGaps, pause } = playback();
  const q = new URLSearchParams({ order, pause: String(pause), grace_silence: String(graceGaps * 5) });
  if (day != null) q.set("day", day);
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Making the PDF…";
  try {
    const response = await fetch(`${API}/api/retreats/${retreat.id}/script.pdf?${q}`, { headers: await authHeaders() });
    if (!response.ok) {
      let message = `The server returned an error (${response.status}).`;
      try {
        message = (await response.json()).error.message;
      } catch {}
      throw new Error(message);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = el("a", { href: url, target: "_blank", download: (response.headers.get("Content-Disposition") || "").match(/filename="(.+)"/)?.[1] || "retreat.pdf" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    showMessage(err.message.startsWith("Failed to fetch") ? "Can't reach the server. Try again shortly." : err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}


// "Talk it over": the button arrives with a glow, and the first time someone sees it
// the explanation opens by itself for a few seconds (after that, on hover or focus).
function showTalkButton(show) {
  const cta = $("talk-cta");
  const wasHidden = cta.hidden;
  cta.hidden = !show;
  if (!show || !wasHidden) return;
  cta.classList.remove("arrive");
  void cta.offsetWidth; // restart the entrance animation
  cta.classList.add("arrive");
  if (!store.get("talkIntroSeen") && retreat.status === "ready") { // not over the progress while it is being made
    store.set("talkIntroSeen", true);
    setTimeout(() => cta.classList.add("intro"), 900);
    setTimeout(() => cta.classList.remove("intro"), 9000);
  }
}


// An example can be taken off the home page (it stays available from "Show … again").
async function hideThisExample() {
  try {
    await postJson(`/api/retreats/${retreat.id}/hidden`, { hidden: true });
    toast("Removed from your home page.");
    go("");
  } catch (err) {
    showMessage(err.message);
  }
}


// ---------------------------------------------------------------- the build, as a bar
// One segment for planning, then one per day. Each day fills in eight steps as its parts
// are written and recorded, so the bar moves on every poll.

const PLANNING_SECONDS = 180; // planning usually takes a few minutes; the first segment fills toward 90% meanwhile
const DAY_STEPS = 8;
const WRITTEN = new Set(["speaking", "ready"]);

// How many of a day's eight steps are done, and what it's doing now.
function dayBuildSteps(st) {
  if (!st || st.status === "queued" || st.status === "idle") return { done: 0, doing: "" };
  if (st.status === "ready") return { done: DAY_STEPS, doing: "" };
  const t = st.tracks || {};
  const guide = Object.values(st.guide || {});
  const guideWritten = guide.some((c) => c.script || (c.status && c.status !== "waiting"));
  const guideReady = guide.length ? guide.filter((c) => c.status === "ready").length / guide.length : 0;
  let done = 0;
  if (t.reading?.status === "ready") done += 1;
  if (WRITTEN.has(t.heart?.status)) done += 1;
  if (t.heart?.status === "ready") done += 1;
  if (WRITTEN.has(t.deep?.status)) done += 2;
  if (t.deep?.status === "ready") done += 1;
  if (guideWritten) done += 1;
  done += guideReady;
  let doing = "";
  if (t.heart?.status === "writing") doing = "writing the reflection for the heart";
  else if (t.deep?.status === "writing") doing = "researching and writing the deep dive";
  else if (t.heart?.status === "speaking") doing = "recording the reflection";
  else if (t.deep?.status === "speaking") doing = "recording the deep dive";
  else if (WRITTEN.has(t.deep?.status) && !guideWritten) doing = "tailoring the spoken guidance";
  else if (guideWritten && guideReady < 1) doing = "recording the guidance";
  else if (t.reading?.status === "speaking") doing = "recording the reading";
  return { done: Math.min(done, DAY_STEPS), doing, failed: st.status === "failed" };
}

// The segments (each 0..1 full), where the build is, and a line saying so.
function buildProgressOf(r) {
  const planned = !!r.plan;
  const elapsed = Math.max(0, Date.now() / 1000 - (r.created_at || Date.now() / 1000));
  const planFill = planned ? 1 : Math.min(0.9, elapsed / PLANNING_SECONDS);
  const segments = [{ fill: planFill, state: planned ? "done" : "now", label: "Planning" }];
  let stepsDone = planned ? 1 : 0;
  let line = planned ? "" : "Planning the days";
  for (const d of r.plan?.days || []) {
    const st = r.days?.[String(d.day)];
    const { done, doing, failed } = dayBuildSteps(st);
    stepsDone += Math.floor(done);
    const state = failed ? "failed" : done >= DAY_STEPS ? "done" : st?.status === "building" ? "now" : "waiting";
    segments.push({ fill: done / DAY_STEPS, state, label: `Day ${d.day}` });
    if (state === "now" && !line) line = `Day ${d.day} · ${doing || "starting"}`;
  }
  const totalSteps = 1 + (r.plan?.days.length || 0) * DAY_STEPS;
  const percent = Math.round((segments.reduce((n, s) => n + s.fill, 0) / segments.length) * 100);
  const step = Math.min(stepsDone + 1, totalSteps);
  return { segments, percent, text: planned ? `Step ${step} of ${totalSteps}${line ? ` · ${line}` : ""}` : line };
}

function drawBuildBar(bar, segments) {
  if (bar.children.length !== segments.length) {
    bar.innerHTML = "";
    for (const s of segments) bar.append(el("span", { class: "seg", title: s.label }, el("i")));
  }
  segments.forEach((s, i) => {
    const seg = bar.children[i];
    seg.className = `seg ${s.state}`;
    seg.firstChild.style.width = `${Math.round(s.fill * 1000) / 10}%`;
  });
}

// What's happening right now, in a line: the server's live activity ("Planning day 4:
// The Lost Sheep", "Day 2: turning the deep dive into voice"). While a model plans in one
// long reply that can't be followed, the stages of planning take turns instead.
const PLANNING_STAGES = [
  "Reading your document",
  "Finding where each day begins",
  "Copying each day's passage, word for word",
  "Choosing a grace to ask for on each day",
  "Finding a focus for each day's prayer",
  "Matching the paintings to the days",
  "Writing a short summary of the retreat",
];
const GENERIC_PLANNING = /^(Reading your document|Deciding how the days will go)$/;

function buildNowLine(r) {
  const a = r.activity;
  const fresh = a && Date.now() / 1000 - a.at < 120;
  if (r.status === "planning" && (!fresh || GENERIC_PLANNING.test(a.text))) {
    const turn = Math.floor((Date.now() / 1000 - (r.created_at || 0)) / 7);
    return PLANNING_STAGES[turn % PLANNING_STAGES.length] + "…";
  }
  return fresh ? `${a.text}…` : "";
}

function renderBuildNow() {
  const line = $("build-now");
  const text = buildNowLine(retreat);
  if (line.textContent === text) return;
  line.textContent = text;
  line.classList.remove("changed");
  void line.offsetWidth; // restart the fade
  line.classList.add("changed");
}

function renderBuildBar() {
  renderBuildNow();
  const quote = $("build-quote");
  if (!quote.dataset.started) showQuotes(quote, 20); // words to wait with, until the retreat is ready
  const p = buildProgressOf(retreat);
  drawBuildBar($("build-bar"), p.segments);
  $("build-bar").setAttribute("aria-valuenow", String(p.percent));
  $("build-step").textContent = `${p.text} · ${p.percent}%`;
}


// The handout's own front matter (a week's introduction and its graces), word for word,
// before Day 1. Open until the first day is prayed; then folded, a tap away.
function renderIntroduction(plan, making) {
  const intro = plan?.introduction;
  const box = $("retreat-intro");
  box.hidden = !intro || making;
  if (box.hidden) return;
  const onlyGraces = !intro.text;
  $("retreat-intro-title").textContent = onlyGraces ? "This week's graces" : "Before you begin: the introduction";
  const body = $("retreat-intro-body");
  body.replaceChildren(
    ...(intro.text ? intro.text.split(/\n{2,}/).map((p) => el("p", { text: p })) : []),
    intro.graces ? el("p", { class: "grace" }, el("span", { class: "rubric-inline", text: "I pray for the following graces: " }), intro.graces) : "");
  const key = `intro.open.${retreat.id}`;
  const firstPrayed = !!retreat.days?.["1"]?.prayed_at;
  box.open = store.get(key, !firstPrayed);
  box.ontoggle = () => store.set(key, box.open);
}


// "Last prayed Monday, September 28, 2026" at the top of a day: kept even if the day is
// later unmarked (the server remembers each date it was prayed).
const fullDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

function lastPrayedLine(st) {
  const when = st.last_prayed_at || st.prayed_at;
  if (!when) return "";
  const times = (st.prayed_log || []).length;
  return el("p", { class: "last-prayed" }, icon("check", 16), ` Last prayed ${fullDate(when)}${times > 1 ? ` · prayed ${times} times` : ""}`);
}

// A prefilled all-day event in Google Calendar, one tap to save (no sign-in to the app needed).
function dayEventTitle(d) {
  const week = retreat.series?.length ? `Week ${retreat.series.length + 1}` : retreat.plan.title;
  return `Prayed · ${week} · Day ${d.day} · ${dayTitle(d.title)}`;
}

function googleCalendarLink(d, st) {
  const day = new Date(st.last_prayed_at || st.prayed_at || Date.now());
  const ymd = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const link = new URL(`./?r=${retreat.id}&day=${d.day}`, location.href).href;
  const q = new URLSearchParams({ action: "TEMPLATE", text: dayEventTitle(d), dates: `${ymd(day)}/${ymd(next)}`,
    details: `${retreat.plan.title}\nThis day: ${link}\nIgnatius at Home: ${new URL("./", location.href).href}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}
