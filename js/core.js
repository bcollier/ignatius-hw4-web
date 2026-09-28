// Ignatius at Home: the web app. One page; the URL chooses the view:
//   ./              library (or sign-in)        ./?new           new retreat (Simple / Advanced)
//   ./?r=ID         a retreat                   ./?r=ID&pray=N   praying day N (full screen)
//   ./?talk&r=ID    talk it over (live voice)   ./?me            about me ("user info.md")
//   ./?r=ID&research  research notes            ./?costs         costs (tucked away)
//   ./?about        about the tradition
//
// The code is split by view into plain scripts (no build step) that share one global
// scope, loaded in this order by index.html:
//   core.js      constants, helpers, the API client, shared state
//   look.js      icons, colors taken from the paintings, words for days and hours
//   settings.js  the Advanced tab: models, voices, research, prompts, the estimate
//   router.js    the URL decides the view; sign-in
//   library.js · new-retreat.js · retreat.js · build-log.js · research.js
//   pray.js      the full-screen prayer player
//   about-me.js · talk.js · costs.js
//   start.js     wiring the forms and starting up (last)

const API = window.API_BASE;
const POLL_MS = 3000;
const TRACK_LABELS = { reading: "The reading", heart: "For the heart", deep: "Deep dive" };
const STATUS_WORDS = { waiting: "waiting", writing: "writing", speaking: "recording", ready: "done", failed: "failed" };
const SECTIONS = ["guide", "reading", "heart", "deep"];
const DEFAULT_VOICES = {
  guide: "en-US-AvaMultilingualNeural",
  reading: "en-US-AndrewMultilingualNeural",
  heart: "en-US-EmmaMultilingualNeural", // a different voice (and a woman's) from the reading
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

// Buttons that can't be undone ask twice: the first click changes the label, the second acts.
function confirmTwice(button, confirmText, action) {
  button.onclick = async (event) => {
    if (button.dataset.armed !== "yes") {
      button.dataset.armed = "yes";
      button.textContent = confirmText;
      return;
    }
    await action(event);
  };
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
// The scripture reference alone ("John 4:7–15"), for the screen: planners sometimes add
// the handout's unit or day names, or a translation, which the listener doesn't need.
const BIBLE_BOOKS = "Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Tobit|Judith|Esther|Maccabees|Job|Psalms?|Proverbs|Ecclesiastes|Qoheleth|Song of (?:Songs|Solomon)|Wisdom|Sirach|Ecclesiasticus|Isaiah|Jeremiah|Lamentations|Baruch|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation";
const SCRIPTURE_REF = new RegExp(`\\b(?:(?:[1-3]|I{1,3})\\s?)?(?:${BIBLE_BOOKS})\\s+\\d+(?::\\d+(?:\\s*[-–]\\s*\\d+(?::\\d+)?)?(?:,\\s*\\d+(?:[-–]\\d+)?)*)?`);
function scriptureRef(sourceRef) {
  if (!sourceRef) return "";
  const m = sourceRef.match(SCRIPTURE_REF);
  return (m ? m[0] : sourceRef).replace(/\s*-\s*/g, "–").trim();
}

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
// Debug mode shows the technical extras (build log, costs). Turn it on or off by opening
// the site with ?debug=true or ?debug=false; the choice is remembered in this browser.
const debugMode = () => !!store.get("debug");

// How fast the recorded voices speak (Settings → Voice speed), for every reading,
// reflection, practice and turn-taking reply. The pitch stays the same. Silences and
// bells (sounds/) keep their exact length, and live voices stream at their own pace.
const VOICE_SPEEDS = [["0.8", "Slower"], ["0.9", "A little slower"], ["1", "Normal"], ["1.1", "A little faster"]];
const voiceSpeed = () => {
  const saved = String(store.get("play.speed", "1"));
  return VOICE_SPEEDS.some(([v]) => v === saved) ? Number(saved) : 1;
};

function atVoiceSpeed(audio, src = audio.currentSrc || audio.src || "") {
  const rate = /\/sounds\//.test(src) ? 1 : voiceSpeed();
  audio.preservesPitch = true;
  audio.defaultPlaybackRate = rate; // kept when the source changes
  audio.playbackRate = rate;
  return audio;
}
function readDebugFlag() {
  const flag = new URLSearchParams(location.search).get("debug");
  if (flag == null) return;
  store.set("debug", /^(1|true|yes|on)$/i.test(flag) ? true : null);
  const url = new URL(location.href);
  url.searchParams.delete("debug");
  history.replaceState(null, "", url);
  document.documentElement.classList.toggle("debug", debugMode());
}

const fileUrl = (url) => (url && /^https?:\/\//.test(url) ? url : url ? API + url : "");

// ================================================================ state

let options = null; // GET /api/options
let me = null; // GET /api/me
let library = []; // GET /api/retreats
let examples = []; // ready-made example retreats, read only
let hiddenExamples = []; // examples this person took off their home page
let retreat = null; // the open retreat
let pollTimer = null;
let selectedDay = null;

const isFree = () => me?.mode === "free";
