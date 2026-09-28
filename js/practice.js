// ================================================================ prayer practice (?practice)
// Guided exercises, the same for everyone and recorded once (practice/practice.json):
// the daily prayer practice, the weekly review, your life's faith story and the evening
// Examen. Full accounts can also have their own Examen written around their life and
// recorded for them (/api/practice/examen, ?practice=my-examen). A voice
// leads; silences and writing pauses run on a timer; what's written is saved to the
// person's own journal (/api/practice/journal).

let practiceData = null;
let practiceRun = null; // { session, index, timer, remaining, entries }
const practiceAudio = new Audio();

async function loadPractice() {
  if (!practiceData) practiceData = await (await fetch(`practice/practice.json?v=${RUNNING_VERSION}`)).json();
  return practiceData;
}

// A session's length in minutes, from `from` on: the recorded speech (at the chosen voice
// speed) plus every silence and journaling pause.
const sessionMinutes = (s, from = 0) => Math.max(1, Math.round(s.segments.slice(from).reduce((n, g) =>
  n + (g.kind === "speak" ? (g.audio?.standard?.seconds || g.text.split(/\s+/).length / 2.3) / voiceSpeed() : g.seconds), 0) / 60));

async function openPractice(which) {
  show("practice");
  document.title = "Prayer practice · Ignatius at Home";
  stopPractice();
  const data = await loadPractice();
  if (which === "my-examen") {
    const mine = await api("/api/practice/examen").catch(() => ({}));
    if (mine.status === "ready") return startPractice(mine.session);
  }
  const session = data.sessions.find((s) => s.id === which);
  if (session) return startPractice(session);
  renderPracticeMenu(data);
}

// The menu, in three parts: prayers made for you (your own Examen), what you've done
// recently, and the library of standard sessions.
function renderPracticeMenu(data) {
  $("practice-run").hidden = true;
  $("practice-menu").hidden = false;
  $("practice-list").replaceChildren(...data.sessions.map((s) => practiceCard(s)));
  $("practice-voice").value = store.get("practice.voice", "standard");
  $("practice-voice").onchange = () => store.set("practice.voice", $("practice-voice").value);
  loadPracticeJournal().then(renderRecent);
  renderMyExamen();
}

function practiceCard(s, lead = `about ${sessionMinutes(s)} minutes`, href = `./?practice=${s.id}`) {
  const voices = s.voices && (s.voices.standard && s.voices.deluxe ? `${s.voices.standard} or ${s.voices.deluxe}` : Object.values(s.voices)[0]);
  return el("a", { class: "practice-card", href, "data-nav": "" },
    el("span", { class: "rubric small", text: lead }),
    el("strong", { text: s.title }),
    el("span", { class: "meta", text: s.summary }),
    voices ? el("span", { class: "meta small", text: `Voice: ${voices}` }) : "");
}

// When each session was last used: started on this device, or written about in the
// journal (which follows the person to every device).
function noteSessionUsed(id) {
  const recent = store.get("practice.recent", {});
  recent[id] = new Date().toISOString();
  store.set("practice.recent", recent);
}

// An unsaved journal answer is kept on this device while you write, under your account,
// so on a shared browser the next person never sees it; every draft is cleared at sign-out.
const practiceDraftKey = (run) => `practice.draft.${session?.user?.id || me?.id || "local"}.${run.session.id}.${run.index}`;

function clearPracticeDrafts() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("practice.draft.")).forEach((k) => localStorage.removeItem(k));
  } catch {}
  const box = $("practice-answer");
  if (box) box.value = "";
}

let practiceEntries = [];
const RECENT_COUNT = 3;

function renderRecent() {
  if (!practiceData) return;
  const used = { ...store.get("practice.recent", {}) };
  for (const e of practiceEntries) if (!used[e.session] || e.at > used[e.session]) used[e.session] = e.at;
  const recent = Object.entries(used)
    .filter(([id]) => id !== "my-examen") // your own prayers are already at the top
    .map(([id, at]) => ({ at, s: practiceData.sessions.find((x) => x.id === id) }))
    .filter((x) => x.s)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, RECENT_COUNT);
  $("practice-recent").hidden = !recent.length;
  $("practice-recent-list").replaceChildren(...recent.map(({ at, s }) => practiceCard(s, `${longDate(at)} · about ${sessionMinutes(s)} minutes`)));
}

