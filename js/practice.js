// ================================================================ prayer practice (?practice)
// Guided exercises, the same for everyone and recorded once (practice/practice.json):
// the daily prayer practice, the weekly review, and your life's faith story. A voice
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
      el("span", { class: "meta", text: s.summary })));
  }
  $("practice-voice").value = store.get("practice.voice", "standard");
  $("practice-voice").onchange = () => store.set("practice.voice", $("practice-voice").value);
  loadPracticeJournal();
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

// ---------------------------------------------------------------- a session

function startPractice(session) {
  $("practice-menu").hidden = true;
  $("practice-run").hidden = false;
  $("practice-title").textContent = session.title;
  practiceRun = { session, index: -1, timer: null, remaining: 0, paused: false, weekNotes: null };
  requestWakeLock();
  nextSegment(1);
}

function stopPractice() {
  if (!practiceRun) return;
  clearInterval(practiceRun.timer);
  practiceAudio.pause();
  savePracticeAnswer();
  practiceRun = null;
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
  if (seg.kind === "speak") playNarration(seg);
  else startCountdown(seg);
}

function renderSegment(seg) {
  const run = practiceRun;
  const total = run.session.segments.length;
  $("practice-step").textContent = `${seg.step} · ${run.index + 1} of ${total}`;
  $("practice-progress").style.setProperty("--p", (run.index + 1) / total);
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
  const clip = seg.audio?.[voice] || seg.audio?.standard;
  if (!clip) return startCountdown({ ...seg, seconds: Math.ceil(seg.text.split(/\s+/).length / 2.3) });
  practiceAudio.src = clip.file;
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
    if (practiceAudio.paused) practiceAudio.play().catch(() => {});
    else practiceAudio.pause();
    $("practice-pause").textContent = practiceAudio.paused ? "Play" : "Pause";
    return;
  }
  run.paused = !run.paused;
  $("practice-pause").textContent = run.paused ? "Continue" : "Pause";
}

function finishPractice() {
  const run = practiceRun;
  practiceRun = null;
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
  $("practice-next").onclick = () => nextSegment(1);
  $("practice-back").onclick = () => nextSegment(-1);
  $("practice-stop").onclick = () => {
    stopPractice();
    go("?practice");
  };
}
