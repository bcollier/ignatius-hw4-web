// ================================================================ praying

let steps = [];
let stepIndex = 0;
let prayerDay = null;
let partsPlayed = new Set();
let lastReport = 0;
let wakeLock = null;
let imageTimer = null;
let shownImage = -1;
const SOUND_SECONDS = {
  "sounds/bell.mp3": 7.05, "sounds/quiet5.mp3": 5.07, "sounds/quiet30.mp3": 30.07,
  "sounds/quiet1_5.mp3": 1.5, "sounds/quiet2_5.mp3": 2.5, "sounds/quiet3.mp3": 3, "sounds/quiet4.mp3": 4,
};
// The pause between parts: a short breath after a guidance line (it leads straight
// into what follows) and a longer one to settle after a reading, reflection or deep dive.
const PAUSES = {
  short: { breath: "sounds/quiet1_5.mp3", settle: "sounds/quiet3.mp3" },
  medium: { breath: "sounds/quiet2_5.mp3", settle: "sounds/quiet4.mp3" },
  long: { breath: "sounds/quiet5.mp3", settle: "sounds/quiet5.mp3" },
};
const durationCache = {};

// The prayer as audio steps. Steps share a `block` (a part of the prayer); Back and
// Skip move a block at a time. Each spoken part is followed by five seconds of quiet.
// `part` names what was heard, for listening progress.
// The day as a list of steps to play, in the order it's prayed. Each step is one
// audio file (a clip, a bell, or a short quiet); steps are grouped into numbered
// "blocks" (the parts shown on the progress bar). In lectio order:
//   ask for the grace, silence · first reading · for the heart · second reading ·
//   deep dive · third reading · silence between two bells · last reading · closing.
// Parts that weren't made (or were left empty) are simply skipped.
function buildSequence(day, state) {
  const { order, graceGaps, pause, gaps } = playback();
  const lengths = PAUSES[gaps] || PAUSES.short;
  const seq = [];
  let block = 0;
  const quiet = (src) => seq.push({ label: "…", src, block, quiet: true });
  const gap = () => quiet(lengths.settle); // after a reading, the reflection or the deep dive
  const breath = () => quiet(lengths.breath); // after a guidance line, into what it introduces
  const speak = (clip, label, part) => {
    if (clip?.status !== "ready" || !clip.url) return false;
    seq.push({ label, part, src: fileUrl(clip.url), seconds: clip.seconds, block, text: clip.script, words: clip.words });
    return true;
  };
  const labels = options.prompts.guide_labels || {};
  const guide = (name) => speak(state.guide?.[name], labels[name] || "Guidance", name);
  const reading = (label, part) => speak(state.tracks.reading, label, part) && gap();
  const next = () => (block += 1);

  if (guide("opening")) for (let i = 0; i < graceGaps; i++) quiet("sounds/quiet5.mp3"); // the silence after asking for the grace
  next();
  if (order === "lectio") {
    if (guide("first")) breath();
    reading("First reading", "reading1");
    next();
    speak(state.tracks.heart, TRACK_LABELS.heart, "heart") && gap();
    next();
    if (guide("second")) breath();
    reading("Second reading", "reading2");
    next();
    speak(state.tracks.deep, TRACK_LABELS.deep, "deep") && gap();
    next();
    if (guide("third")) breath();
    reading("Third reading", "reading3");
    next();
  } else {
    reading(TRACK_LABELS.reading, "reading1");
    next();
    speak(state.tracks.heart, TRACK_LABELS.heart, "heart") && gap();
    next();
    speak(state.tracks.deep, TRACK_LABELS.deep, "deep") && gap();
    next();
  }
  if (guide("silence")) breath();
  seq.push({ label: "Silence", part: "silence", src: "sounds/bell.mp3", block, pause: true });
  for (let s = 0; s < pause; s += 30) seq.push({ label: "Silence", src: "sounds/quiet30.mp3", block, pause: true });
  seq.push({ label: "Silence", src: "sounds/bell.mp3", block, pause: true });
  gap();
  next();
  if (order === "lectio") {
    if (guide("last")) breath();
    reading("Last reading", "reading4");
    next();
  }
  guide("closing");
  return seq;
}

