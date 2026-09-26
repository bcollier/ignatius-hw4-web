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
    fillPrompts();
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

function fillTierMenu() {
  const tier = $("tier");
  tier.innerHTML = "";
  for (const [key, info] of Object.entries(options.tiers)) {
    tier.add(new Option(info.label, key));
  }
  fillVoiceMenu();
}

function fillVoiceMenu() {
  const info = options.tiers[$("tier").value];
  const voice = $("voice");
  voice.innerHTML = "";
  for (const [id, label] of Object.entries(info.voices)) voice.add(new Option(label, id));
  const minutes = Math.round(info.max_chars / 900);
  $("tier-note").textContent = `Each track is capped at ${info.max_chars.toLocaleString()} characters, about ${minutes} minutes of audio.`;
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

async function buildDay(day) {
  showMessage("");
  try {
    retreat = await api(`/api/retreats/${retreat.id}/days/${day}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tier: $("tier").value,
        voice: $("voice").value,
        heart_prompt: $("heart-prompt").value,
        deep_prompt: $("deep-prompt").value,
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
  const status = node.querySelector(".day-status");
  const building = state.status === "building";
  button.disabled = building;
  button.textContent = building ? "Building…" : state.status === "idle" ? "Build audio" : "Rebuild audio";
  button.onclick = () => buildDay(day.day);

  if (building) {
    const steps = Object.entries(state.tracks).map(([k, t]) => `${TRACK_LABELS[k]}: ${STEP_LABELS[t.status] || t.status}`);
    status.textContent = steps.join(" · ");
    status.className = "day-status status working";
  } else if (state.status === "failed") {
    status.textContent = `Some tracks failed: ${state.error}`;
    status.className = "day-status status bad";
  }

  const pray = node.querySelector(".pray");
  const allReady = state.status === "ready" && Object.values(state.tracks).every((t) => t.status === "ready");
  pray.hidden = !allReady;
  pray.onclick = () => startPrayer(day, state);

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
  title.textContent = TRACK_LABELS[key];
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

// ------------------------------------------------------------------ prayer player
// One <audio> element plays the whole sequence. The pause is real audio (a bell,
// quiet, a bell), so it keeps going when a phone screen locks.

let steps = [];
let stepIndex = 0;
let prayerDay = null;

function buildSequence(day, state) {
  const track = (key) => ({ label: TRACK_LABELS[key], src: fileUrl(state.tracks[key].url) });
  const pauseSeconds = Number($("pause").value);
  const pause = [{ label: "Pause and reflect", src: "sounds/bell.mp3", pause: true }];
  for (let s = 0; s < pauseSeconds; s += 30) pause.push({ label: "Pause and reflect", src: "sounds/quiet30.mp3", pause: true });
  pause.push({ label: "Pause and reflect", src: "sounds/bell.mp3", pause: true });

  if ($("sequence").value === "simple") {
    return [track("reading"), track("heart"), track("deep"), ...pause];
  }
  return [
    track("reading"), track("heart"), track("reading"), track("deep"), track("reading"),
    ...pause,
    { ...track("reading"), label: "The reading, one last time" },
  ];
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
  $("now-step").textContent = `Day ${prayerDay.day}: ${step.label}`;
  $("now-count").textContent = `step ${index + 1} of ${steps.length}`;
  $("pause-text").hidden = !step.pause;
  $("pause-text").textContent = step.pause
    ? "Stay with one word or phrase from the reading that caught you. Let it rest in you until the bell."
    : "";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: step.label,
      artist: `Day ${prayerDay.day}: ${prayerDay.title}`,
      album: retreat.plan.title,
    });
  }
}

function nextBlock(direction) {
  // Treat the pause (bell, quiet, bell) as one step for Back and Skip.
  let i = stepIndex;
  if (direction > 0) {
    if (steps[i].pause) while (i < steps.length && steps[i].pause) i++;
    else i++;
  } else {
    i = Math.max(0, i - 1);
    while (i > 0 && steps[i].pause && steps[i - 1].pause) i--;
  }
  playStep(i);
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
  $("signin-section").hidden = true;
  $("account-bar").hidden = !session;
  $("account-email").textContent = session ? `Signed in as ${session.user.email}` : "";
  $("library-section").hidden = false;
  $("upload-section").hidden = false;
  await loadLibrary();
  const id = new URLSearchParams(location.search).get("r");
  if (id) await openRetreat(id);
}

function showSignedOut() {
  session = null;
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
$("tier").addEventListener("change", fillVoiceMenu);
$("signin-form").addEventListener("submit", sendSignInLink);
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
