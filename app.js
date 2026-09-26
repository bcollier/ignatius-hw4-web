// Ignatius at Home: the web app. One page; the URL chooses the view:
//   ./              library (or sign-in)        ./?new           new retreat (Simple / Advanced)
//   ./?r=ID         a retreat                   ./?r=ID&pray=N   praying day N (full screen)
//   ./?talk&r=ID    talk it over (live voice)   ./?me            about me ("user info.md")
//   ./?about        about the tradition
// Sections: helpers · api · settings · router · auth · library · new retreat · retreat ·
// praying · about me · talk · pdf · costs · start-up.

const API = window.API_BASE;
const POLL_MS = 3000;
const TRACK_LABELS = { reading: "The reading", heart: "For the heart", deep: "Deep dive" };
const STATUS_WORDS = { waiting: "waiting", writing: "writing", speaking: "recording", ready: "done", failed: "failed" };
const SECTIONS = ["guide", "reading", "heart", "deep"];
const DEFAULT_VOICES = {
  guide: "en-US-AvaMultilingualNeural",
  reading: "en-US-AndrewMultilingualNeural",
  heart: "en-US-AndrewMultilingualNeural",
  deep: "en-US-ChristopherNeural",
};

// ================================================================ helpers

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

function showMessage(text) {
  $("message").textContent = text || "";
  $("message").hidden = !text;
  if (text) $("message").scrollIntoView({ block: "nearest" });
}

function toast(text) {
  const node = el("div", { class: "toast", role: "status", text });
  document.body.append(node);
  setTimeout(() => node.remove(), 4500);
}

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localToday = () => isoDate(new Date());
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
// The browser's local time with its UTC offset, e.g. 2026-09-26T21:30:00-04:00.
function localTimeWithOffset() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
// Titles the planner copied from the source often start with "Day 3:"; the app adds its own.
const dayTitle = (t) => (t || "").replace(/^\s*day\s+\d+\s*[:.\-–]\s*/i, "").trim() || t || "";
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
const longDate = (value) =>
  new Date(typeof value === "number" ? value * 1000 : value).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const money = (usd) => (usd > 0 && usd < 0.01 ? "under 1¢" : `$${usd.toFixed(2)}`);
const formatClock = (s) => `${Math.floor(Math.round(s) / 60)}:${pad(Math.round(s) % 60)}`;
const formatMinutes = (s) => {
  const m = Math.round(s / 60);
  return m < 1 ? "under a minute" : `${m} minute${m === 1 ? "" : "s"}`;
};

// ================================================================ api

class ApiError extends Error {}
let sb = null; // Supabase client when the server uses sign-in
let session = null;