async function loadPracticeJournal() {
  const box = $("practice-journal");
  box.innerHTML = "";
  practiceEntries = [];
  try {
    practiceEntries = (await api("/api/practice/journal")).entries;
  } catch {}
  $("practice-journal-box").hidden = !practiceEntries.length;
  for (const e of [...practiceEntries].reverse().slice(0, 60)) {
    box.append(el("li", {},
      el("span", { class: "rubric small", text: `${longDate(e.at)} · ${e.question}` }),
      el("p", { text: e.answer })));
  }
}

// ---------------------------------------------------------------- your own Examen

let myExamenPoll = null;

async function renderMyExamen() {
  clearTimeout(myExamenPoll);
  const box = $("my-examen");
  let state = { status: "none" };
  try {
    state = await api("/api/practice/examen");
  } catch {}
  $("my-examen-free").hidden = !isFree();
  $("my-examen-form").hidden = isFree() || state.status === "making";
  $("my-examen-days").value ||= state.days || "";
  if (state.voice) $("my-examen-voice").value = state.voice;
  const status = $("my-examen-status");
  status.innerHTML = "";
  const ready = state.status === "ready";
  $("practice-yours").hidden = !ready;
  $("practice-yours-list").replaceChildren(...(ready ? [practiceCard(state.session, `about ${sessionMinutes(state.session)} minutes · made ${longDate(state.made_at)}`, "./?practice=my-examen")] : []));
  $("my-examen-heading").textContent = ready ? "Write a new Examen" : "Your own Examen";
  if (ready) {
    status.append(el("p", { class: "meta", text: "Yours is at the top of this page. A new one replaces it." }));
    $("my-examen-make").textContent = "Write a new one";
  } else if (state.status === "making") {
    status.append(el("p", { class: "meta making-note", text: "Writing your Examen and recording it. This takes two or three minutes; you can leave this page and come back." }));
    myExamenPoll = setTimeout(() => !$("view-practice").hidden && renderMyExamen(), 6000);
  } else if (state.status === "failed") {
    status.append(el("p", { class: "error", text: `It couldn't be made: ${state.error}` }));
  }
  box.hidden = false;
}

async function makeMyExamen() {
  const button = $("my-examen-make");
  button.disabled = true;
  document.activeElement?.blur(); // close the keyboard before the form is hidden (iPhones can get stuck otherwise)
  try {
    await postJson("/api/practice/examen", { days: $("my-examen-days").value, voice: $("my-examen-voice").value });
    await renderMyExamen();
    $("my-examen-status").scrollIntoView({ block: "center", behavior: "smooth" }); // show that it's being made
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.disabled = false;
  }
}


// ---------------------------------------------------------------- the Examen's stage
// While the Examen (or the Meditation on My Birth) plays, a quiet picture to rest the eyes on: a painting for each step,
// drifting slowly, with a candle; or just the candle; or nothing ("practice.picture").

const EXAMEN_ART = {
  Presence: { src: "practice/art/presence.jpg", caption: "Georges de La Tour, The Magdalen with the Smoking Flame, about 1640", focus: "38% 62%" },
  Gratitude: { src: "practice/art/gratitude.jpg", caption: "Jean-François Millet, The Angelus, 1857–59", focus: "50% 55%" },
  Review: { src: "practice/art/review.jpg", caption: "Rembrandt, The Supper at Emmaus, 1648", focus: "50% 45%" },
  Forgiveness: { src: "practice/art/forgiveness.jpg", caption: "Rembrandt, The Return of the Prodigal Son, about 1668", focus: "30% 45%" },
  Tomorrow: { src: "practice/art/tomorrow.jpg", caption: "Caspar David Friedrich, Moonrise over the Sea, 1822", focus: "50% 40%" },
  Close: { src: "practice/art/close.jpg", caption: "Vincent van Gogh, The Starry Night, 1889", focus: "60% 40%" },
};
// The Meditation on My Birth rests on one painting: a mother and her newborn by candlelight.
const NEWBORN = { src: "practice/art/newborn.jpg", caption: "Georges de La Tour, The Newborn, 1640s", focus: "45% 50%" };
const SESSION_ART = { birth: { Settling: EXAMEN_ART.Presence, default: NEWBORN } };
const PICTURES = { painting: "Painting and candle", candle: "Candle only", none: "No picture" };
const hasStage = (session) => /examen/.test(session.id) || session.id in SESSION_ART;

