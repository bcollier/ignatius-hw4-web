// Frontend for the Ignatius at Home API: upload, poll for the plan, build days, play audio.

const API = window.API_BASE;
const POLL_MS = 2500;
const PLAN_TIMEOUT_MS = 6 * 60 * 1000;
const TRACK_LABELS = { reading: "The reading", heart: "For the heart", deep: "Deep dive" };
const STEP_LABELS = { waiting: "waiting", writing: "writing", speaking: "recording", ready: "ready", failed: "failed" };

const $ = (id) => document.getElementById(id);
let options = null;
let retreat = null;
let pollTimer = null;
let sb = null; // Supabase client, when the server uses sign-in
let session = null;
let me = null; // {mode: "full" | "free", anonymous, max_retreats} from /api/me

// ------------------------------------------------------------------ API helper

class ApiError extends Error {}

async function api(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (sb) {
    const { data } = await sb.auth.getSession(); // refreshes an expired token
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let response;
  try {
    response = await fetch(API + path, { ...init, headers });
  } catch {
    throw new ApiError(
      "Can't reach the server. If it has been idle it may be waking up (this takes up to a minute on Render's free tier). Try again shortly."
    );
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error pages (for example a gateway timeout) fall through to the generic message.
  }
  if (!response.ok) {
    if (response.status === 401 && sb) showSignedOut();
    throw new ApiError(body?.error?.message || `The server returned an error (${response.status}).`);
  }
  return body;
}

// Files come back either as full signed Storage URLs (Supabase) or as paths on
// the API server (local development).
function fileUrl(url) {
  return /^https?:\/\//.test(url) ? url : API + url;
}

function showMessage(text) {
  $("message").textContent = text;
  $("message").hidden = !text;
}

// ------------------------------------------------------------------ start-up

async function checkServer() {
  const status = $("server-status");
  status.textContent = "Checking the server…";
  status.className = "status";
  try {
    const health = await api("/api/health");
    options = await api("/api/options");
    status.textContent = health.llm === "stub"
      ? "Connected. Demo mode: the server has no model key, so plans and reflections are placeholders."
      : "Connected.";
    status.classList.add("ok");
    fillTierMenu();
    fillModels();
    fillPrompts();
    fillGuide();
    return true;
  } catch (err) {
    status.innerHTML = "";
    status.append(err.message + " ");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "link";
    retry.textContent = "Retry";
    retry.onclick = checkServer;
    status.append(retry);
    status.classList.add("bad");
    return false;
  }
}

const SECTIONS = ["guide", "reading", "heart", "deep"];
const DEFAULT_VOICES = {
  guide: "en-US-AvaMultilingualNeural",
  reading: "en-US-AndrewMultilingualNeural",
  heart: "en-US-AndrewMultilingualNeural",
  deep: "en-US-ChristopherNeural",
};

function fillTierMenu() {
  // One menu per section, listing every voice grouped by tier.
  for (const section of SECTIONS) {
    const select = $(`voice-${section}`);
    select.innerHTML = "";
    for (const [, info] of allowedTiers()) {
      const group = document.createElement("optgroup");
      group.label = info.label;
      for (const [id, label] of Object.entries(info.voices)) group.append(new Option(label, id));
      select.append(group);
    }
    let saved = null;
    try {
      saved = localStorage.getItem(`voice.${section}`);
    } catch {}
    const wanted = [saved, DEFAULT_VOICES[section]].find((v) => v && [...select.options].some((o) => o.value === v));
    if (wanted) select.value = wanted;
    select.onchange = () => {
      try {
        localStorage.setItem(`voice.${section}`, select.value);
      } catch {}
      if (retreat?.plan) render();
    };
  }
  const caps = allowedTiers().map(([, t]) => t).map(
    (t) => `${t.label}: up to ${t.max_chars.toLocaleString()} characters a section (about ${Math.round(t.max_chars / 900)} min)`
  );
  $("tier-note").textContent = caps.join(". ") + ". Changing voices only needs a re-record, not a rewrite.";
}

function chosenVoices() {
  return Object.fromEntries(SECTIONS.map((section) => [section, $(`voice-${section}`).value]));
}

// ------------------------------------------------------------------ upload and plan

async function upload(event) {
  event.preventDefault();
  showMessage("");
  const file = $("file").files[0];
  if (!file) return showMessage("Choose a PDF or Word document first.");
  if (!/\.(pdf|docx)$/i.test(file.name)) return showMessage("Only .pdf and .docx files are supported.");
  const maxMb = options?.limits?.max_upload_mb ?? 15;
  if (file.size > maxMb * 1024 * 1024) return showMessage(`That file is larger than ${maxMb} MB.`);

  const form = new FormData();
  form.append("file", file);
  if (promptChanged("plan")) form.append("plan_prompt", $("plan-prompt").value);
  form.append("model", $("plan-model").value);

  const button = $("upload-button");
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    retreat = await api("/api/retreats", { method: "POST", body: form });
    setRetreatInUrl(retreat.id);
    render();
    loadLibrary();
    poll(Date.now());
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Plan my retreat";
  }
}