async function authHeaders() {
  if (!sb) return {};
  const { data } = await sb.auth.getSession(); // refreshes an expired token
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function api(path, init = {}) {
  const headers = { ...(init.headers || {}), ...(await authHeaders()) };
  let response;
  try {
    response = await fetch(API + path, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach the server. If it has been idle it may be waking up, which takes up to a minute. Try again shortly.");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {}
  if (!response.ok) {
    if (response.status === 401 && sb) showSignedOut();
    throw new ApiError(body?.error?.message || `The server returned an error (${response.status}).`);
  }
  return body;
}

const postJson = (path, body, method = "POST") =>
  api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Files are signed Storage URLs (Supabase) or paths on the API server (local).
const fileUrl = (url) => (url && /^https?:\/\//.test(url) ? url : url ? API + url : "");

// ================================================================ state

let options = null; // GET /api/options
let me = null; // GET /api/me
let library = []; // GET /api/retreats
let examples = []; // ready-made example retreats, read only
let retreat = null; // the open retreat
let pollTimer = null;
let selectedDay = null;

const isFree = () => me?.mode === "free";

// ================================================================ settings (the Advanced tab)
// Every option lives in the Advanced panel and is remembered in this browser, so
// Simple uses the same choices. The panel moves into the dialog when a day is rebuilt.

const PROMPT_FIELDS = { plan: "plan-prompt", heart: "heart-prompt", deep: "deep-prompt" };
const defaultPrompt = (key) => (key === "heart" ? options.prompts.heart.companion : options.prompts[key]);
const allowedModels = () => options.models.filter((m) => (isFree() ? m.free : true));
const allowedTiers = () => Object.entries(options.tiers).filter(([key]) => !isFree() || key === "free");

function fillSettings() {
  const allowed = allowedModels();
  const savedModel = store.get("model");
  for (const select of document.querySelectorAll(".model-select")) {
    select.innerHTML = "";
    for (const m of allowed) {
      select.add(new Option(m.free ? m.label : `${m.label} · $${m.input_per_m} in / $${m.output_per_m} out per million tokens`, m.id));
    }
    const fallback = allowed.some((m) => m.id === options.default_model) ? options.default_model : allowed[0]?.id;
    select.value = allowed.some((m) => m.id === savedModel) ? savedModel : fallback;
    select.onchange = () => {
      document.querySelectorAll(".model-select").forEach((other) => (other.value = select.value));
      store.set("model", select.value);
      fillResearch();
      updateEstimate();
    };
  }
  fillResearch();

  for (const section of SECTIONS) {
    const select = $(`voice-${section}`);
    select.innerHTML = "";
    for (const [, info] of allowedTiers()) {
      const group = el("optgroup", { label: info.label });
      for (const [id, label] of Object.entries(info.voices)) group.append(new Option(label, id));
      select.append(group);
    }
    const saved = store.get(`voice.${section}`);
    const wanted = [saved, DEFAULT_VOICES[section]].find((v) => v && [...select.options].some((o) => o.value === v));
    if (wanted) select.value = wanted;
    select.onchange = () => {
      store.set(`voice.${section}`, select.value);
      updateEstimate();
    };
  }
  $("tier-note").textContent = allowedTiers().map(([, t]) => `${t.label}: up to ${t.max_chars.toLocaleString()} characters a section`).join(". ") + ".";
  const bal = isFree() ? null : options.elevenlabs?.balance;
  $("balance-note").hidden = !bal;
  if (bal) $("balance-note").textContent = `ElevenLabs: ${bal.remaining.toLocaleString()} of ${bal.limit.toLocaleString()} characters left this period.`;

  for (const [id, fallback] of [["sequence", "lectio"], ["grace-silence", "3"], ["pause", "30"], ["pray-view", "both"]]) {
    $(id).value = store.get(`play.${id}`, fallback);
    $(id).onchange = () => {
      store.set(`play.${id}`, $(id).value);
      if (id === "pray-view") applyPrayView();
      if (retreat && params().get("r")) renderRetreat();
    };
  }
  $("start-date").value = localToday();
  $("tailor-guide").checked = store.get("tailor", true);
  $("tailor-guide").onchange = () => store.set("tailor", $("tailor-guide").checked);

  for (const [key, id] of Object.entries(PROMPT_FIELDS)) {
    $(id).value = store.get(`prompt.${key}`) || defaultPrompt(key);
    $(id).oninput = () => store.set(`prompt.${key}`, $(id).value.trim() === defaultPrompt(key).trim() ? null : $(id).value);
  }
  document.querySelectorAll("[data-reset]").forEach((b) => {
    b.onclick = () => {
      $(PROMPT_FIELDS[b.dataset.reset]).value = defaultPrompt(b.dataset.reset);
      store.set(`prompt.${b.dataset.reset}`, null);
    };
  });
  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.onclick = () => {
      $("heart-prompt").value = options.prompts.heart[b.dataset.preset];
      store.set("prompt.heart", b.dataset.preset === "companion" ? null : $("heart-prompt").value);
    };
  });

  const box = $("guide-fields");
  box.innerHTML = "";
  for (const [name, text] of Object.entries(options.prompts.guide)) {
    const area = el("textarea", { rows: 3, "data-guide": name });
    area.value = store.get(`guide.${name}`) ?? text;
    area.oninput = () => store.set(`guide.${name}`, area.value === text ? null : area.value);
    box.append(el("label", {}, options.prompts.guide_labels?.[name] || name, area));
  }
  $("reset-guide").onclick = () => {
    Object.keys(options.prompts.guide).forEach((n) => store.set(`guide.${n}`, null));
    fillSettings();
  };
  $("reset-all").onclick = () => {
    try {
      Object.keys(localStorage).filter((k) => /^(model|voice\.|play\.|prompt\.|guide\.|tailor|searchProvider|talk\.)/.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch {}
    fillSettings();
    toast("Every option is back to its default.");
  };
  fillTalkSettings();
}

function fillResearch() {
  const select = $("search-provider");
  const providers = options.search_providers || {};
  select.innerHTML = "";
  for (const [id, label] of Object.entries(providers)) {
    const st = options.search_status?.[id];
    const until = st?.until ? new Date(st.until).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    select.add(new Option(st?.paused ? `${label} · paused, ${st.reason}${until ? ` until ${until}` : ""}` : label, id));
  }
  select.add(new Option("None", "none"));
  const saved = store.get("searchProvider");
  select.value = saved && [...select.options].some((o) => o.value === saved) ? saved : options.default_search_provider || "none";
  select.onchange = () => store.set("searchProvider", select.value);
  const free = options.models.find((m) => m.id === $("write-model").value)?.free;
  // Every model gets the free research first (Claude then also searches on its own).
  $("research-label").hidden = !Object.keys(providers).length;
  $("research-hint").textContent = free
    ? '"All services, combined" asks every search service at once and gives the model the mix. A paused or out-of-credit service is skipped.'
    : "Claude gets these results first as a head start, then searches the web itself as much as it needs.";
}

function talkProviders() {
  const t = options.talk || {};
  const out = {};
  for (const [id, info] of Object.entries(t.providers || {})) {
    out[id] = { ...info, voices: id === "xai" && Object.keys(t.xai_voices || {}).length ? t.xai_voices : info.voices };
  }
  return out;
}

// Recorded samples of the conversation voices (samples/talk/voices.json).
let talkSamples = null;
async function loadTalkSamples() {
  if (talkSamples) return talkSamples;
  try {
    talkSamples = await (await fetch("samples/talk/voices.json")).json();
  } catch {
    talkSamples = { xai: {}, openai: {} };
  }
  return talkSamples;
}
const talkSample = (provider, voice) => talkSamples?.[provider]?.[voice];

function fillTalkSettings() {
  const providers = talkProviders();
  $("talk-fields").hidden = !Object.keys(providers).length;
  if (!Object.keys(providers).length) return;
  const psel = $("talk-provider");
  psel.innerHTML = "";
  for (const [id, info] of Object.entries(providers)) psel.add(new Option(info.label, id));
  const savedP = store.get("talk.provider");
  psel.value = providers[savedP] ? savedP : options.talk.default_provider;
  const fillVoices = () => {
    const info = providers[psel.value];
    const vsel = $("talk-voice");
    vsel.innerHTML = "";
    for (const [id, label] of Object.entries(info.voices)) {
      const gender = talkSample(psel.value, id)?.gender;
      vsel.add(new Option(gender ? `${label} (${gender})` : label, id));
    }
    const savedV = store.get(`talk.voice.${psel.value}`);
    vsel.value = info.voices[savedV] ? savedV : info.default_voice in info.voices ? info.default_voice : Object.keys(info.voices)[0];
    const hear = () => {
      const sample = talkSample(psel.value, vsel.value);
      $("talk-hear").hidden = !sample;
      $("talk-no-sample").hidden = !!sample;
    };
    vsel.onchange = () => {
      store.set(`talk.voice.${psel.value}`, vsel.value);
      hear();
    };
    hear();
  };
  $("talk-hear").onclick = () => {
    const sample = talkSample(psel.value, $("talk-voice").value);
    if (!sample) return;
    const a = $("talk-sample-player");
    a.src = sample.file;
    a.play().catch(() => {});
  };
  if (!talkSamples) loadTalkSamples().then(fillVoices);
  psel.onchange = () => {
    store.set("talk.provider", psel.value);
    fillVoices();
  };
  fillVoices();
}

const chosenVoices = () => Object.fromEntries(SECTIONS.map((s) => [s, $(`voice-${s}`).value]));
const guideTexts = () => Object.fromEntries([...document.querySelectorAll("[data-guide]")].map((a) => [a.dataset.guide, a.value]));

function buildOptions(keepScripts = false) {
  return {
    voices: chosenVoices(),
    model: $("write-model").value,
    search_provider: $("search-provider").value,
    heart_prompt: $("heart-prompt").value,
    deep_prompt: $("deep-prompt").value,
    guide: guideTexts(),
    tailor_guide: $("tailor-guide").checked,
    keep_scripts: keepScripts,
  };
}

const playback = () => ({ order: $("sequence").value, graceGaps: Number($("grace-silence").value), pause: Number($("pause").value) });

// ================================================================ router

const params = () => new URLSearchParams(location.search);

function go(query = "", replace = false) {
  const url = new URL(location.href);
  url.search = query;
  url.hash = "";
  history[replace ? "replaceState" : "pushState"](null, "", url);
  route();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-nav]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  if (link.dataset.nav === "back") return history.length > 1 ? history.back() : go("");
  go(new URL(link.href).search);
});
window.addEventListener("popstate", () => route());

const VIEWS = ["signin", "library", "new", "retreat", "research", "talk", "me", "about"];
function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  window.scrollTo(0, 0);
}

async function route() {
  showMessage("");
  clearTimeout(pollTimer);
  const p = params();
  if (!p.has("pray")) closePrayer(false);
  if (!p.has("talk") && talkState) endTalk("You left the conversation.");
  if (p.has("about")) return show("about");
  if (!signedIn()) return show("signin");
  if (p.has("new")) return openNew();
  if (p.has("me")) return openMe();
  if (p.has("talk")) return openTalk(p.get("r"));
  if (p.has("research") && p.get("r")) return openResearch(p.get("r"));
  if (p.get("r")) return openRetreat(p.get("r"), p.get("pray"));
  return openLibrary();
}

// ================================================================ auth

let authReady = false;
const signedIn = () => authReady && (!sb || !!session);

async function sendSignInLink(event) {
  event.preventDefault();
  const email = $("email").value.trim();
  $("signin-button").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $("signin-button").disabled = false;
  $("signin-note").hidden = false;
  const limited = error && /rate limit|too many/i.test(error.message);
  $("signin-note").textContent = limited
    ? "Too many sign-in emails have gone out in the last hour, so no more can be sent just now. Try again in a little while, or try it without an account below."
    : error ? `Couldn't send the link: ${error.message}` : `Check ${email} for a sign-in link, and open it on the device you want to use.`;
}

async function signedInAs(newSession) {
  session = newSession;
  try {
    me = await api("/api/me");
  } catch (err) {
    return showMessage(err.message);
  }
  fillSettings();
  $("account").hidden = !session;
  $("me-link").hidden = false;
  $("account-email").textContent = !session ? "" : me.anonymous ? "Guest" : `${session.user.email}${me.mode === "full" ? " · premium" : ""}`;
  route();
}

function showSignedOut() {
  session = null;
  me = null;
  retreat = null;
  $("account").hidden = true;
  $("me-link").hidden = true;
  $("guest-box").hidden = !options?.free_mode?.enabled;
  closePrayer(false);
  route();
}

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
  const groups = $("groups");
  groups.innerHTML = "";

  const lastUsed = (r) => Math.max(Date.parse(r.last_prayed_at || 0) || 0, r.created_at * 1000);
  const touched = (r) => (r.day_states || []).some((d) => d.started || d.prayed_at);
  // Your own retreats first, then an example you've begun, then (with nothing of your own) the first example.
  const recent = [...library].sort((a, b) => lastUsed(b) - lastUsed(a))
    .concat(examples.filter(touched), library.length ? [] : examples.filter((r) => !touched(r)));
  const making = library.find((r) => r.status === "planning" || r.status === "building");
  const cont = $("continue");
  cont.innerHTML = "";
  cont.hidden = true;
  for (const r of recent) {
    const pick = nextDay(r, r.day_states || []);
    if (!pick) continue;
    const { d, s } = pick;
    const fresh = r.read_only && !touched(r);
    const lead = fresh ? "Start here · an example retreat" : s.kind === "started" ? "Continue where you left off" : s.kind === "missed" ? `You missed Day ${d.day}` : s.today ? "Today" : "Next";
    cont.append(
      el("p", { class: "eyebrow", text: lead }),
      el("h3", { text: `Day ${d.day}${d.title ? ` · ${dayTitle(d.title)}` : ""}` }),
      el("p", { class: "meta", text: `${r.series?.length ? `Week ${r.series.length + 1} · ` : ""}${r.title}${r.demo ? ` · ${r.demo.label}` : ""}` }),
      el("div", { class: "row-buttons" },
        el("a", { class: "button big", href: `./?r=${r.id}&pray=${d.day}`, "data-nav": "", text: s.kind === "started" ? "Continue praying" : "Pray this day" }),
        el("a", { href: `./?r=${r.id}`, "data-nav": "", text: "Open the retreat" })),
    );
    cont.hidden = false;
    break;
  }
  if (cont.hidden && making) {
    const p = making.progress;
    cont.append(
      el("p", { class: "eyebrow", text: "Being made" }),
      el("h3", { text: making.title }),
      el("p", { class: "meta", text: making.status === "planning" ? "Planning the days…" : `Day ${Math.min((p?.done || 0) + 1, p?.total || 1)} of ${p?.total || "?"}` }),
      el("a", { class: "button", href: `./?r=${making.id}`, "data-nav": "", text: "See progress" }),
    );
    cont.hidden = false;
  }

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
  fillSeriesList();
}