const stepSeconds = (st) => st.seconds ?? SOUND_SECONDS[st.src] ?? durationCache[st.src];
function totalSeconds(seq) {
  let total = 0;
  for (const st of seq) {
    const s = stepSeconds(st);
    if (s == null) return null;
    total += s;
  }
  return total;
}

function probeDurations(seq) {
  const missing = [...new Set(seq.filter((st) => stepSeconds(st) == null).map((st) => st.src))];
  let pending = missing.length;
  for (const src of missing) {
    const a = new Audio();
    a.preload = "metadata";
    const done = () => --pending === 0 && retreat && params().get("r") && renderRetreat();
    a.onloadedmetadata = () => {
      durationCache[src] = a.duration;
      done();
    };
    a.onerror = done;
    a.src = src;
  }
}

// A part is named for its main content (the reading, not the line that introduces it).
const MAIN_PARTS = new Set(["reading1", "reading2", "reading3", "reading4", "heart", "deep", "silence"]);
function blockLabel(block) {
  const inBlock = steps.filter((st) => st.block === block);
  const main = inBlock.find((st) => MAIN_PARTS.has(st.part)) || inBlock.find((st) => !st.quiet) || inBlock[0];
  return main?.label || "";
}

function openPrayScreen() {
  document.body.classList.add("praying");
  $("view-pray").hidden = false;
  showFullscreenButton();
}

const UNKNOWN_STEP_SECONDS = 30; // for sizing the progress bar before a clip's length is known

function startPrayer(dayNo) {
  const d = planDay(dayNo);
  const st = retreat?.days[String(dayNo)];
  if (!d || st?.status !== "ready") return showMessage("This day isn't ready to pray yet.");
  if (isExercise(d, st)) return showMessage("This day is an exercise to go and do; there's nothing to listen to.");
  prayerDay = d;
  steps = buildSequence(d, st);
  partsPlayed = new Set(st.listening?.parts_played || []);
  openPrayScreen();
  $("after").hidden = true;
  setDockExpanded(false);
  shownText = null;
  applyPrayView();
  resetStage(d);
  colorPrayer(d);
  buildProgressBar();
  // Left partway (on this device or another)? Ask: continue, or start from the beginning.
  const from = params().get("from");
  const l = st.listening;
  const left = l && !l.finished_at && l.last_step > 0 && l.last_step < steps.length ? l : null;
  if (from === "start" || !left) playStep(0);
  else if (from === "resume") resumeAt(left);
  else offerResume(left);
  requestWakeLock();
}

// Where to pick up: the part, a few seconds before where it stopped.
function resumeAt(l) {
  $("resume-choice").hidden = true;
  playStep(l.last_step);
  const back = Math.max(0, (l.seconds_in_part || 0) - 3);
  if (back > 1) {
    const player = $("player");
    const seek = () => { try { if (!(player.duration > 0) || back < player.duration - 2) player.currentTime = back; } catch {} };
    if (player.readyState >= 1) seek();
    else player.addEventListener("loadedmetadata", seek, { once: true });
  }
}