function stageArt(session, step) {
  const own = SESSION_ART[session.id];
  return own ? own[step] || own.default : EXAMEN_ART[step] || EXAMEN_ART.Presence;
}

function candleSvg() {
  const wrap = el("div", { class: "candle", "aria-hidden": "true" });
  wrap.innerHTML = `<svg viewBox="0 0 80 200"><defs>
    <radialGradient id="cg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd88a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd88a" stop-opacity="0"/></radialGradient>
    <linearGradient id="cw" x1="0" x2="1"><stop offset="0" stop-color="#d9ccb0"/><stop offset=".45" stop-color="#f6efe0"/><stop offset="1" stop-color="#b9aa88"/></linearGradient>
    <linearGradient id="cf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e0662a"/><stop offset=".35" stop-color="#ffb347"/><stop offset="1" stop-color="#fff4c8"/></linearGradient></defs>
    <circle class="glow" cx="40" cy="60" r="38" fill="url(#cg)"/>
    <rect x="24" y="90" width="32" height="104" rx="3" fill="url(#cw)"/>
    <ellipse cx="40" cy="90" rx="16" ry="3.5" fill="#efe5cf"/>
    <path d="M40 84v-8" stroke="#3a2a1a" stroke-width="1.6"/>
    <path class="flame" d="M40 40 C 47 55, 49 66, 40 80 C 31 66, 33 55, 40 40 Z" fill="url(#cf)"/>
    <path class="flame core" d="M40 62 C 43 68, 43 73, 40 79 C 37 73, 37 68, 40 62 Z" fill="#8fb6ff" opacity=".55"/></svg>`;
  return wrap;
}

function showStage(seg) {
  const stage = $("practice-stage");
  const mode = store.get("practice.picture", "painting");
  $("practice-picture").textContent = PICTURES[mode];
  if (!practiceRun || !hasStage(practiceRun.session) || mode === "none") {
    stage.hidden = true;
    $("practice-picture").hidden = !practiceRun || !hasStage(practiceRun.session);
    return;
  }
  $("practice-picture").hidden = false;
  stage.hidden = false;
  stage.className = `practice-stage mode-${mode} ${seg.kind === "journal" ? "compact" : ""}`;
  if (!stage.querySelector(".candle")) stage.append(candleSvg());
  const art = stageArt(practiceRun.session, seg.step);
  const current = stage.querySelector(".stage-art"); // the newest (each is prepended)
  if (mode === "painting" && current?.dataset.src !== art.src) {
    // The whole painting, never cropped, over a soft blurred copy that fills the frame.
    const img = el("div", { class: "stage-art", "data-src": art.src },
      el("img", { class: "stage-fill", src: art.src, alt: "", "aria-hidden": "true" }),
      el("img", { class: "stage-painting", src: art.src, alt: art.caption }));
    img.querySelector(".stage-painting").style.transformOrigin = art.focus;
    img.querySelector(".stage-painting").onload = () => requestAnimationFrame(() => img.classList.add("shown"));
    stage.prepend(img);
    for (const old of stage.querySelectorAll(".stage-art")) {
      if (old === img) continue;
      old.classList.remove("shown");
      setTimeout(() => old.remove(), 2600);
    }
    $("practice-art-caption").textContent = art.caption;
  }
  if (mode !== "painting") stage.querySelectorAll(".stage-art").forEach((i) => i.remove());
  $("practice-art-caption").hidden = mode !== "painting";
}

function cyclePicture() {
  const modes = Object.keys(PICTURES);
  const next = modes[(modes.indexOf(store.get("practice.picture", "painting")) + 1) % modes.length];
  store.set("practice.picture", next);
  const seg = practiceRun?.session.segments[practiceRun.index];
  if (seg) showStage(seg);
}