function renderExamples() {
  $("examples").hidden = !examples.length;
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
  del.onclick = async () => {
    if (del.dataset.armed !== "yes") {
      del.dataset.armed = "yes";
      del.textContent = "Click again to delete";
      return;
    }
    try {
      await api(`/api/retreats/${r.id}`, { method: "DELETE" });
      openLibrary();
    } catch (err) {
      showMessage(err.message);
    }
  };
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

// ================================================================ new retreat

function openNew() {
  show("new");
  document.title = "New retreat · Ignatius at Home";
  if ($("advanced").parentElement !== $("panel-advanced")) $("panel-advanced").append($("advanced"));
  setTab(store.get("tab", "simple"));
  $("start-date").value = localToday();
  if (!library.length) api("/api/retreats").then((b) => { library = b.retreats; fillSeriesList(); }).catch(() => {});
  fillSeriesList();
  updateEstimate();
}

function setTab(tab) {
  $("tab-simple").setAttribute("aria-selected", String(tab === "simple"));
  $("tab-advanced").setAttribute("aria-selected", String(tab === "advanced"));
  $("panel-advanced").hidden = tab !== "advanced";
  store.set("tab", tab);
}

function fillSeriesList() {
  const ul = $("series-list");
  const checked = new Set([...ul.querySelectorAll("input:checked")].map((b) => b.value));
  ul.innerHTML = "";
  for (const r of [...library].sort((a, b) => a.created_at - b.created_at).filter((r) => r.status === "ready")) {
    ul.append(el("li", {}, el("label", { class: "check" },
      el("input", { type: "checkbox", value: r.id, checked: checked.has(r.id) }),
      ` ${r.title} · ${new Date(r.created_at * 1000).toLocaleDateString()}`)));
  }
  if (!ul.children.length) ul.append(el("li", { class: "hint", text: "No finished retreats yet." }));
}

function chooseFile(file) {
  $("drop").classList.toggle("chosen", !!file);
  $("drop-title").textContent = file ? file.name : "Choose a PDF or Word document";
}

async function makeRetreat(event) {
  event.preventDefault();
  showMessage("");
  const file = $("file").files[0];
  if (!file) return showMessage("Choose a PDF or Word document first.");
  if (!/\.(pdf|docx)$/i.test(file.name)) return showMessage("Only .pdf and .docx files are supported.");
  const maxMb = options?.limits?.max_upload_mb ?? 15;
  if (file.size > maxMb * 1024 * 1024) return showMessage(`That file is larger than ${maxMb} MB.`);
  const form = new FormData();
  form.append("file", file);
  form.append("model", $("plan-model").value);
  form.append("start_date", $("start-date").value || localToday());
  form.append("options", JSON.stringify(buildOptions()));
  const planPrompt = $("plan-prompt").value;
  if (planPrompt.trim() !== defaultPrompt("plan").trim()) form.append("plan_prompt", planPrompt);
  if ($("series-toggle").checked) {
    const ids = [...document.querySelectorAll("#series-list input:checked")].map((b) => b.value);
    if (!ids.length) return showMessage("Choose at least one earlier week, or untick the series box.");
    form.append("series", ids.join(","));
  }
  const button = $("make-button");
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const made = await api("/api/retreats", { method: "POST", body: form });
    $("new-form").reset();
    chooseFile(null);
    $("series-box").hidden = true;
    fillSettings();
    go(`?r=${made.id}`);
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Make my retreat";
  }
}

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
  const series = retreat.series?.length;
  $("retreat-series").hidden = !series;
  if (series) {
    const titles = retreat.series.map((id) => library.find((r) => r.id === id)?.title).filter(Boolean);
    $("retreat-series").textContent = `Week ${retreat.series.length + 1} of a series${titles.length ? `, after ${titles.join(" → ")}` : ""}.`;
  }
  const written = Object.values(retreat.days).some((d) => d.tracks?.heart?.script && d.tracks?.deep?.script);
  $("retreat-pdf").hidden = !written;
  $("talk-button").hidden = !options.talk?.enabled || !plan;
  const ro = !!retreat.read_only;
  $("example-note").hidden = !ro;
  $("example-note").textContent = ro ? `${retreat.demo?.label || "An example retreat"}. It's ready to listen to and pray; your progress and notes are yours alone.` : "";
  // Research notes are always there on a computer, tucked away at the foot of the page.
  $("research-link").hidden = !plan || busy();
  $("research-link").href = `./?r=${retreat.id}&research`;

  $("retreat-error").hidden = retreat.status !== "failed";
  $("retreat-error").textContent = retreat.status === "failed" ? `Making this retreat failed: ${retreat.error}` : "";
  const making = retreat.status === "planning" || retreat.status === "building";
  $("progress").hidden = !making;
  if (making) renderProgress();
  $("days-area").hidden = !plan || making;
  if (plan && !making) {
    renderStrip();
    renderDay();
  }
  renderCosts();
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