function busy() {
  return retreat && (retreat.status === "planning" || Object.values(retreat.days).some((d) => d.status === "building"));
}

function poll(startedAt) {
  clearTimeout(pollTimer);
  if (!busy()) return;
  if (retreat.status === "planning" && Date.now() - startedAt > PLAN_TIMEOUT_MS) {
    return showMessage("Planning is taking longer than expected. Reload the page to check again.");
  }
  pollTimer = setTimeout(async () => {
    try {
      const wasBusy = busy();
      retreat = await api(`/api/retreats/${retreat.id}`);
      render();
      if (wasBusy && !busy()) loadLibrary();
    } catch (err) {
      showMessage(err.message);
      if (err.message.startsWith("Retreat not found")) return; // deleted elsewhere; nothing left to poll
    }
    poll(startedAt);
  }, POLL_MS);
}

async function buildDay(day, keepScripts = false) {
  showMessage("");
  try {
    retreat = await api(`/api/retreats/${retreat.id}/days/${day}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voices: chosenVoices(),
        heart_prompt: $("heart-prompt").value,
        deep_prompt: $("deep-prompt").value,
        guide: guideTexts(),
        keep_scripts: keepScripts,
        model: $("write-model").value,
      }),
    });
    render();
    poll(Date.now());
  } catch (err) {
    showMessage(err.message);
  }
}

// ------------------------------------------------------------------ rendering

function render() {
  $("retreat-section").hidden = false;
  const status = $("retreat-status");
  const plan = retreat.plan;

  if (retreat.status === "planning") {
    status.textContent = `Reading ${retreat.filename} and planning the retreat. This usually takes under a minute…`;
    status.className = "status working";
  } else if (retreat.status === "failed") {
    status.textContent = `Planning failed: ${retreat.error}`;
    status.className = "status bad";
  } else {
    status.textContent = "";
    status.className = "status";
  }

  $("retreat-title").textContent = plan?.title || retreat.filename;
  $("retreat-summary").textContent = plan?.summary || "";
  const s = retreat.source;
  const bits = [
    s.kind === "pdf" ? `${s.pages} pages` : "Word document",
    `${s.characters.toLocaleString()} characters`,
    `${s.images} image${s.images === 1 ? "" : "s"}`,
  ];
  if (s.scanned_pages) bits.push(`${s.scanned_pages} scanned page${s.scanned_pages === 1 ? "" : "s"} read by the model`);
  if (s.truncated) bits.push("long document, only the first part was used");
  if (plan) bits.push(plan.mode === "follows_source" ? "days taken from your document" : "days composed from your material");
  const spent = retreatSpent();
  if (spent.usd > 0 || spent.plan) bits.push(`spent so far ${money(spent.usd)}${spent.plan ? ` (planning ${money(spent.plan.usd)} with ${modelLabel(spent.plan.model)})` : ""}`);
  $("retreat-meta").textContent = bits.join(" · ");

  const gallery = $("gallery");
  gallery.innerHTML = "";
  for (const info of retreat.images) {
    const link = document.createElement("a");
    link.href = fileUrl(info.url);
    link.target = "_blank";
    link.rel = "noopener";
    const img = document.createElement("img");
    img.src = fileUrl(info.url);
    img.alt = info.description || "Image from your document";
    img.loading = "lazy";
    link.append(img);
    gallery.append(link);
  }

  $("voice-controls").hidden = !plan;
  const list = $("days");
  list.innerHTML = "";
  for (const day of plan?.days || []) list.append(renderDay(day, retreat.days[day.day]));
}

function renderDay(day, state) {
  const node = $("day-template").content.firstElementChild.cloneNode(true);
  node.querySelector(".day-title").textContent = day.title;
  node.querySelector(".day-ref").textContent = day.source_ref;
  node.querySelector(".day-grace").textContent = day.grace ? `Grace: ${day.grace}` : "";
  node.querySelector(".passage-text").textContent = day.passage_text;

  if (day.image_index >= 0) {
    const img = node.querySelector(".day-image");
    const info = retreat.images[day.image_index];
    img.src = fileUrl(info.url);
    img.alt = info.description || "Image from your document"; // for screen readers only
    img.hidden = false;
  }

  const button = node.querySelector(".build");
  const rerecord = node.querySelector(".rerecord");
  const status = node.querySelector(".day-status");
  const building = state.status === "building";
  const written = state.tracks?.heart?.script && state.tracks?.deep?.script;
  button.disabled = building;
  button.textContent = building ? "Building…" : state.status === "idle" ? "Build audio" : "Rewrite and record";
  button.onclick = () => buildDay(day.day);
  rerecord.hidden = building || !written;
  rerecord.onclick = () => buildDay(day.day, true);

  if (building) {
    const steps = Object.entries(state.tracks).map(([k, t]) => `${TRACK_LABELS[k]}: ${STEP_LABELS[t.status] || t.status}`);
    const guide = Object.values(state.guide || {});
    if (guide.length) steps.push(`guidance: ${guide.filter((c) => c.status === "ready").length} of ${guide.length}`);
    status.textContent = steps.join(" · ");
    status.className = "day-status status working";
  } else if (state.status === "failed") {
    status.textContent = `Some tracks failed: ${state.error}`;
    status.className = "day-status status bad";
  }

  node.querySelector(".day-cost").textContent = building ? "" : dayCostText(day, state);

  const pray = node.querySelector(".pray");
  const allReady = state.status === "ready" && Object.values(state.tracks).every((t) => t.status === "ready");
  pray.hidden = !allReady;
  pray.onclick = () => startPrayer(day, state);
  if (allReady) {
    const seq = buildSequence(day, state);
    const total = totalSeconds(seq);
    const order = $("sequence").value === "lectio" ? "lectio order" : "simple order";
    node.querySelector(".day-length").textContent =
      total == null ? "Working out the length…" : `About ${formatMinutes(total)} in the ${order}, including silences.`;
    if (total == null) probeDurations(seq);
  }

  const tracks = node.querySelector(".tracks");
  for (const key of Object.keys(TRACK_LABELS)) { // reading, heart, deep, in listening order
    const track = state.tracks?.[key];
    if (track?.status !== "ready") continue;
    tracks.append(renderTrack(key, track));
  }
  return node;
}

function renderTrack(key, track) {
  const box = document.createElement("div");
  box.className = "track";
  const title = document.createElement("h4");
  title.textContent = TRACK_LABELS[key] + (track.seconds ? ` · ${formatClock(track.seconds)}` : "");
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = fileUrl(track.url);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = track.trimmed ? "Script (trimmed to the length cap)" : "Script";
  const text = document.createElement("p");
  text.className = "script";
  text.textContent = track.script;
  details.append(summary, text);
  if (track.sources?.length) {
    const sources = document.createElement("ul");
    sources.className = "sources";
    for (const line of track.sources) {
      const li = document.createElement("li");
      const url = line.match(/https?:\/\/\S+/);
      if (url) {
        const a = document.createElement("a");
        a.href = url[0];
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = line;
        li.append(a);
      } else {
        li.textContent = line;
      }
      sources.append(li);
    }
    details.append(sources);
  }
  box.append(title, audio, details);
  return box;
}

// ------------------------------------------------------------------ custom prompts
// The defaults come from the server. Edits are remembered in this browser.

const PROMPT_FIELDS = { plan: "plan-prompt", heart: "heart-prompt", deep: "deep-prompt" };

function defaultPrompt(key) {
  const d = options.prompts;
  return key === "heart" ? d.heart.companion : d[key];
}

function promptChanged(key) {
  return options && $(PROMPT_FIELDS[key]).value.trim() !== defaultPrompt(key).trim();
}

function fillPrompts() {
  for (const [key, id] of Object.entries(PROMPT_FIELDS)) {
    let saved = null;
    try {
      saved = localStorage.getItem(`prompt.${key}`);
    } catch {}
    $(id).value = saved || defaultPrompt(key);
  }
}

function savePrompt(key) {
  try {
    const value = $(PROMPT_FIELDS[key]).value;
    if (value.trim() === defaultPrompt(key).trim()) localStorage.removeItem(`prompt.${key}`);
    else localStorage.setItem(`prompt.${key}`, value);
  } catch {}
}

function wirePrompts() {
  for (const [key, id] of Object.entries(PROMPT_FIELDS)) {
    $(id).addEventListener("input", () => savePrompt(key));
  }
  document.querySelectorAll("[data-reset]").forEach((button) => {
    button.onclick = () => {
      const key = button.dataset.reset;
      $(PROMPT_FIELDS[key]).value = defaultPrompt(key);
      savePrompt(key);
    };
  });
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.onclick = () => {
      $("heart-prompt").value = options.prompts.heart[button.dataset.preset];
      savePrompt("heart");
    };
  });
}

// ------------------------------------------------------------------ models and costs

const isFree = () => me?.mode === "free";
const allowedModels = () => options.models.filter((m) => (isFree() ? m.free : true));
const allowedTiers = () => Object.entries(options.tiers).filter(([key]) => !isFree() || key === "free");

function fillModels() {
  let saved = null;
  try {
    saved = localStorage.getItem("model");
  } catch {}
  for (const select of document.querySelectorAll(".model-select")) {
    select.innerHTML = "";
    for (const m of allowedModels()) {
      select.add(new Option(m.free ? m.label : `${m.label} · $${m.input_per_m} in / $${m.output_per_m} out per million tokens`, m.id));
    }
    const allowed = allowedModels();
    select.value = allowed.some((m) => m.id === saved) ? saved : allowed.some((m) => m.id === options.default_model) ? options.default_model : allowed[0]?.id;
    select.onchange = () => {
      document.querySelectorAll(".model-select").forEach((other) => (other.value = select.value));
      try {
        localStorage.setItem("model", select.value);
      } catch {}
      if (retreat?.plan) render();
    };
  }
  const bal = isFree() ? null : options.elevenlabs?.balance;
  $("balance-note").hidden = !bal;
  if (bal) {
    $("balance-note").textContent =
      `ElevenLabs: ${bal.remaining.toLocaleString()} of ${bal.limit.toLocaleString()} characters left this period ` +
      `(${bal.tier} plan). Estimates use $${options.elevenlabs.usd_per_1k_chars.toFixed(2)} per 1,000 characters.`;
  }
}

const money = (usd) => (usd < 0.01 && usd > 0 ? "under 1¢" : `$${usd.toFixed(2)}`);
const modelLabel = (id) => (options.models.find((m) => m.id === id)?.label || id).replace(/ \(.*\)$/, "");

function tierOfVoice(voice) {
  return Object.entries(options.tiers).find(([, t]) => voice in t.voices)?.[0] || "free";
}

// A rough cost before building. Output tokens include the model's thinking, which
// varies, so they're estimated at about two and a half times the script length.
function estimateDay(day, state, keepScripts) {
  const voices = chosenVoices();
  const model = options.models.find((m) => m.id === $("write-model").value);
  const cap = (section) => options.tiers[tierOfVoice(voices[section])].max_chars;
  const words = (section) => (cap(section) / 6) * 0.85;
  let llm = 0;
  let searches = 0;
  if (!keepScripts && model) {
    const perIn = model.input_per_m / 1e6;
    const perOut = model.output_per_m / 1e6;
    searches = options.web_search ? 5 : 0;
    llm += 2500 * perIn + words("heart") * 1.35 * 2.5 * perOut; // reflection
    llm += (2500 + searches * 8000) * perIn + (words("deep") * 1.35 * 2.5 + 400) * perOut; // deep dive
    llm += searches * model.web_search_each;
  }
  const written = (key) => (keepScripts && state.tracks?.[key]?.characters) || cap(key) * 0.9;
  const guideChars = Object.values(guideTexts()).reduce((n, t) => n + (t.trim() ? t.length + (t.includes("{grace}") ? day.grace.length : 0) : 0), 0);
  const chars = { free: 0, premium: 0 };
  chars[tierOfVoice(voices.reading)] += Math.min(day.passage_text.length, cap("reading"));
  chars[tierOfVoice(voices.heart)] += written("heart");
  chars[tierOfVoice(voices.deep)] += written("deep");
  chars[tierOfVoice(voices.guide)] += guideChars;
  const voiceUsd = (chars.premium / 1000) * (options.elevenlabs?.usd_per_1k_chars || 0);
  return { llm, searches, chars, voiceUsd, total: llm + voiceUsd, model };
}

function voicePart(chars, usd) {
  if (!chars.premium) return "voices free";
  let text = `ElevenLabs ${Math.round(chars.premium).toLocaleString()} characters ≈ ${money(usd)}`;
  const bal = options.elevenlabs?.balance;
  if (bal && chars.premium > bal.remaining) text += ` (more than the ${bal.remaining.toLocaleString()} left on your plan)`;
  return text;
}

function dayCostText(day, state) {
  if (isFree()) return "Free: Jetstream models and free voices.";
  const parts = [];
  if (state.cost) {
    const c = state.cost;
    const writing = c.llm.usd
      ? `writing ${money(c.llm.usd)} with ${modelLabel(c.llm.model)} (${Math.round(c.llm.input_tokens / 1000)}k tokens in, ${Math.round(c.llm.output_tokens / 1000)}k out${c.llm.web_searches ? `, ${c.llm.web_searches} searches` : ""})`
      : "no writing";
    parts.push(`Last build cost ${money(c.total_usd)}: ${writing}, ${voicePart(c.voice_characters, c.voice_usd)}.`);
  }
  const fresh = estimateDay(day, state, false);
  let next = `${state.status === "idle" ? "Estimated" : "Rewriting and recording would cost about"} ${money(fresh.total)}: writing about ${money(fresh.llm)} with ${modelLabel(fresh.model?.id)}, ${voicePart(fresh.chars, fresh.voiceUsd)}.`;
  if (state.status === "idle") next = next.replace("Estimated", "Estimated cost");
  parts.push(next);
  if (state.tracks?.heart?.script) {
    const again = estimateDay(day, state, true);
    parts.push(`Re-recording with these voices: ${again.voiceUsd ? money(again.voiceUsd) : "free"}.`);
  }
  return parts.join(" ");
}

function retreatSpent() {
  const plan = retreat.costs?.plan;
  let usd = plan?.usd || 0;
  for (const d of Object.values(retreat.days || {})) usd += d.cost?.total_usd || 0;
  return { usd, plan };
}

// ------------------------------------------------------------------ spoken guidance

function fillGuide() {
  const box = $("guide-fields");
  box.innerHTML = "";
  for (const [name, text] of Object.entries(options.prompts.guide)) {
    const label = document.createElement("label");
    label.textContent = options.prompts.guide_labels?.[name] || name;
    const area = document.createElement("textarea");
    area.rows = 3;
    area.dataset.guide = name;
    let saved = null;
    try {
      saved = localStorage.getItem(`guide.${name}`);
    } catch {}
    area.value = saved ?? text;
    area.oninput = () => {
      try {
        if (area.value === text) localStorage.removeItem(`guide.${name}`);
        else localStorage.setItem(`guide.${name}`, area.value);
      } catch {}
    };
    label.append(area);
    box.append(label);
  }
}

function guideTexts() {
  return Object.fromEntries([...document.querySelectorAll("[data-guide]")].map((a) => [a.dataset.guide, a.value]));
}

// ------------------------------------------------------------------ prayer player
// One <audio> element plays the whole sequence. The pause is real audio (a bell,
// quiet, a bell), so it keeps going when a phone screen locks.

let steps = [];
let stepIndex = 0;
let prayerDay = null;

const SOUND_SECONDS = { "sounds/bell.mp3": 7.05, "sounds/quiet5.mp3": 5.07, "sounds/quiet30.mp3": 30.07 };
const durationCache = {}; // url -> seconds, for tracks built before lengths were recorded

// The whole prayer as a list of audio steps. Steps share a `block` number, and
// Back and Skip move a block at a time. Each spoken section is followed by five
// seconds of quiet so sections don't run together.
function buildSequence(day, state) {
  const seq = [];
  let block = 0;
  const gap = () => seq.push({ label: "…", src: "sounds/quiet5.mp3", block, quiet: true });
  const speak = (clip, label) => {
    if (clip?.status !== "ready" || !clip.url) return false;
    seq.push({ label, src: fileUrl(clip.url), seconds: clip.seconds, block });
    return true;
  };
  const guide = (name) => speak(state.guide?.[name], (options.prompts.guide_labels || {})[name] || "Guidance");
  const reading = (label) => speak(state.tracks.reading, label) && gap();
  const next = () => (block += 1);

  // Ask for the grace, then silence.
  if (guide("opening")) for (let i = 0; i < Number($("grace-silence").value); i++) gap();
  next();

  const lectio = $("sequence").value === "lectio";
  if (lectio) {
    if (guide("first")) gap();
    reading("First reading");
    next();
    speak(state.tracks.heart, TRACK_LABELS.heart) && gap();
    next();
    if (guide("second")) gap();
    reading("Second reading");
    next();
    speak(state.tracks.deep, TRACK_LABELS.deep) && gap();
    next();
    if (guide("third")) gap();
    reading("Third reading");
    next();
  } else {
    reading(TRACK_LABELS.reading);
    next();
    speak(state.tracks.heart, TRACK_LABELS.heart) && gap();
    next();
    speak(state.tracks.deep, TRACK_LABELS.deep) && gap();
    next();
  }

  // The silence, framed by a bell.
  if (guide("silence")) gap();
  seq.push({ label: "Silence", src: "sounds/bell.mp3", block, pause: true });
  for (let s = 0; s < Number($("pause").value); s += 30) seq.push({ label: "Silence", src: "sounds/quiet30.mp3", block, pause: true });
  seq.push({ label: "Silence", src: "sounds/bell.mp3", block, pause: true });
  gap();
  next();

  if (lectio) {
    if (guide("last")) gap();
    reading("Last reading");
    next();
  }
  guide("closing");
  return seq;
}

function stepSeconds(step) {
  return step.seconds ?? SOUND_SECONDS[step.src] ?? durationCache[step.src];
}

function totalSeconds(seq) {
  let total = 0;
  for (const step of seq) {
    const s = stepSeconds(step);
    if (s == null) return null;
    total += s;
  }
  return total;
}

function formatClock(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatMinutes(seconds) {
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute" : `${m} minute${m === 1 ? "" : "s"}`;
}

// Older tracks have no recorded length; read it from the file's metadata once.
function probeDurations(seq) {
  const missing = [...new Set(seq.filter((st) => stepSeconds(st) == null).map((st) => st.src))];
  let pending = missing.length;
  for (const src of missing) {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = () => {
      if (--pending === 0) render();
    };
    audio.onloadedmetadata = () => {
      durationCache[src] = audio.duration;
      done();
    };
    audio.onerror = done;
    audio.src = src;
  }
}

function startPrayer(day, state) {
  prayerDay = day;
  steps = buildSequence(day, state);
  $("player-bar").hidden = false;
  document.body.classList.add("playing");
  playStep(0);
}

function playStep(index) {
  if (index >= steps.length) return stopPrayer();
  stepIndex = index;
  const step = steps[index];
  const player = $("player");
  player.src = step.src;
  player.play().catch(() => {}); // blocked autoplay leaves the controls ready to tap
  // Show the section being prayed, not the short quiet between sections.
  let shown = step;
  for (let i = index; shown.quiet && i >= 0; i--) shown = steps[i];
  $("now-step").textContent = `Day ${prayerDay.day}: ${shown.label}`;
  const left = totalSeconds(steps.slice(index));
  const blocks = steps[steps.length - 1].block + 1;
  $("now-count").textContent = `part ${step.block + 1} of ${blocks}` + (left != null ? ` · ${formatClock(left)} left` : "");
  $("pause-text").hidden = !step.pause;
  $("pause-text").textContent = step.pause
    ? "Stay with one word or phrase from the reading that caught you. Let it rest in you until the bell."
    : "";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: shown.label,
      artist: `Day ${prayerDay.day}: ${prayerDay.title}`,
      album: retreat.plan.title,
    });
  }
}

function nextBlock(direction) {
  const current = steps[stepIndex].block;
  const firstOf = (block) => steps.findIndex((st) => st.block === block);
  if (direction > 0) {
    const i = steps.findIndex((st) => st.block > current);
    return i < 0 ? stopPrayer() : playStep(i);
  }
  // Back: to the start of this part, or the previous part if already at its start.
  const start = firstOf(current);
  playStep(stepIndex > start ? start : Math.max(0, firstOf(current - 1)));
}

function stopPrayer() {
  const player = $("player");
  player.pause();
  player.removeAttribute("src");
  $("player-bar").hidden = true;
  document.body.classList.remove("playing");
}

function wirePlayer() {
  $("player").addEventListener("ended", () => playStep(stepIndex + 1));
  $("player").addEventListener("error", () => {
    if (!$("player").getAttribute("src")) return; // cleared on Stop
    $("pause-text").hidden = false;
    $("pause-text").textContent =
      "This track couldn't be loaded. Reload the page (links refresh every day) and press Pray this day again.";
  });
  $("next-step").onclick = () => nextBlock(1);
  $("prev-step").onclick = () => nextBlock(-1);
  $("stop-player").onclick = stopPrayer;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("nexttrack", () => nextBlock(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => nextBlock(-1));
  }
}

// ------------------------------------------------------------------ sign-in and library

async function sendSignInLink(event) {
  event.preventDefault();
  const email = $("email").value.trim();
  const button = $("signin-button");
  button.disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  button.disabled = false;
  const note = $("signin-note");
  note.hidden = false;
  note.textContent = error
    ? `Couldn't send the link: ${error.message}`
    : `Check ${email} for a sign-in link. Open it on the device you want to use; each device signs in on its own.`;
}

async function showSignedIn(newSession) {
  session = newSession;
  try {
    me = await api("/api/me");
  } catch (err) {
    if (sb) return showMessage(err.message);
  }
  fillModels();
  fillTierMenu();
  $("signin-section").hidden = true;
  $("account-bar").hidden = !session;
  $("account-email").textContent = !session ? "" : me?.anonymous ? "Guest session (this browser only)" : `Signed in as ${session.user.email}`;
  $("free-banner").hidden = !isFree();
  $("free-banner").textContent = isFree()
    ? `Free mode: retreats are planned and written by open models on Jetstream (no web search) and read by free voices. You can keep up to ${me.max_retreats} retreats.`
    : "";
  $("library-section").hidden = false;
  $("upload-section").hidden = false;
  await loadLibrary();
  const id = new URLSearchParams(location.search).get("r");
  if (id) await openRetreat(id);
}

function showSignedOut() {
  session = null;
  me = null;
  $("free-banner").hidden = true;
  $("guest-box").hidden = !options?.free_mode?.enabled;
  clearTimeout(pollTimer);
  retreat = null;
  $("signin-section").hidden = false;
  for (const id of ["account-bar", "library-section", "upload-section", "retreat-section"]) $(id).hidden = true;
  stopPrayer();
}

async function loadLibrary() {
  let list;
  try {
    list = (await api("/api/retreats")).retreats;
  } catch (err) {
    return showMessage(err.message);
  }
  const ul = $("library");
  ul.innerHTML = "";
  $("library-empty").hidden = list.length > 0;
  for (const item of list) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link library-title";
    open.textContent = item.title;
    open.onclick = () => openRetreat(item.id);
    const meta = document.createElement("span");
    meta.className = "meta";
    const date = new Date(item.created_at * 1000).toLocaleDateString();
    meta.textContent = ` · ${date} · ${item.days_built} of ${item.days} days built`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "link danger";
    del.textContent = "Delete";
    del.onclick = () => deleteRetreat(item, del);
    li.append(open, meta, " ", del);
    ul.append(li);
  }
}

async function openRetreat(id) {
  showMessage("");
  try {
    retreat = await api(`/api/retreats/${id}`);
  } catch (err) {
    setRetreatInUrl(null);
    return showMessage(err.message);
  }
  setRetreatInUrl(id);
  render();
  poll(Date.now());
  $("retreat-section").scrollIntoView({ behavior: "smooth" });
}

async function deleteRetreat(item, button) {
  // Two clicks instead of a browser confirm() dialog.
  if (button.dataset.armed !== "yes") {
    button.dataset.armed = "yes";
    button.textContent = "Click again to delete";
    return;
  }
  try {
    await api(`/api/retreats/${item.id}`, { method: "DELETE" });
    if (retreat?.id === item.id) {
      retreat = null;
      $("retreat-section").hidden = true;
      setRetreatInUrl(null);
    }
    loadLibrary();
  } catch (err) {
    showMessage(err.message);
  }
}

function setRetreatInUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("r", id);
  else url.searchParams.delete("r");
  history.replaceState(null, "", url);
}