// ---------------------------------------------------------------- background music
// An Advanced choice: chant (open-licence recordings from Wikimedia Commons) or a quiet
// instrumental made with ElevenLabs Music, looping softly under the whole exercise. It
// dips while the voice speaks and comes back up in the silences.

const MUSIC = {
  chant: ["veni-sancte-spiritus", "rorate-caeli", "ave-maria", "gregorian-chant", "salve-regina"],
  instrumental: ["quiet-prayer-ai"],
};
const backgroundMusic = new Audio();
let musicList = [];
let musicFade = null;

function musicLevel() {
  return Number(store.get("practice.music.volume", 0.3));
}

// Volume goes through Web Audio, since iPhones ignore an audio element's volume.
let musicGain = null;
function musicNode() {
  if (!musicGain) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    ctx.createMediaElementSource(backgroundMusic).connect(musicGain).connect(ctx.destination);
  }
  musicGain.context.resume().catch(() => {});
  return musicGain;
}

function fadeMusic(target, ms = 1500) {
  const gain = musicNode().gain;
  const now = musicGain.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(target, now + ms / 1000);
  clearTimeout(musicFade);
  if (target === 0) musicFade = setTimeout(() => backgroundMusic.pause(), ms);
}

function startMusic(choice = store.get("practice.music", "none")) {
  if (!MUSIC[choice]) return;
  musicList = [...MUSIC[choice]];
  const playNext = () => {
    const name = musicList.shift();
    musicList.push(name);
    backgroundMusic.src = `practice/music/${name}.mp3`;
    backgroundMusic.play().catch(() => {});
  };
  backgroundMusic.onended = playNext;
  musicNode().gain.value = 0;
  playNext();
  fadeMusic(musicLevel() * 0.5, 3000);
}

function stopMusic() {
  if (!backgroundMusic.paused) fadeMusic(0, 2500);
}

// Softer under the voice, fuller in the silences.
function duckMusic(speaking) {
  if (!backgroundMusic.paused) fadeMusic(musicLevel() * (speaking ? 0.4 : 1));
}

function wireMusic() {
  const choice = $("practice-music");
  const volume = $("practice-music-volume");
  choice.value = store.get("practice.music", "none");
  volume.value = musicLevel();
  volume.oninput = () => {
    store.set("practice.music.volume", volume.value);
    duckMusic(practiceRun?.session.segments[practiceRun.index]?.kind === "speak");
  };
  // The sample plays the chosen music, or the chant when None is chosen.
  const sample = $("practice-music-sample");
  sample.onclick = () => {
    if (!backgroundMusic.paused) {
      stopMusic();
      sample.textContent = "Play a sample";
      return;
    }
    startMusic(MUSIC[choice.value] ? choice.value : "chant");
    fadeMusic(musicLevel(), 1500);
    sample.textContent = "Stop the sample";
  };
  choice.onchange = () => {
    store.set("practice.music", choice.value);
    if (!backgroundMusic.paused && !practiceRun) {  // switch what the sample is playing
      if (MUSIC[choice.value]) startMusic(choice.value), fadeMusic(musicLevel(), 1500);
      else stopMusic(), (sample.textContent = "Play a sample");
    }
  };
}

// ---------------------------------------------------------------- a session

function startPractice(session) {
  noteSessionUsed(session.id);
  $("practice-menu").hidden = true;
  $("practice-run").hidden = false;
  $("practice-title").textContent = session.title;
  practiceRun = { session, index: -1, timer: null, endAt: null, left: null, total: 0, paused: false };
  requestWakeLock();
  wireLockScreen();
  startMusic();
  nextSegment(1);
}

function stopPractice() {
  if (!practiceRun) return;
  clearInterval(practiceRun.timer);
  practiceAudio.pause();
  savePracticeAnswer();
  practiceRun = null;
  stopMusic();
  releaseWakeLock();
  clearLockScreen();
}

function nextSegment(step) {
  const run = practiceRun;
  if (!run) return;
  savePracticeAnswer();
  clearInterval(run.timer);
  run.endAt = run.left = null;
  run.paused = false;
  run.index += step;
  if (run.index < 0) run.index = 0;
  const seg = run.session.segments[run.index];
  if (!seg) return finishPractice();
  renderSegment(seg);
  showOnLockScreen(seg);
  duckMusic(seg.kind === "speak");
  if (seg.kind === "speak") playNarration(seg);
  else startCountdown(seg);
}