function renderDay() {
  const d = planDay(selectedDay);
  const st = retreat.days[String(d.day)];
  const s = dayState(retreat, { ...st, day: d.day });
  const panel = $("day-panel");
  panel.innerHTML = "";
  panel.append(el("p", { class: "meta", text: `Day ${d.day}${s.date ? ` · ${longDate(`${s.date}T12:00:00`)}` : ""}${s.today ? " · today" : ""}` }));
  panel.append(el("h2", { text: dayTitle(d.title) }));
  if (d.source_ref && d.source_ref.trim() !== dayTitle(d.title).trim()) panel.append(el("p", { class: "meta", text: d.source_ref }));
  const img = dayImages(d)[0];
  if (img) panel.append(el("img", { class: "day-image", src: fileUrl(img.url), alt: img.description || "Image for this day" }));
  if (d.grace) panel.append(el("p", { class: "grace", text: `Grace: ${d.grace}` }));
  panel.append(el("p", { class: "passage", text: d.passage_text }));

  const l = st.listening;
  let line = "";
  if (s.prayed) line = `Prayed ${longDate(st.prayed_at)}.`;
  else if (s.kind === "started") line = `You listened as far as ${l.last_part || "part of it"} on ${longDate(l.updated_at)}, then stopped.`;
  else if (s.kind === "missed") line = "You haven't prayed this day yet.";
  if (line) panel.append(el("p", { class: `state-line ${s.kind === "missed" ? "missed" : ""}`, text: line }));

  if (st.status === "ready") {
    const seq = buildSequence(d, st);
    const total = totalSeconds(seq);
    const row = el("div", { class: "pray-row" });
    if (s.kind === "started" && l?.last_step > 0) {
      row.append(el("button", { type: "button", class: "big", text: "Continue praying", onclick: () => go(`?r=${retreat.id}&pray=${d.day}&from=${l.last_step}`) }));
      row.append(el("button", { type: "button", class: "secondary", text: "Start over", onclick: () => go(`?r=${retreat.id}&pray=${d.day}`) }));
    } else {
      row.append(el("button", { type: "button", class: "big", text: "Pray this day", onclick: () => go(`?r=${retreat.id}&pray=${d.day}`) }));
    }
    row.append(el("span", { class: "meta", text: total == null ? "" : `About ${formatMinutes(total)}` }));
    if (total == null) probeDurations(seq);
    panel.append(row);
    panel.append(el("div", { class: "quiet-row" },
      el("button", { type: "button", class: "link", text: s.prayed ? "Mark as not prayed" : "Mark as prayed", onclick: () => markPrayed(d.day, { prayed: !s.prayed }) }),
      el("button", { type: "button", class: "link", text: "Printable script (PDF)", onclick: (e) => downloadScript(d.day, e.target) }),
      el("a", { class: "link desktop-only", href: `./?r=${retreat.id}&research#research-day-${d.day}`, "data-nav": "", text: "Research notes" }),
      dayMenu(d, st)));
  } else if (st.status === "failed") {
    panel.append(el("p", { class: "state-line missed", text: `Making this day didn't finish: ${st.error || "unknown error"}` }));
    const clips = [...Object.values(st.tracks || {}), ...Object.values(st.guide || {})];
    const fromScripts = !retreat.read_only && st.params && clips.every((c) => c.status === "ready" || c.script);
    panel.append(el("div", { class: "pray-row" },
      !retreat.read_only && el("button", { type: "button", text: "Try again", onclick: () => (fromScripts ? retryDay(d.day) : rebuildDay(d.day, false)) }),
      fromScripts && el("span", { class: "hint", text: "Only the parts that failed are recorded again." }),
      dayMenu(d, st)));
  } else if (st.status === "idle") {
    panel.append(el("div", { class: "pray-row" }, el("button", { type: "button", text: "Make this day", onclick: () => rebuildDay(d.day, false) })));
  } else {
    panel.append(el("p", { class: "state-line", text: "This day is being made…" }));
  }

  if (st.journal?.word || st.journal?.note) {
    panel.append(el("div", { class: "journal" },
      st.journal.word && el("p", {}, el("strong", { text: "The word that stayed: " }), st.journal.word),
      st.journal.note && el("p", { text: st.journal.note })));
  }
  const tracks = Object.keys(TRACK_LABELS).filter((k) => st.tracks?.[k]?.status === "ready");
  if (tracks.length) {
    const parts = el("details", { class: "parts" }, el("summary", { text: "Listen to a part" }));
    for (const k of tracks) parts.append(renderTrack(k, st.tracks[k]));
    panel.append(parts);
  }
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

// ================================================================ research

async function openResearch(id) {
  show("research");
  $("research-days").innerHTML = "";
  $("research-toc").innerHTML = "";
  $("research-meta").textContent = "Loading…";
  let r;
  try {
    r = await api(`/api/retreats/${id}/research`);
  } catch (err) {
    $("research-meta").textContent = "";
    return showMessage(err.message);
  }
  document.title = `Research · ${r.title || "Retreat"} · Ignatius at Home`;
  $("research-title").textContent = `Research done for ${r.title || "this retreat"}`;
  $("research-meta").textContent = [r.source_filename && `Made from ${r.source_filename}`, r.model && `written by ${modelLabel(r.model)}`].filter(Boolean).join(", ");
  for (const d of r.days) {
    $("research-toc").append(el("a", { href: `#research-day-${d.day}`, text: `Day ${d.day}` }));
    $("research-days").append(renderResearchDay(d));
  }
  const target = location.hash && document.querySelector(location.hash);
  if (target) target.scrollIntoView();
}

function renderResearchDay(d) {
  const card = el("article", { class: "card research-day", id: `research-day-${d.day}` },
    el("p", { class: "meta", text: `Day ${d.day}${d.source_ref ? ` · ${d.source_ref}` : ""}` }),
    el("h2", { text: dayTitle(d.title) }));
  card.append(el("h3", { text: "From your document" }));
  for (const [k, v] of Object.entries(d.notes || {})) card.append(el("p", {}, el("strong", { text: `${k.replace("_", " ")}: ` }), v));
  card.append(el("p", { class: "passage", text: d.passage_text || "" }));

  const f = d.research;
  const urlOf = (line) => line.match(/https?:\/\/[^\s)]+/)?.[0];
  const cited = new Set((d.cited || []).map(urlOf).filter(Boolean));
  card.append(el("h3", { text: "Research for the deep dive" }));
  if (!f) {
    card.append(el("p", { class: "hint", text: d.web_search
      ? "This day was made before research was saved, so only the cited sources are known."
      : d.status === "ready" ? "No web research was done for this day." : "This day hasn't been made yet." }));
  } else {
    const who = f.how === "model web search" ? "The model searched the web itself" : `Searched with ${d.research_service || f.service}`;
    const extra = f.contributors?.length ? ` (results from ${f.contributors.map((c) => options.search_providers?.[c] || c).join(", ")})` : "";
    card.append(el("p", { class: "meta", text: `${who}${extra} · ${f.results.length} results · ${cited.size} cited` }));
    if (f.skipped?.length) card.append(el("p", { class: "hint", text: `Skipped: ${f.skipped.join("; ")}` }));
    if (f.queries?.length) card.append(el("p", { class: "meta", text: "Searches" }), el("ol", { class: "research-queries" }, f.queries.map((q) => el("li", { text: q }))));
    card.append(el("ul", { class: "research-results" }, f.results.map((x) =>
      el("li", { class: cited.has(x.url) ? "cited" : "" },
        el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.title || x.url }),
        x.service && el("span", { class: "service", text: options.search_providers?.[x.service] || x.service }),
        cited.has(x.url) && el("span", { class: "service", text: "· cited" }),
        x.content && el("p", { class: "snippet", text: x.content })))));
  }
  if (d.cited?.length) {
    card.append(el("h3", { text: "Sources the deep dive cites" }));
    card.append(el("ul", { class: "sources" }, d.cited.map((line) => {
      const url = urlOf(line);
      return el("li", {}, url ? el("a", { href: url, target: "_blank", rel: "noopener", text: line }) : line);
    })));
  }
  return card;
}

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

