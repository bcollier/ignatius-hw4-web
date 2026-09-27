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

const sessionMinutes = (s) => Math.round(s.segments.reduce((n, g) =>
  n + (g.kind === "speak" ? (g.audio?.standard?.seconds || g.text.split(/\s+/).length / 2.3) : g.seconds), 0) / 60);

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

function renderPracticeMenu(data) {
  $("practice-run").hidden = true;
  $("practice-menu").hidden = false;
  const list = $("practice-list");
  list.innerHTML = "";
  for (const s of data.sessions) {
    list.append(el("a", { class: "practice-card", href: `./?practice=${s.id}`, "data-nav": "" },
      el("span", { class: "rubric small", text: `about ${sessionMinutes(s)} minutes` }),
      el("strong", { text: s.title }),
      el("span", { class: "meta", text: s.summary }),
      s.voices ? el("span", { class: "meta small", text: `Voice: ${s.voices.standard} or ${s.voices.deluxe}` }) : ""));
  }
  $("practice-voice").value = store.get("practice.voice", "standard");
  $("practice-voice").onchange = () => store.set("practice.voice", $("practice-voice").value);
  loadPracticeJournal();
  renderMyExamen();
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
  if (state.status === "ready") {
    const s = state.session;
    status.append(el("a", { class: "practice-card", href: "./?practice=my-examen", "data-nav": "" },
      el("span", { class: "rubric small", text: `about ${sessionMinutes(s)} minutes · made ${longDate(state.made_at)}` }),
      el("strong", { text: s.title }),
      el("span", { class: "meta", text: s.summary }),
      el("span", { class: "meta small", text: `Voice: ${Object.values(s.voices || {})[0] || ""}` })));
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
  try {
    await postJson("/api/practice/examen", { days: $("my-examen-days").value, voice: $("my-examen-voice").value });
    await renderMyExamen();
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.disabled = false;
  }
}

async function loadPracticeJournal() {
  const box = $("practice-journal");
  box.innerHTML = "";
  let entries = [];
  try {
    entries = (await api("/api/practice/journal")).entries;
  } catch {}
  $("practice-journal-box").hidden = !entries.length;
  for (const e of [...entries].reverse().slice(0, 60)) {
    box.append(el("li", {},
      el("span", { class: "rubric small", text: `${longDate(e.at)} · ${e.question}` }),
      el("p", { text: e.answer })));
  }
}

// ---------------------------------------------------------------- the Examen's stage
// While the Examen plays, a quiet picture to rest the eyes on: a painting for each step,
// drifting slowly, with a candle; or just the candle; or nothing ("practice.picture").

const EXAMEN_ART = {
  Presence: { src: "practice/art/presence.jpg", caption: "Georges de La Tour, The Magdalen with the Smoking Flame, about 1640", focus: "38% 62%" },
  Gratitude: { src: "practice/art/gratitude.jpg", caption: "Jean-François Millet, The Angelus, 1857–59", focus: "50% 55%" },
  Review: { src: "practice/art/review.jpg", caption: "Rembrandt, The Supper at Emmaus, 1648", focus: "50% 45%" },
  Forgiveness: { src: "practice/art/forgiveness.jpg", caption: "Rembrandt, The Return of the Prodigal Son, about 1668", focus: "30% 45%" },
  Tomorrow: { src: "practice/art/tomorrow.jpg", caption: "Caspar David Friedrich, Moonrise over the Sea, 1822", focus: "50% 40%" },
  Close: { src: "practice/art/close.jpg", caption: "Vincent van Gogh, The Starry Night, 1889", focus: "60% 40%" },
};
const PICTURES = { painting: "Painting and candle", candle: "Candle only", none: "No picture" };
const hasStage = (session) => /examen/.test(session.id);

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
  const art = EXAMEN_ART[seg.step] || EXAMEN_ART.Presence;
  const current = stage.querySelector("img.shown");
  if (mode === "painting" && current?.dataset.src !== art.src) {
    const img = el("img", { src: art.src, alt: art.caption, "data-src": art.src });
    img.style.transformOrigin = art.focus;
    img.onload = () => requestAnimationFrame(() => img.classList.add("shown"));
    stage.prepend(img);
    if (current) {
      current.classList.remove("shown");
      setTimeout(() => current.remove(), 2600);
    }
    $("practice-art-caption").textContent = art.caption;
  }
  if (mode !== "painting") stage.querySelectorAll("img").forEach((i) => i.remove());
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
  $("practice-menu").hidden = true;
  $("practice-run").hidden = false;
  $("practice-title").textContent = session.title;
  practiceRun = { session, index: -1, timer: null, remaining: 0, paused: false, weekNotes: null };
  requestWakeLock();
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
}