function offerResume(l) {
  const box = $("resume-choice");
  const secs = Math.round(l.seconds_in_part || 0);
  const at = secs > 5 ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} in` : "";
  $("resume-where").textContent = `${l.last_part || "where you stopped"}${at}`;
  $("resume-when").textContent = l.updated_at ? `You stopped ${longDate(l.updated_at)}.` : "";
  $("resume-go").onclick = () => resumeAt(l);
  $("resume-restart").onclick = () => { box.hidden = true; playStep(0); };
  $("now-part").textContent = "Continue, or start again?";
  $("now-meta").textContent = "";
  box.hidden = false;
  $("resume-go").focus({ preventScroll: true });
}

// The title and grace (shown when there's no picture) and the first picture.
function resetStage(d) {
  $("stage-title").textContent = `Day ${d.day} · ${dayTitle(d.title)}`;
  $("stage-grace").textContent = d.grace ? (/^ask /i.test(d.grace) ? d.grace : `Ask for the grace ${d.grace.replace(/^the grace\s+/i, "")}`) : "";
  shownImage = -1;
  for (const id of ["stage-a", "stage-b"]) {
    $(id).removeAttribute("src");
    $(id).classList.toggle("shown", id === "stage-a");
  }
  if (dayImages(d).length) showImage(0);
}

// The prayer's tint comes from the day's painting.
async function colorPrayer(d) {
  const img = dayImages(d)[0];
  const pal = img ? await paintingPalette(fileUrl(img.url)) : null;
  applyPalette($("view-pray"), pal);
}

// One bead per part of the prayer, on a gold thread, and the matching list of parts.
// A bead can be tapped to go to that part.
function buildProgressBar() {
  const blocks = [...new Set(steps.map((s) => s.block))];
  $("segments").innerHTML = "";
  $("part-list").innerHTML = "";
  for (const b of blocks) {
    const bead = el("button", { type: "button", class: "bead", "data-block": b, "aria-label": `Go to ${blockLabel(b)}`, title: blockLabel(b) });
    bead.onclick = () => playStep(steps.findIndex((s) => s.block === b));
    $("segments").append(bead);
    const li = el("li", { "data-block": b, text: blockLabel(b) });
    li.onclick = () => playStep(steps.findIndex((s) => s.block === b));
    $("part-list").append(li);
  }
}

function showImage(i) {
  const images = dayImages(prayerDay);
  if (!images.length) return;
  const idx = ((i % images.length) + images.length) % images.length;
  if (idx === shownImage) return;
  shownImage = idx;
  const front = $("stage-a").classList.contains("shown") && $("stage-a").getAttribute("src") ? $("stage-a") : $("stage-b");
  const back = front === $("stage-a") ? $("stage-b") : $("stage-a");
  back.onload = () => {
    back.classList.add("shown");
    if (front !== back) front.classList.remove("shown");
  };
  back.src = fileUrl(images[idx].url);
  back.alt = images[idx].description || "";
  clearInterval(imageTimer);
  if (images.length > 1) imageTimer = setInterval(() => showImage(shownImage + 1), 45000);
}

function playStep(index) {
  if (index >= steps.length) return finishPrayer();
  stepIndex = Math.max(0, index);
  const step = steps[stepIndex];
  const player = $("player");
  player.src = step.src;
  atVoiceSpeed(player, step.src);
  player.play().catch(() => setPlayIcon(false)); // iOS may need a tap on play
  if (step.part) partsPlayed.add(step.part);
  if (stepIndex > 0) reportProgress(false); // each new part is a place worth keeping
  // A short quiet between parts keeps showing the part just heard.
  const shown = step.quiet ? [...steps.slice(0, stepIndex)].reverse().find((s) => !s.quiet) || step : step;
  $("now-part").textContent = shown.label;
  const left = totalSeconds(steps.slice(stepIndex));
  const blocks = steps[steps.length - 1].block + 1;
  // The scripture reference is shown, never read aloud.
  const ref = scriptureRef(prayerDay.source_ref);
  $("now-meta").textContent = [`Day ${prayerDay.day}`, ref, left != null ? `${formatClock(left)} left` : ""].filter(Boolean).join(" · ");
  $("stage-caption").hidden = !step.pause;
  $("stage-caption").textContent = step.pause ? "Stay with one word or phrase that caught you. Let it rest in you until the bell." : "";
  $("pause-text").textContent = step.pause ? "Silence. Stay with one word or phrase until the bell." : "";
  showCandle(step);
  document.querySelectorAll("#segments .bead, #part-list li").forEach((n) => {
    const b = Number(n.dataset.block);
    n.classList.toggle("done", b < step.block);
    n.classList.toggle("now", b === step.block);
  });
  if (dayImages(prayerDay).length > 1) showImage(step.block);
  showStepText(step, shown);
  updateLockScreen(shown.label);
  reportProgress(false);
}

// What the phone's lock screen and headphones show: the part, the day, the painting.
function updateLockScreen(label) {
  if (!("mediaSession" in navigator)) return;
  const img = dayImages(prayerDay)[0];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: label, artist: `Day ${prayerDay.day}: ${dayTitle(prayerDay.title)}`, album: retreat.plan.title,
    artwork: img ? [{ src: fileUrl(img.url), sizes: "960x960", type: "image/jpeg" }] : [],
  });
}

// ---------------------------------------------------------------- text on screen

const PRAY_VIEWS = ["both", "image", "text"];
let shownText = null; // the text on screen, split into words
let followFrame = 0;
let stillText = null;

function applyPrayView() {
  const view = $("pray-view").value || "both";
  const hasImages = !!(prayerDay && dayImages(prayerDay).length);
  // Without images, "image" shows the title and grace, and "both" is just the text.
  const mode = !hasImages && view === "both" ? "text" : view;
  const pray = $("view-pray");
  PRAY_VIEWS.forEach((v) => pray.classList.toggle(`view-${v}`, v === mode));
  $("stage-empty").hidden = hasImages || mode === "text";
  $("view-toggle").innerHTML = iconSvg(view, 20);
  $("view-toggle").setAttribute("aria-label", `On screen: ${$("pray-view").selectedOptions[0]?.text || view}. Change`);
}

function cyclePrayView() {
  const next = PRAY_VIEWS[(PRAY_VIEWS.indexOf($("pray-view").value) + 1) % PRAY_VIEWS.length];
  $("pray-view").value = next;
  store.set("play.pray-view", next);
  applyPrayView();
  toast({ both: "Image and text", image: "Image only", text: "Text only" }[next]);
}

// The words of what is being spoken, each in a span with its position in the script,
// so the one being read can be highlighted.
function showStepText(step, shown) {
  let source = step.text ? step : null;
  if (!source && step.pause) { // rest with the reading through the silence
    if (stillText?.day !== prayerDay) stillText = { day: prayerDay, text: prayerDay.passage_text || "", still: true };
    source = stillText;
  }
  if (!source) source = shown?.text ? shown : null; // a short quiet gap: keep what was just heard
  if (!source) return;
  if (shownText && shownText.source === source) return;
  const box = $("stage-text");
  box.innerHTML = "";
  // Above the reading (and during the silence), where it comes from.
  const isReading = source.still || /^reading/.test(step.part || shown?.part || "");
  if (isReading && prayerDay.source_ref) box.append(el("p", { class: "text-ref", text: scriptureRef(prayerDay.source_ref) }));
  const starts = [];
  const spans = [];
  let offset = 0;
  for (const para of source.text.split(/\n{2,}/)) {
    const p = el("p");
    const base = source.text.indexOf(para, offset);
    offset = base + para.length;
    for (const m of para.matchAll(/\S+/g)) {
      const span = el("span", { text: m[0] });
      starts.push(base + m.index);
      spans.push(span);
      p.append(span, " ");
    }
    box.append(p);
  }
  box.classList.toggle("still", !!source.still);
  box.scrollTop = 0;
  shownText = { source, starts, spans, current: -1, step: source.still ? null : step };
}

// Which word is being spoken: from the recording's word timings when it has them,
// otherwise estimated from how far through the recording we are.
function followWord() {
  followFrame = 0;
  const player = $("player");
  const t = shownText;
  if (t && t.step && t.step === steps[stepIndex] && t.spans.length) {
    let char;
    const words = t.step.words;
    if (words?.length) {
      let lo = 0, hi = words.length - 1, k = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid][0] <= player.currentTime + 0.05) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      char = k < 0 ? -1 : words[k][1];
    } else if (player.duration > 0) {
      char = (player.currentTime / player.duration) * t.step.text.length;
    }
    if (char != null) {
      let lo = 0, hi = t.starts.length - 1, i = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t.starts[mid] <= char) { i = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (i !== t.current) highlightWord(i);
    }
  }
  if (!player.paused) followFrame = requestAnimationFrame(followWord);
}

function highlightWord(i) {
  const t = shownText;
  const from = Math.max(0, Math.min(t.current, i));
  const to = Math.max(t.current, i);
  for (let k = from; k <= to && k < t.spans.length; k++) t.spans[k].classList.toggle("said", k < i);
  t.spans[t.current]?.classList.remove("now");
  t.current = i;
  const span = t.spans[i];
  if (!span) return;
  span.classList.add("now");
  // Keep the spoken line in the middle third of the text area.
  const box = $("stage-text");
  const top = span.offsetTop - box.scrollTop;
  if (top < box.clientHeight * 0.25 || top > box.clientHeight * 0.6) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: span.offsetTop - box.clientHeight * 0.35, behavior: reduce ? "auto" : "smooth" });
  }
}

function setPlayIcon(playing) {
  $("play-pause").innerHTML = iconSvg(playing ? "pause" : "play", 26);
  $("play-pause").setAttribute("aria-label", playing ? "Pause" : "Play");
}

function nextBlock(direction) {
  const current = steps[stepIndex].block;
  const firstOf = (b) => steps.findIndex((s) => s.block === b);
  if (direction > 0) {
    const i = steps.findIndex((s) => s.block > current);
    return i < 0 ? finishPrayer() : playStep(i);
  }
  const start = firstOf(current);
  playStep(stepIndex > start ? start : Math.max(0, firstOf(current - 1)));
}

function reportProgress(finished) {
  if (!retreat || !prayerDay || !steps.length) return;
  const step = steps[stepIndex];
  lastReport = Date.now();
  const body = {
    step: stepIndex, part: step ? (step.quiet ? blockLabel(step.block) : step.label) : "",
    seconds: $("player").currentTime || 0, parts_played: [...partsPlayed], finished,
  };
  const day = prayerDay.day;
  const rid = retreat.id;
  authHeaders().then((headers) =>
    fetch(`${API}/api/retreats/${rid}/days/${day}/progress`, {
      method: "POST", keepalive: true, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok || retreat?.id !== rid) return;
      const data = await r.json();
      const st = retreat.days[String(day)];
      st.listening = data.listening;
      st.prayed_at = data.prayed_at;
    }).catch(() => {}));
}

function finishPrayer() {
  $("player").pause();
  setPlayIcon(false);
  reportProgress(true);
  releaseWakeLock();
  showAfter(prayerDay.day, retreat.days[String(prayerDay.day)].journal);
}

function showAfter(day, journal) {
  prayerDay = planDay(day);
  if (!document.body.classList.contains("praying")) {
    openPrayScreen();
    const images = dayImages(prayerDay);
    $("stage-empty").hidden = images.length > 0;
    $("stage-title").textContent = `Day ${prayerDay.day} · ${dayTitle(prayerDay.title)}`;
    colorPrayer(prayerDay);
    shownImage = -1;
    if (images.length) showImage(0);
  }
  illuminate(prayerDay);
  $("after-word").value = journal?.word || "";
  $("after-note").value = journal?.note || "";
  $("after").hidden = false;
  $("after-word").focus();
}

// The day prayed: its first letter illuminated in the painting's colors, and the week's
// days as initials, the prayed ones in gold.
function illuminate(d) {
  const title = dayTitle(d.title) || `Day ${d.day}`;
  const letter = (title.match(/[A-Za-z]/) || ["✦"])[0].toUpperCase();
  $("after-label").textContent = `${dayWords(d.day)} · prayed`;
  $("after-title").textContent = title;
  $("after-initial").textContent = letter;
  const node = document.querySelector("#after .illumination");
  node.classList.remove("gilding");
  void node.offsetWidth; // start the gilding and the vine again
  node.classList.add("gilding");
  const week = $("after-week");
  week.innerHTML = "";
  for (const x of retreat?.plan?.days || []) {
    const st = retreat.days[String(x.day)] || {};
    const first = ((dayTitle(x.title) || "").match(/[A-Za-z]/) || [String(x.day)])[0].toUpperCase();
    const prayed = !!st.prayed_at || x.day === d.day;
    week.append(el("span", { class: `initial${prayed ? " prayed" : ""}${x.day === d.day ? " now" : ""}`, title: `Day ${x.day}: ${dayTitle(x.title)}`, text: first }));
  }
}

async function saveAfter() {
  await markPrayed(prayerDay.day, { prayed: true, word: $("after-word").value, note: $("after-note").value });
  closePrayer();
}

function closePrayer(navigate = true) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!document.body.classList.contains("praying")) return;
  $("resume-choice").hidden = true;
  const player = $("player");
  if (player.getAttribute("src") && $("after").hidden) reportProgress(false);
  player.pause();
  player.removeAttribute("src");
  clearInterval(imageTimer);
  releaseWakeLock();
  document.body.classList.remove("praying");
  $("view-pray").hidden = true;
  $("after").hidden = true;
  steps = [];
  if (navigate && retreat) {
    selectedDay = prayerDay?.day || selectedDay;
    go(`?r=${retreat.id}`, true);
  }
}

function setDockExpanded(open) {
  $("dock-more").hidden = !open;
  $("dock-expand").setAttribute("aria-expanded", String(open));
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {}
  wakeLock = null;
}

const PROGRESS_REPORT_MS = 30000; // how often listening progress is saved while playing

function wirePlayer() {
  const player = $("player");
  player.addEventListener("ended", () => playStep(stepIndex + 1));
  player.addEventListener("play", () => {
    setPlayIcon(true);
    if (!followFrame) followFrame = requestAnimationFrame(followWord);
  });
  player.addEventListener("pause", () => {
    setPlayIcon(false);
    if (document.body.classList.contains("praying") && player.getAttribute("src") && !player.ended) reportProgress(false);
  });
  player.addEventListener("timeupdate", () => {
    fillCurrentSegment(player.currentTime);
    if (Date.now() - lastReport > PROGRESS_REPORT_MS) reportProgress(false);
  });
  player.addEventListener("error", () => {
    if (!player.getAttribute("src")) return;
    $("now-meta").textContent = "This part couldn't be loaded. Close and reopen the day to refresh its links.";
  });
  wirePlayerButtons(player);
  // Save progress when the phone is locked or the tab hidden; keep the screen awake on return.
  document.addEventListener("visibilitychange", () => {
    if (!document.body.classList.contains("praying")) return;
    if (document.visibilityState === "hidden") reportProgress(false);
    else if (!wakeLock && !player.paused) requestWakeLock();
  });
  wireLockScreenControls(player);
}

// How far through the whole prayer playback is: the gold thread fills behind the beads.
function fillCurrentSegment(currentTime) {
  const step = steps[stepIndex];
  if (!step) return;
  const total = steps.reduce((n, s) => n + (stepSeconds(s) || UNKNOWN_STEP_SECONDS), 0) || 1;
  const before = steps.slice(0, stepIndex).reduce((n, s) => n + (stepSeconds(s) || UNKNOWN_STEP_SECONDS), 0);
  $("segments").style.setProperty("--p", Math.min(1, (before + currentTime) / total).toFixed(4));
  if (step.pause) updateCandleTime(currentTime);
}

// ---------------------------------------------------------------- the silence: a candle
// During the silence the painting and words step back, and a candle burns down over
// the length of the silence, from one bell to the next.

let candleBlock = null;

function silenceSteps(block) {
  return steps.filter((s) => s.block === block && s.pause);
}

function showCandle(step) {
  const inSilence = !!step.pause;
  $("view-pray").classList.toggle("in-silence", inSilence);
  $("stage-candle").hidden = !inSilence;
  if (!inSilence) {
    candleBlock = null;
    return;
  }
  if (candleBlock === step.block) return;
  candleBlock = step.block;
  const total = silenceSteps(step.block).reduce((n, s) => n + (stepSeconds(s) || UNKNOWN_STEP_SECONDS), 0);
  const wax = $("candle-wax");
  wax.style.animation = "none";
  void wax.offsetWidth; // restart the burn
  wax.style.animation = `burn ${Math.max(10, Math.round(total))}s linear forwards`;
  const bell = document.querySelector("#stage-candle .bell");
  bell.classList.remove("ringing");
  void bell.offsetWidth;
  bell.classList.add("ringing");
  updateCandleTime(0);
}

function updateCandleTime(currentTime) {
  const step = steps[stepIndex];
  const all = silenceSteps(step.block);
  const i = all.indexOf(step);
  const left = all.slice(i).reduce((n, s) => n + (stepSeconds(s) || UNKNOWN_STEP_SECONDS), 0) - currentTime;
  $("candle-time").textContent = left > 0 ? formatClock(left) : "";
}

function wirePlayerButtons(player) {
  $("play-pause").onclick = () => {
    if (!$("resume-choice").hidden) return $("resume-go").click(); // play means continue
    return player.paused ? player.play() : player.pause();
  };
  $("next-step").onclick = () => nextBlock(1);
  $("prev-step").onclick = () => nextBlock(-1);
  $("stop-player").onclick = () => closePrayer();
  $("pray-close").onclick = () => closePrayer();
  $("dock-expand").onclick = () => setDockExpanded($("dock-more").hidden);
  $("view-toggle").onclick = cyclePrayView;
  $("fullscreen").onclick = toggleFullscreen;
  $("home-screen-done").onclick = () => ($("home-screen-tip").hidden = true);
  document.addEventListener("fullscreenchange", showFullscreenState);
  $("stage").onclick = (e) => e.target.id !== "pray-close" && setDockExpanded(false);
  $("after-save").onclick = saveAfter;
  $("after-done").onclick = () => closePrayer();
}

// Headphone buttons and the lock screen skip between parts.
function wireLockScreenControls(player) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("nexttrack", () => nextBlock(1));
  navigator.mediaSession.setActionHandler("previoustrack", () => nextBlock(-1));
  navigator.mediaSession.setActionHandler("play", () => player.play());
  navigator.mediaSession.setActionHandler("pause", () => player.pause());
}


// ---------------------------------------------------------------- full screen
// Where the browser allows it (computers, Android, iPad) the prayer goes full screen.
// An iPhone doesn't let a website hide the browser, so there the button explains how
// to add the app to the Home Screen, where it opens full screen by itself.

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function toggleFullscreen() {
  const pray = $("view-pray");
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  if (pray.requestFullscreen && document.fullscreenEnabled) {
    try {
      await pray.requestFullscreen({ navigationUI: "hide" });
      return;
    } catch {}
  }
  $("home-screen-tip").hidden = false;
}

function showFullscreenState() {
  const on = !!document.fullscreenElement;
  const b = $("fullscreen");
  b.innerHTML = "";
  b.append(icon(on ? "shrink" : "expand"));
  b.setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
}

// Installed to the Home Screen it's already full screen: no button needed.
function showFullscreenButton() {
  $("fullscreen").hidden = isStandalone();
}
