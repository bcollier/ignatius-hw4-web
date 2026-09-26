// ================================================================ retreat

async function openRetreat(id, prayDay) {
  show("retreat");
  if (retreat?.id !== id) {
    retreat = null;
    selectedDay = null;
    $("retreat-title").textContent = "";
    $("days-area").hidden = true;
    $("progress").hidden = true;
  }
  try {
    retreat = await api(`/api/retreats/${id}`);
  } catch (err) {
    return showMessage(err.message);
  }
  if (!library.length) api("/api/retreats").then((b) => { library = b.retreats; }).catch(() => {});
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
  $("retreat-title").textContent = plan?.title || retreat.filename;
  document.title = `${plan?.title || "Retreat"} · Ignatius at Home`;
  renderSeriesLine();
  renderHeaderButtons(plan);
  renderFootLinks(plan);
  $("retreat-error").hidden = retreat.status !== "failed";
  $("retreat-error").textContent = retreat.status === "failed" ? `Making this retreat failed: ${retreat.error}` : "";
  // While planning or building, the progress card; afterwards, the days.
  const making = retreat.status === "planning" || retreat.status === "building";
  $("progress").hidden = !making;
  if (making) renderProgress();
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
  $("example-note").textContent = ro ? `${retreat.demo?.label || "An example retreat"}. It's ready to listen to and pray; your progress and notes are yours alone.` : "";
}

// The build log and research notes, tucked away at the foot of the page (on a computer).
function renderFootLinks(plan) {
  const inProgress = busy();
  // The build log opens by itself while a retreat you chose to watch is being made.
  if (inProgress && (store.get(`watch.${retreat.id}`) || store.get("watchBuild")) && !logState) openLog(retreat.id);
  if (logState && logState.rid !== retreat.id) closeLog();
  $("log-link").hidden = !plan || inProgress;
  $("research-link").hidden = !plan || inProgress;
  $("research-link").href = `./?r=${retreat.id}&research`;
}

function renderProgress() {
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
      el("span", { class: "mark", text: st.status === "ready" ? "✓" : st.status === "failed" ? "!" : "" }),
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
    }, el("span", { text: String(d.day) }), el("small", { text: s.kind === "prayed" ? "✓" : s.date ? weekday(s.date) : "" }));
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

// The selected day: its passage and picture, where you are with it, and what you can do.
function renderDay() {
  const d = planDay(selectedDay);
  const st = retreat.days[String(d.day)];
  const s = dayState(retreat, { ...st, day: d.day });
  const panel = $("day-panel");
  panel.innerHTML = "";
  panel.append(...dayHeading(d, s));
  const line = listeningLine(st, s);
  if (line) panel.append(el("p", { class: `state-line ${s.kind === "missed" ? "missed" : ""}`, text: line }));
  panel.append(...dayActions(d, st, s));
  if (st.journal?.word || st.journal?.note) panel.append(journalBox(st.journal));
  const tracks = Object.keys(TRACK_LABELS).filter((k) => st.tracks?.[k]?.status === "ready");
  if (tracks.length) {
    const parts = el("details", { class: "parts" }, el("summary", { text: "Listen to a part" }));
    for (const k of tracks) parts.append(renderTrack(k, st.tracks[k]));
    panel.append(parts);
  }
}

function dayHeading(d, s) {
  const out = [
    el("p", { class: "meta", text: `Day ${d.day}${s.date ? ` · ${longDate(`${s.date}T12:00:00`)}` : ""}${s.today ? " · today" : ""}` }),
    el("h2", { text: dayTitle(d.title) }),
  ];
  // The reference only when it says something the title doesn't.
  if (d.source_ref && d.source_ref.trim() !== dayTitle(d.title).trim()) out.push(el("p", { class: "meta", text: d.source_ref }));
  const img = dayImages(d)[0];
  if (img) out.push(el("img", { class: "day-image", src: fileUrl(img.url), alt: img.description || "Image for this day" }));
  if (d.grace) out.push(el("p", { class: "grace", text: `Grace: ${d.grace}` }));
  out.push(el("p", { class: "passage", text: d.passage_text }));
  return out;
}

function listeningLine(st, s) {
  const l = st.listening;
  if (s.prayed) return `Prayed ${longDate(st.prayed_at)}.`;
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
  const pray = (from) => () => go(`?r=${retreat.id}&pray=${d.day}${from ? `&from=${from}` : ""}`);
  const row = el("div", { class: "pray-row" });
  if (s.kind === "started" && l?.last_step > 0) {
    row.append(el("button", { type: "button", class: "big", text: "Continue praying", onclick: pray(l.last_step) }));
    row.append(el("button", { type: "button", class: "secondary", text: "Start over", onclick: pray() }));
  } else {
    row.append(el("button", { type: "button", class: "big", text: "Pray this day", onclick: pray() }));
  }
  row.append(el("span", { class: "meta", text: total == null ? "" : `About ${formatMinutes(total)}` }));
  if (total == null) probeDurations(seq); // the length appears once the clips' durations are known
  return [row, el("div", { class: "quiet-row" },
    el("button", { type: "button", class: "link", text: s.prayed ? "Mark as not prayed" : "Mark as prayed", onclick: () => markPrayed(d.day, { prayed: !s.prayed }) }),
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
  box.append(el("audio", { controls: true, preload: "none", src: fileUrl(track.url) }));
  const details = el("details", {}, el("summary", { text: track.trimmed ? "Script (trimmed to fit)" : "Script" }), el("p", { class: "script", text: track.script }));
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

async function markPrayed(day, body) {
  try {
    retreat = await postJson(`/api/retreats/${retreat.id}/days/${day}/prayed`, body);
    if (params().get("r")) renderRetreat();
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
  if (!store.get("talkIntroSeen")) {
    store.set("talkIntroSeen", true);
    setTimeout(() => cta.classList.add("intro"), 900);
    setTimeout(() => cta.classList.remove("intro"), 9000);
  }
}