// ================================================================ praying

let steps = [];
let stepIndex = 0;
let prayerDay = null;
let partsPlayed = new Set();
let lastReport = 0;
let wakeLock = null;
let imageTimer = null;
let shownImage = -1;
const SOUND_SECONDS = { "sounds/bell.mp3": 7.05, "sounds/quiet5.mp3": 5.07, "sounds/quiet30.mp3": 30.07 };
const durationCache = {};

// The prayer as audio steps. Steps share a `block` (a part of the prayer); Back and
// Skip move a block at a time. Each spoken part is followed by five seconds of quiet.
// `part` names what was heard, for listening progress.
function buildSequence(day, state) {
  const { order, graceGaps, pause } = playback();
  const seq = [];
  let block = 0;
  const gap = () => seq.push({ label: "…", src: "sounds/quiet5.mp3", block, quiet: true });
  const speak = (clip, label, part) => {
    if (clip?.status !== "ready" || !clip.url) return false;
    seq.push({ label, part, src: fileUrl(clip.url), seconds: clip.seconds, block, text: clip.script, words: clip.words });
    return true;
  };
  const labels = options.prompts.guide_labels || {};
  const guide = (name) => speak(state.guide?.[name], labels[name] || "Guidance", name);
  const reading = (label, part) => speak(state.tracks.reading, label, part) && gap();
  const next = () => (block += 1);

  if (guide("opening")) for (let i = 0; i < graceGaps; i++) gap();
  next();
  if (order === "lectio") {
    if (guide("first")) gap();
    reading("First reading", "reading1");
    next();
    speak(state.tracks.heart, TRACK_LABELS.heart, "heart") && gap();
    next();
    if (guide("second")) gap();
    reading("Second reading", "reading2");
    next();
    speak(state.tracks.deep, TRACK_LABELS.deep, "deep") && gap();
    next();
    if (guide("third")) gap();
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
  if (guide("silence")) gap();
  seq.push({ label: "Silence", part: "silence", src: "sounds/bell.mp3", block, pause: true });
  for (let s = 0; s < pause; s += 30) seq.push({ label: "Silence", src: "sounds/quiet30.mp3", block, pause: true });
  seq.push({ label: "Silence", src: "sounds/bell.mp3", block, pause: true });
  gap();
  next();
  if (order === "lectio") {
    if (guide("last")) gap();
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
}

function startPrayer(dayNo) {
  const d = planDay(dayNo);
  const st = retreat?.days[String(dayNo)];
  if (!d || st?.status !== "ready") return showMessage("This day isn't ready to pray yet.");
  prayerDay = d;
  steps = buildSequence(d, st);
  partsPlayed = new Set(st.listening?.parts_played || []);
  openPrayScreen();
  $("after").hidden = true;
  setDockExpanded(false);

  const images = dayImages(d);
  shownText = null;
  applyPrayView();
  $("stage-title").textContent = `Day ${d.day} · ${dayTitle(d.title)}`;
  $("stage-grace").textContent = d.grace ? (/^ask /i.test(d.grace) ? d.grace : `Ask for the grace ${d.grace.replace(/^the grace\s+/i, "")}`) : "";
  shownImage = -1;
  for (const id of ["stage-a", "stage-b"]) {
    $(id).removeAttribute("src");
    $(id).classList.toggle("shown", id === "stage-a");
  }
  if (images.length) showImage(0);

  const blocks = [...new Set(steps.map((s) => s.block))];
  $("segments").innerHTML = "";
  $("part-list").innerHTML = "";
  for (const b of blocks) {
    const secs = steps.filter((s) => s.block === b).reduce((n, s) => n + (stepSeconds(s) || 30), 0);
    const seg = el("span", { "data-block": b }, el("i"));
    seg.style.flexGrow = String(Math.max(1, secs));
    $("segments").append(seg);
    const li = el("li", { "data-block": b, text: blockLabel(b) });
    li.onclick = () => playStep(steps.findIndex((s) => s.block === b));
    $("part-list").append(li);
  }
  const from = Number(params().get("from") || 0);
  playStep(from > 0 && from < steps.length ? from : 0);
  requestWakeLock();
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
  player.play().catch(() => setPlayIcon(false)); // iOS may need a tap on play
  if (step.part) partsPlayed.add(step.part);
  const shown = step.quiet ? [...steps.slice(0, stepIndex)].reverse().find((s) => !s.quiet) || step : step;
  $("now-part").textContent = shown.label;
  const left = totalSeconds(steps.slice(stepIndex));
  const blocks = steps[steps.length - 1].block + 1;
  $("now-meta").textContent = `Day ${prayerDay.day} · part ${step.block + 1} of ${blocks}${left != null ? ` · ${formatClock(left)} left` : ""}`;
  $("stage-caption").hidden = !step.pause;
  $("stage-caption").textContent = step.pause ? "Stay with one word or phrase that caught you. Let it rest in you until the bell." : "";
  $("pause-text").textContent = step.pause ? "Silence. Stay with one word or phrase until the bell." : "";
  document.querySelectorAll("#segments span, #part-list li").forEach((n) => {
    const b = Number(n.dataset.block);
    n.classList.toggle("done", b < step.block);
    n.classList.toggle("now", b === step.block);
  });
  if (dayImages(prayerDay).length > 1) showImage(step.block);
  showStepText(step, shown);
  if ("mediaSession" in navigator) {
    const img = dayImages(prayerDay)[0];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: shown.label, artist: `Day ${prayerDay.day}: ${dayTitle(prayerDay.title)}`, album: retreat.plan.title,
      artwork: img ? [{ src: fileUrl(img.url), sizes: "960x960", type: "image/jpeg" }] : [],
    });
  }
  reportProgress(false);
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
  $("view-toggle").textContent = { both: "Aa", image: "▣", text: "¶" }[view];
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
  $("play-pause").textContent = playing ? "❚❚" : "▶";
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
    shownImage = -1;
    if (images.length) showImage(0);
  }
  $("after-word").value = journal?.word || "";
  $("after-note").value = journal?.note || "";
  $("after").hidden = false;
  $("after-word").focus();
}

async function saveAfter() {
  await markPrayed(prayerDay.day, { prayed: true, word: $("after-word").value, note: $("after-note").value });
  closePrayer();
}