function renderSegment(seg) {
  const run = practiceRun;
  const total = run.session.segments.length;
  const left = sessionMinutes(run.session, run.index);
  $("practice-step").textContent = `${seg.step} · ${run.index + 1} of ${total} · about ${sessionMinutes(run.session)} minutes`
    + (run.index ? `, ${left} left` : "");
  $("practice-progress").style.setProperty("--p", (run.index + 1) / total);
  showStage(seg);
  const body = $("practice-body");
  body.innerHTML = "";
  body.className = `practice-body ${seg.kind}`;
  if (seg.kind === "speak") {
    body.append(el("p", { class: "practice-words", text: seg.text }));
  } else {
    body.append(el("p", { class: "practice-question", text: seg.question }),
      el("div", { class: "practice-clock", id: "practice-clock" }));
    if (seg.kind === "journal") {
      const draftKey = practiceDraftKey(run);
      const box = el("textarea", { id: "practice-answer", rows: 8, placeholder: seg.prompts.join("\n"), spellcheck: true,
        "aria-label": seg.question });
      box.value = store.get(draftKey, "");
      box.oninput = () => store.set(draftKey, box.value);
      body.append(box, el("ul", { class: "practice-prompts" }, seg.prompts.map((p) => el("li", { text: p }))));
    }
    if (run.session.id === "weekly" && /notes/i.test(seg.question)) body.append(weekNotesBox());
  }
}

// ---------------------------------------------------------------- one player for everything
// One audio element plays the whole session, one sound after the next: the narration,
// the silences (a near-silent track, looped) and the bell. On an iPhone this is what
// keeps a session going with the screen off: a page that is already playing may move
// on to its next sound, and the player's events keep firing while timers stop. The
// countdowns run on the clock (endAt), so they are right when the screen comes back.

const QUIET_TRACK = "sounds/quiet30.mp3";
const BELL = "sounds/bell.mp3";

function playOn(src, { loop = false, onended = null } = {}) {
  const url = new URL(src, location.href).href;
  practiceAudio.loop = loop;
  practiceAudio.onended = onended;
  if (practiceAudio.src !== url) practiceAudio.src = url; // a silence after a silence just keeps playing
  atVoiceSpeed(practiceAudio, url);
  practiceAudio.play().catch(showPlayState);
}

function playNarration(seg) {
  const voice = store.get("practice.voice", "standard");
  const clip = seg.audio?.file ? seg.audio : seg.audio?.[voice] || seg.audio?.standard; // your own Examen has one voice
  if (!clip) return startCountdown({ ...seg, seconds: Math.ceil(seg.text.split(/\s+/).length / 2.3) });
  practiceAudio.ontimeupdate = null;
  playOn(clip.path ? fileUrl(clip.file) : clip.file, { onended: () => nextSegment(1) }); // your own Examen is served by the API
}

function startCountdown(seg) {
  const run = practiceRun;
  run.total = seg.seconds;
  run.endAt = Date.now() + seg.seconds * 1000;
  playOn(QUIET_TRACK, { loop: true });
  practiceAudio.ontimeupdate = checkCountdown; // keeps firing with the screen off
  run.timer = setInterval(checkCountdown, 500);
  checkCountdown();
}

function checkCountdown() {
  const run = practiceRun;
  if (!run || run.paused || run.endAt == null) return;
  const left = Math.max(0, Math.ceil((run.endAt - Date.now()) / 1000));
  showClock(left, run.total);
  if (left > 0) return;
  run.endAt = null;
  clearInterval(run.timer);
  practiceAudio.ontimeupdate = null;
  playOn(BELL, { onended: () => nextSegment(1) }); // the bell ends the pause, then the session moves on
}

function showClock(left, total) {
  const clock = $("practice-clock");
  if (!clock) return;
  clock.textContent = formatClock(left);
  clock.style.setProperty("--p", 1 - left / total);
}