function nextSegment(step) {
  const run = practiceRun;
  if (!run) return;
  savePracticeAnswer();
  clearInterval(run.timer);
  practiceAudio.pause();
  run.index += step;
  if (run.index < 0) run.index = 0;
  const seg = run.session.segments[run.index];
  if (!seg) return finishPractice();
  renderSegment(seg);
  duckMusic(seg.kind === "speak");
  if (seg.kind === "speak") playNarration(seg);
  else startCountdown(seg);
}

function renderSegment(seg) {
  const run = practiceRun;
  const total = run.session.segments.length;
  $("practice-step").textContent = `${seg.step} · ${run.index + 1} of ${total}`;
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
      const draftKey = `practice.draft.${run.session.id}.${run.index}`;
      const box = el("textarea", { id: "practice-answer", rows: 8, placeholder: seg.prompts.join("\n"), spellcheck: true,
        "aria-label": seg.question });
      box.value = store.get(draftKey, "");
      box.oninput = () => store.set(draftKey, box.value);
      body.append(box, el("ul", { class: "practice-prompts" }, seg.prompts.map((p) => el("li", { text: p }))));
    }
    if (run.session.id === "weekly" && /notes/i.test(seg.question)) body.append(weekNotesBox());
  }
  $("practice-pause").textContent = "Pause";
}

function playNarration(seg) {
  const voice = store.get("practice.voice", "standard");
  const clip = seg.audio?.file ? seg.audio : seg.audio?.[voice] || seg.audio?.standard; // your own Examen has one voice
  if (!clip) return startCountdown({ ...seg, seconds: Math.ceil(seg.text.split(/\s+/).length / 2.3) });
  practiceAudio.src = clip.path ? fileUrl(clip.file) : clip.file; // your own Examen is served by the API
  practiceAudio.onended = () => nextSegment(1);
  practiceAudio.play().catch(() => ($("practice-pause").textContent = "Play"));
}

function startCountdown(seg) {
  const run = practiceRun;
  run.remaining = seg.seconds;
  const tick = () => {
    if (run.paused) return;
    showClock(run.remaining, seg.seconds);
    if (run.remaining <= 0) {
      clearInterval(run.timer);
      endChime();
      return nextSegment(1);
    }
    run.remaining -= 1;
  };
  tick();
  run.timer = setInterval(tick, 1000);
}

function showClock(left, total) {
  const clock = $("practice-clock");
  if (!clock) return;
  clock.textContent = formatClock(left);
  clock.style.setProperty("--p", 1 - left / total);
}

function endChime() {
  const bell = new Audio("sounds/bell.mp3");
  bell.volume = 0.5;
  bell.play().catch(() => {});
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
  store.set(`practice.draft.${run.session.id}.${run.index}`, null);
  try {
    await postJson("/api/practice/journal", { session: run.session.id, question: seg.question, answer });
  } catch (err) {
    showMessage(`Your note couldn't be saved: ${err.message}. It's kept on this device.`);
  }
}

function togglePracticePause() {
  const run = practiceRun;
  if (!run) return;
  const seg = run.session.segments[run.index];
  if (seg.kind === "speak") {
    if (practiceAudio.paused) {
      practiceAudio.play().catch(() => {});
      if (backgroundMusic.paused && store.get("practice.music", "none") !== "none") startMusic();
    }
    else practiceAudio.pause();
    $("practice-pause").textContent = practiceAudio.paused ? "Play" : "Pause";
    return;
  }
  run.paused = !run.paused;
  $("practice-pause").textContent = run.paused ? "Continue" : "Pause";
}

function finishPractice() {
  const run = practiceRun;
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