function closePrayer(navigate = true) {
  if (!document.body.classList.contains("praying")) return;
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

function wirePlayer() {
  const player = $("player");
  player.addEventListener("ended", () => playStep(stepIndex + 1));
  player.addEventListener("play", () => {
    setPlayIcon(true);
    if (!followFrame) followFrame = requestAnimationFrame(followWord);
  });
  player.addEventListener("pause", () => setPlayIcon(false));
  player.addEventListener("timeupdate", () => {
    const seg = document.querySelector("#segments span.now i");
    const step = steps[stepIndex];
    if (seg && step) {
      const blockSteps = steps.filter((s) => s.block === step.block);
      const total = blockSteps.reduce((n, s) => n + (stepSeconds(s) || 0), 0) || 1;
      const before = blockSteps.slice(0, blockSteps.indexOf(step)).reduce((n, s) => n + (stepSeconds(s) || 0), 0);
      seg.style.setProperty("--p", Math.min(1, (before + player.currentTime) / total));
    }
    if (Date.now() - lastReport > 30000) reportProgress(false);
  });
  player.addEventListener("error", () => {
    if (!player.getAttribute("src")) return;
    $("now-meta").textContent = "This part couldn't be loaded. Close and reopen the day to refresh its links.";
  });
  $("play-pause").onclick = () => (player.paused ? player.play() : player.pause());
  $("next-step").onclick = () => nextBlock(1);
  $("prev-step").onclick = () => nextBlock(-1);
  $("stop-player").onclick = () => closePrayer();
  $("pray-close").onclick = () => closePrayer();
  $("dock-expand").onclick = () => setDockExpanded($("dock-more").hidden);
  $("view-toggle").onclick = cyclePrayView;
  $("stage").onclick = (e) => e.target.id !== "pray-close" && setDockExpanded(false);
  $("after-save").onclick = saveAfter;
  $("after-done").onclick = () => closePrayer();
  document.addEventListener("visibilitychange", () => {
    if (!document.body.classList.contains("praying")) return;
    if (document.visibilityState === "hidden") reportProgress(false);
    else if (!wakeLock && !player.paused) requestWakeLock();
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("nexttrack", () => nextBlock(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => nextBlock(-1));
    navigator.mediaSession.setActionHandler("play", () => player.play());
    navigator.mediaSession.setActionHandler("pause", () => player.pause());
  }
}

// ================================================================ about me ("user info.md")

async function openMe() {
  show("me");
  document.title = "About me · Ignatius at Home";
  $("me-status").textContent = "";
  try {
    renderMe(await api("/api/profile"));
  } catch (err) {
    showMessage(err.message);
  }
}

function renderMe(p) {
  $("me-about").value = p.about || "";
  $("me-notes").value = p.companion_notes || "";
  $("me-summary-note").hidden = !p.summarized;
  $("me-summary-note").textContent = p.summarized
    ? `What you gave was ${p.original_characters.toLocaleString()} characters, so a model condensed it to the summary above, and that summary is what's used. Edit it here if anything important is missing.`
    : "";
}

async function saveMe(event) {
  event.preventDefault();
  $("me-save").disabled = true;
  $("me-status").textContent = "Saving…";
  try {
    const p = await postJson("/api/profile", { about: $("me-about").value, companion_notes: $("me-notes").value }, "PUT");
    renderMe(p);
    $("me-status").textContent = p.summarized ? "Saved as a summary." : "Saved.";
  } catch (err) {
    $("me-status").textContent = "";
    showMessage(err.message);
  } finally {
    $("me-save").disabled = false;
  }
}

async function uploadMe() {
  const file = $("me-file").files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  $("me-status").textContent = "Reading your file…";
  try {
    const p = await api("/api/profile/upload", { method: "POST", body: form });
    // The notes box keeps what was typed; save it too so nothing is lost.
    if ($("me-notes").value.trim() !== (p.companion_notes || "").trim()) {
      await postJson("/api/profile", { companion_notes: $("me-notes").value }, "PUT");
      p.companion_notes = $("me-notes").value;
    }
    renderMe(p);
    $("me-status").textContent = p.summarized ? "Saved as a summary of your file." : "Saved from your file.";
  } catch (err) {
    $("me-status").textContent = "";
    showMessage(err.message);
  } finally {
    $("me-file").value = "";
  }
}

// ================================================================ talk it over (live voice)
// OpenAI GPT-Live: WebRTC; the server relays the offer and returns the answer.
// xAI Grok voice: WebSocket with a short-lived token from the server; audio is PCM16
// at 24 kHz, captured with an AudioWorklet and played back as scheduled buffers.

let talkState = null;

async function openTalk(retreatId) {
  show("talk");
  document.title = "Talk it over · Ignatius at Home";
  $("talk-transcript").innerHTML = "";
  $("talk-status").textContent = "";
  $("talk-status").className = "status";
  if (retreatId && retreat?.id !== retreatId) {
    try {
      retreat = await api(`/api/retreats/${retreatId}`);
    } catch (err) {
      return showMessage(err.message);
    }
  }
  const t = options.talk || {};
  const providers = talkProviders();
  if (!t.enabled) {
    $("talk-context").textContent = "Live conversation isn't set up on this server yet.";
    $("talk-start").disabled = true;
    return;
  }
  $("talk-start").disabled = false;
  const r = retreatId ? retreat : null;
  const listened = r ? Object.values(r.days).filter((d) => d.prayed_at || d.listening?.parts_played?.length).length : 0;
  $("talk-context").textContent = r
    ? `About “${r.plan?.title}”: the companion knows its ${r.plan?.days.length} days and that you've listened to ${listened} of them.`
    : "Not tied to a retreat. Open a retreat and choose “Talk it over” to talk about it.";
  const provider = providers[$("talk-provider").value] ? $("talk-provider").value : t.default_provider;
  const voice = $("talk-voice").value;
  $("talk-voice-line").textContent = `${providers[provider].label}, voice ${providers[provider].voices[voice] || voice}. Change these in New retreat → Advanced → Conversation.`;
  $("talk-limit").hidden = !isFree();
  $("talk-limit").textContent = `Free accounts can talk for ${t.free_seconds} seconds a day. Premium accounts can talk for up to ${Math.round(t.max_seconds / 60)} minutes at a time.`;
  $("talk-start").textContent = "Start talking";
  $("talk-start").hidden = false;
  $("talk-stop").hidden = true;
  $("talk-timer").hidden = true;
  $("talk-start").onclick = () => startTalk(provider, voice, r?.id || null);
  $("talk-stop").onclick = () => endTalk("You ended the conversation.");
  loadTalkHistory();
}

async function loadTalkHistory() {
  const list = $("talk-history");
  list.innerHTML = "";
  try {
    const h = await api("/api/talk/history");
    for (const c of [...h.conversations].reverse()) {
      const when = new Date(c.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const item = el("li", {}, `${when} · ${c.retreat_title || "no retreat"} · ${formatMinutes(c.seconds || 0)}`);
      if (c.transcript) item.append(el("details", {}, el("summary", { text: "Transcript" }), el("pre", { text: c.transcript })));
      else item.append(el("span", { class: "meta", text: " (now part of the summary)" }));
      list.append(item);
    }
    if (!h.conversations.length) list.append(el("li", { class: "hint", text: "No conversations yet." }));
    $("talk-memory").hidden = !h.memory;
    $("talk-memory").textContent = h.memory ? `What the companion remembers from earlier conversations: ${h.memory}` : "";
  } catch {}
}

function transcriptLine(who, replace = false) {
  const list = $("talk-transcript");
  const last = list.lastElementChild;
  if (last && last.dataset.who === who && !replace) return last;
  if (replace && last && last.dataset.who === who && last.dataset.live === "1") return last;
  const li = el("li", { class: who, "data-who": who });
  list.append(li);
  return li;
}

function talkConnected(max) {
  talkState.started = Date.now();
  talkState.max = max;
  $("talk-status").className = "status ok";
  $("talk-status").textContent = "Connected. The companion will greet you; speak whenever you're ready.";
  $("talk-start").hidden = true;
  $("talk-stop").hidden = false;
  $("talk-timer").hidden = false;
  $("talk-orb").hidden = false;
  talkState.timer = setInterval(() => {
    const secs = (Date.now() - talkState.started) / 1000;
    $("talk-timer").textContent = `${formatClock(secs)}${talkState.max ? ` of ${formatClock(talkState.max)}` : ""}`;
    if (talkState.max && secs >= talkState.max) endTalk(isFree() ? "That's today's free time. Thank you for talking." : "The conversation reached its time limit.");
  }, 500);
}

async function startTalk(provider, voice, retreatId) {
  const status = $("talk-status");
  status.className = "status working";
  status.textContent = "Asking for your microphone…";
  $("talk-start").disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    talkState = { provider, stream, transcriptParts: [] };
    status.textContent = "Connecting…";
    if (provider === "xai") await startGrok(stream, voice, retreatId);
    else await startOpenAI(stream, voice, retreatId);
  } catch (err) {
    status.className = "status bad";
    status.textContent = err.name === "NotAllowedError" ? "The microphone wasn't allowed. Allow it in the browser's settings to talk." : err.message;
    $("talk-start").disabled = false;
    cleanupTalk();
    talkState = null;
  }
}

async function startOpenAI(stream, voice, retreatId) {
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => (audio.srcObject = e.streams[0]);
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  const dc = pc.createDataChannel("oai-events");
  Object.assign(talkState, { pc, dc, audio });
  dc.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "session.input_transcript.delta") addTranscript("you", ev.delta);
    else if (ev.type === "session.output_transcript.delta") addTranscript("companion", ev.delta);
    else if (ev.type === "session.closed") endTalk(ev.reason === "expired" ? "The conversation reached its time limit." : "The conversation ended.");
    else if (ev.type === "error") talkError(ev.error?.message);
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await postJson("/api/talk/session", { provider: "openai", voice, sdp: offer.sdp, retreat_id: retreatId, local_time: localTimeWithOffset() });
  talkState.sessionId = res.session_id;
  await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState) && talkState) endTalk("The connection ended.");
  };
  talkConnected(res.max_seconds);
}