// ------------------------------------------------------------------ wiring

$("upload-form").addEventListener("submit", upload);
wirePrompts();
wirePlayer();
$("reset-guide").onclick = () => {
  try {
    Object.keys(options.prompts.guide).forEach((name) => localStorage.removeItem(`guide.${name}`));
  } catch {}
  fillGuide();
};
// Lengths shown on each day follow the prayer settings.
for (const id of ["sequence", "pause", "grace-silence"]) $(id).addEventListener("change", () => retreat?.plan && render());
$("signin-form").addEventListener("submit", sendSignInLink);
$("guest-button").onclick = async () => {
  $("guest-button").disabled = true;
  const { error } = await sb.auth.signInAnonymously();
  $("guest-button").disabled = false;
  if (error) showMessage(`Couldn't start a guest session: ${error.message}`);
};
$("signout").onclick = async () => {
  await sb.auth.signOut();
  showSignedOut();
};

(async () => {
  if (!(await checkServer())) return;
  if (options.auth) {
    sb = window.supabase.createClient(options.auth.url, options.auth.publishable_key);
    // Arriving from the email link, the client reads the token from the URL itself.
    const { data } = await sb.auth.getSession();
    sb.auth.onAuthStateChange((event, newSession) => {
      if (event === "SIGNED_IN" && !session) showSignedIn(newSession);
      if (event === "SIGNED_OUT") showSignedOut();
    });
    if (data.session) await showSignedIn(data.session);
    else showSignedOut();
  } else {
    await showSignedIn(null); // local development: no sign-in
  }
})();