function pausePractice() {
  const run = practiceRun;
  if (!run || run.paused) return;
  run.paused = true;
  if (run.endAt != null) run.left = run.endAt - Date.now();
  practiceAudio.pause();
  showPlayState();
}

function resumePractice() {
  const run = practiceRun;
  if (!run) return;
  run.paused = false;
  if (run.left != null) {
    run.endAt = Date.now() + run.left;
    run.left = null;
  }
  practiceAudio.play().catch(showPlayState);
  if (backgroundMusic.paused && store.get("practice.music", "none") !== "none") startMusic();
  showPlayState();
}

function togglePracticePause() {
  if (practiceRun?.paused || practiceAudio.paused) resumePractice();
  else pausePractice();
}

// The button and the lock screen say what's really happening.
function showPlayState() {
  const playing = !practiceAudio.paused && !practiceRun?.paused;
  $("practice-pause").textContent = playing ? "Pause" : "Play";
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}
practiceAudio.addEventListener("play", showPlayState);
practiceAudio.addEventListener("pause", showPlayState);

// Lock-screen controls: play, pause, and skipping between steps.
function wireLockScreen() {
  if (!("mediaSession" in navigator)) return;
  const handlers = { play: resumePractice, pause: pausePractice, nexttrack: () => nextSegment(1), previoustrack: () => nextSegment(-1) };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {}
  }
}

function showOnLockScreen(seg) {
  if (!("mediaSession" in navigator) || !practiceRun) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: seg.kind === "speak" ? seg.step : seg.question || seg.step,
    artist: practiceRun.session.title,
    album: "Ignatius at Home",
    artwork: [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }],
  });
}

function clearLockScreen() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
}

// Weekly review: the week's daily notes, to read during the pause.
function weekNotesBox() {
  const box = el("div", { class: "practice-week" }, el("p", { class: "meta", text: "Loading this week's notes…" }));
  api("/api/practice/journal").then(({ entries }) => {
    const since = Date.now() - 7 * 86400000;
    const week = entries.filter((e) => Date.parse(e.at) >= since && e.session !== "weekly");
    box.innerHTML = "";
    if (!week.length) box.append(el("p", { class: "meta", text: "No notes from this week yet. Remember the week as it comes to you." }));
    for (const e of week) box.append(el("div", {}, el("span", { class: "rubric small", text: `${longDate(e.at)} · ${e.question}` }), el("p", { text: e.answer })));
  }).catch(() => (box.innerHTML = ""));
  return box;
}

async function savePracticeAnswer() {
  const run = practiceRun;
  const box = $("practice-answer");
  if (!run || !box) return;
  const seg = run.session.segments[run.index];
  const answer = box.value.trim();
  box.id = ""; // saved once
  if (!answer || seg?.kind !== "journal") return;
  store.set(practiceDraftKey(run), null);
  try {
    await postJson("/api/practice/journal", { session: run.session.id, question: seg.question, answer });
  } catch (err) {
    showMessage(`Your note couldn't be saved: ${err.message}. It's kept on this device.`);
  }
}

function finishPractice() {
  const run = practiceRun;
  practiceAudio.pause();
  clearLockScreen();
  $("practice-stage").hidden = $("practice-art-caption").hidden = $("practice-picture").hidden = true;
  practiceRun = null;
  stopMusic();
  releaseWakeLock();
  $("practice-step").textContent = "Finished";
  $("practice-progress").style.setProperty("--p", 1);
  const body = $("practice-body");
  body.innerHTML = "";
  body.className = "practice-body done";
  body.append(el("p", { class: "practice-words", text: "Thank you for this time." }),
    el("p", { class: "meta", text: "What you wrote is saved in your practice journal." }),
    el("a", { class: "button", href: "./?practice", "data-nav": "", text: "Back to the exercises" }));
  if (run) loadPracticeJournal();
}

function wirePractice() {
  $("practice-pause").onclick = togglePracticePause;
  $("my-examen-make").onclick = makeMyExamen;
  $("practice-picture").onclick = cyclePicture;
  wireMusic();
  $("practice-next").onclick = () => nextSegment(1);
  $("practice-back").onclick = () => nextSegment(-1);
  $("practice-stop").onclick = () => {
    stopPractice();
    go("?practice");
  };
}