// PCM16 capture in an AudioWorklet (inline, so no extra file is needed).
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.len = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) { this.buf.push(new Float32Array(ch)); this.len += ch.length; }
    if (this.len >= 960) { // about 40 ms at 24 kHz
      const out = new Int16Array(this.len); let o = 0;
      for (const b of this.buf) for (let i = 0; i < b.length; i++) { const s = Math.max(-1, Math.min(1, b[i])); out[o++] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage(out.buffer, [out.buffer]); this.buf = []; this.len = 0;
    }
    return true;
  }
}
registerProcessor("capture", Capture);`;

const toBase64 = (buffer) => {
  let bin = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

async function startGrok(stream, voice, retreatId) {
  const res = await postJson("/api/talk/session", { provider: "xai", voice, retreat_id: retreatId, local_time: localTimeWithOffset() });
  const ctx = new AudioContext({ sampleRate: 24000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" })));
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, "capture");
  source.connect(capture);
  const ws = new WebSocket(res.ws_url, [`xai-client-secret.${res.token}`]);
  Object.assign(talkState, { ws, ctx, capture, sessionId: res.session_id, playAt: 0, sources: new Set(), liveUser: null });
  capture.port.onmessage = (e) => {
    if (ws.readyState === WebSocket.OPEN && talkState?.ready) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(e.data) }));
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("Couldn't connect to the Grok voice service."));
    setTimeout(() => reject(new Error("The Grok voice service didn't answer.")), 15000);
  });
  ws.onmessage = (e) => onGrokEvent(JSON.parse(e.data));
  ws.onclose = () => talkState && endTalk("The conversation ended.");
  ws.send(JSON.stringify({ type: "session.update", session: res.session }));
  talkConnected(res.max_seconds);
}

function onGrokEvent(ev) {
  const t = talkState;
  if (!t) return;
  switch (ev.type) {
    case "session.updated":
      if (!t.ready) {
        t.ready = true;
        t.ws.send(JSON.stringify({ type: "response.create" })); // the companion speaks first
      }
      break;
    case "response.output_audio.delta":
    case "response.audio.delta":
      playPcm(ev.delta);
      break;
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      addTranscript("companion", ev.delta);
      break;
    case "conversation.item.input_audio_transcription.updated": {
      const li = t.liveUser || transcriptLine("you");
      li.dataset.live = "1";
      li.textContent = ev.transcript || ev.text || li.textContent;
      t.liveUser = li;
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const li = t.liveUser || transcriptLine("you");
      li.textContent = ev.transcript || li.textContent;
      delete li.dataset.live;
      t.liveUser = null;
      t.transcriptParts.push(["you", li.textContent]);
      break;
    }
    case "input_audio_buffer.speech_started":
      for (const s of t.sources) try { s.stop(); } catch {} // let the person interrupt
      t.sources.clear();
      t.playAt = 0;
      break;
    case "error":
      talkError(ev.error?.message || ev.message);
      break;
  }
}

function playPcm(b64) {
  const t = talkState;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const buffer = t.ctx.createBuffer(1, pcm.length, 24000);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = t.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(t.ctx.destination);
  const at = Math.max(t.ctx.currentTime + 0.02, t.playAt);
  src.start(at);
  t.playAt = at + buffer.duration;
  t.sources.add(src);
  src.onended = () => t.sources.delete(src);
  $("talk-orb").style.transform = "scale(1.08)";
  setTimeout(() => ($("talk-orb").style.transform = ""), 150);
}

function addTranscript(who, text) {
  if (!text) return;
  const li = transcriptLine(who);
  li.textContent += text;
  $("talk-transcript").scrollTop = $("talk-transcript").scrollHeight;
}

function talkError(message) {
  $("talk-status").className = "status bad";
  $("talk-status").textContent = message || "Something went wrong in the conversation.";
}

async function endTalk(message) {
  if (!talkState) return;
  const t = talkState;
  talkState = null;
  try {
    if (t.dc?.readyState === "open") t.dc.send(JSON.stringify({ type: "session.close" }));
  } catch {}
  const seconds = t.started ? Math.round((Date.now() - t.started) / 1000) : 0;
  const transcript = [...$("talk-transcript").children].map((li) => `${li.dataset.who === "you" ? "You" : "Companion"}: ${li.textContent}`).join("\n");
  cleanupTalk(t);
  $("talk-status").className = "status";
  $("talk-status").textContent = message;
  $("talk-start").hidden = false;
  $("talk-start").disabled = false;
  $("talk-start").textContent = "Talk again";
  $("talk-stop").hidden = true;
  $("talk-orb").hidden = true;
  if (t.sessionId) {
    try {
      await postJson("/api/talk/end", { session_id: t.sessionId, seconds, transcript });
    } catch {}
    if (params().has("talk")) loadTalkHistory();
  }
}

function cleanupTalk(t = talkState) {
  if (!t) return;
  clearInterval(t.timer);
  try { t.pc?.close(); } catch {}
  try { t.ws?.close(); } catch {}
  try { t.capture?.disconnect(); } catch {}
  try { t.ctx?.close(); } catch {}
  t.stream?.getTracks().forEach((track) => track.stop());
  if (t.audio) t.audio.srcObject = null;
}

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

// ================================================================ costs (premium only)

const modelLabel = (id) => (options.models.find((m) => m.id === id)?.label || id || "").replace(/ \(.*\)$/, "");
const tierOfVoice = (voice) => Object.entries(options.tiers).find(([, t]) => voice in t.voices)?.[0] || "free";

// A rough estimate for a new seven-day retreat. Output tokens include the model's
// thinking, so they're counted at about two and a half times the script.
function estimateRetreat(days = 7) {
  const model = options.models.find((m) => m.id === $("write-model").value);
  const planModel = options.models.find((m) => m.id === $("plan-model").value);
  if (!model || model.free) return null;
  const voices = chosenVoices();
  const cap = (s) => options.tiers[tierOfVoice(voices[s])].max_chars;
  const words = (s) => (cap(s) / 6) * 0.85;
  const perIn = model.input_per_m / 1e6;
  const perOut = model.output_per_m / 1e6;
  const searches = options.web_search ? 5 : 0;
  let llm = 3500 * perIn + words("heart") * 1.35 * 2.5 * perOut;
  llm += (5000 + searches * 8000) * perIn + (words("deep") * 1.35 * 2.5 + 400) * perOut + searches * model.web_search_each;
  llm += 7000 * perIn + 3000 * perOut;
  const plan = planModel && !planModel.free ? 9000 * (planModel.input_per_m / 1e6) + 12000 * (planModel.output_per_m / 1e6) : 0;
  const chars = { free: 0, premium: 0 };
  chars[tierOfVoice(voices.reading)] += 1200;
  chars[tierOfVoice(voices.heart)] += cap("heart") * 0.9;
  chars[tierOfVoice(voices.deep)] += cap("deep") * 0.9;
  chars[tierOfVoice(voices.guide)] += 1400;
  const voice = (chars.premium / 1000) * (options.elevenlabs?.usd_per_1k_chars || 0);
  return { total: plan + days * (llm + voice), voice: days * voice, model };
}

function updateEstimate() {
  const note = $("new-estimate");
  if (!options || isFree()) return (note.hidden = true);
  const e = estimateRetreat();
  note.hidden = !e;
  if (e) note.textContent = `About ${money(e.total)} for a seven-day retreat with ${modelLabel(e.model.id)}${e.voice ? " and ElevenLabs voices" : ""}.`;
}

function renderCosts() {
  const premium = !isFree();
  const plan = retreat.costs?.plan;
  let total = plan?.usd || 0;
  const lines = [];
  if (plan) lines.push(`Planning: ${money(plan.usd)} with ${modelLabel(plan.model)}.`);
  for (const d of retreat.plan?.days || []) {
    const c = retreat.days[String(d.day)]?.cost;
    if (!c) continue;
    total += c.total_usd;
    const w = c.llm;
    lines.push(`Day ${d.day}: ${money(c.total_usd)} (writing ${money(w.usd)}, ${Math.round(w.input_tokens / 1000)}k tokens in, ${Math.round(w.output_tokens / 1000)}k out${w.web_searches ? `, ${w.web_searches} searches` : ""}; ${c.voice_characters.premium ? `ElevenLabs ${c.voice_characters.premium.toLocaleString()} characters, ${money(c.voice_usd)}` : "free voices"}).`);
  }
  // Costs belong to making a retreat: open while it's being made, and afterwards a
  // collapsed "What it cost to make" at the foot of the page. Never while praying;
  // phones hide them entirely (CSS .cost-info).
  const making = busy();
  $("costs").hidden = !premium || !lines.length || retreat.read_only;
  $("costs-summary").textContent = making ? "Costs so far" : `What it cost to make: ${money(total)}`;
  $("costs-body").innerHTML = "";
  lines.forEach((t) => $("costs-body").append(el("p", { text: t })));
  if (!making) $("costs-body").append(el("p", { class: "hint", text: "Voices are estimated at ElevenLabs' list price per character; your plan's real cost may be lower. Every model call is also logged in the llm_calls table." }));
  $("retreat-cost").hidden = !premium || !total || !making;
  $("retreat-cost").textContent = total ? `Spent so far on this retreat: ${money(total)}.` : "";
}

// ================================================================ start-up

async function checkServer() {
  const status = $("server-status");
  try {
    await api("/api/health");
    options = await api("/api/options");
    status.hidden = true;
    return true;
  } catch (err) {
    status.hidden = false;
    status.textContent = `${err.message} `;
    status.append(el("button", { type: "button", class: "link", text: "Retry", onclick: start }));
    return false;
  }
}

function wireForms() {
  $("signin-form").addEventListener("submit", sendSignInLink);
  $("upgrade-form").addEventListener("submit", upgradeGuest);
  $("guest-button").onclick = async () => {
    $("guest-button").disabled = true;
    const { error } = await sb.auth.signInAnonymously();
    $("guest-button").disabled = false;
    if (error) showMessage(`Couldn't start a guest session: ${error.message}`);
  };
  $("signout").onclick = async () => {
    if (sb) await sb.auth.signOut();
    showSignedOut();
  };
  $("new-form").addEventListener("submit", makeRetreat);
  $("tab-simple").onclick = () => setTab("simple");
  $("tab-advanced").onclick = () => setTab("advanced");
  $("file").onchange = () => chooseFile($("file").files[0]);
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer.files[0]) {
      $("file").files = e.dataTransfer.files;
      chooseFile(e.dataTransfer.files[0]);
    }
  });
  $("series-toggle").onchange = () => ($("series-box").hidden = !$("series-toggle").checked);
  $("series-all").onclick = () => document.querySelectorAll("#series-list input").forEach((b) => (b.checked = true));
  $("retreat-pdf").onclick = () => downloadScript(null, $("retreat-pdf"));
  $("playback-button").onclick = openPlaybackSettings;
  $("talk-button").onclick = () => go(`?talk&r=${retreat.id}`);
  $("notify-button").onclick = async () => {
    const result = await Notification.requestPermission();
    store.set("notify", result === "granted");
    $("notify-button").hidden = true;
    if (result === "granted") toast("You'll get a notification when it's ready, while this page is open.");
  };
  $("me-form").addEventListener("submit", saveMe);
  $("me-file").onchange = uploadMe;
  $("talk-forget").onclick = async (e) => {
    const b = e.target;
    if (b.dataset.armed !== "yes") {
      b.dataset.armed = "yes";
      b.textContent = "Click again to forget everything";
      return;
    }
    await api("/api/talk/history", { method: "DELETE" });
    b.dataset.armed = "";
    b.textContent = "Forget all our conversations";
    loadTalkHistory();
    toast("The companion has forgotten your past conversations.");
  };
  wirePlayer();
}

async function start() {
  if (!(await checkServer())) return;
  if (options.auth) {
    sb = window.supabase.createClient(options.auth.url, options.auth.publishable_key);
    const { data } = await sb.auth.getSession(); // also reads a token from a sign-in link
    authReady = true;
    sb.auth.onAuthStateChange((event, newSession) => {
      if (event === "SIGNED_IN" && !session) signedInAs(newSession);
      if (event === "SIGNED_OUT") showSignedOut();
    });
    $("guest-box").hidden = !options.free_mode?.enabled;
    if (data.session) await signedInAs(data.session);
    else showSignedOut();
  } else {
    authReady = true;
    await signedInAs(null); // local development: no sign-in
  }
}

wireForms();
start();
