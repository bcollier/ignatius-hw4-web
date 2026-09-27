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

// Buttons and forms that exist from the start, grouped by view. (Views that draw
// their own buttons wire them as they draw.)
function wireForms() {
  wireSignIn();
  wireNewRetreat();
  wireRetreatPage();
  wireAboutMeAndTalk();
  wireCompanionPrompt();
  wirePlayer();
}

function wireSignIn() {
  $("signin-form").addEventListener("submit", sendSignInLink);
  $("paste-link-form").addEventListener("submit", signInWithPastedLink);
  $("have-link").onclick = showPasteStep;
  $("upgrade-signin-button").onclick = () => guestToSignIn($("upgrade-email").value.trim());
  $("guest-signin").onclick = () => guestToSignIn("");
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
}

function wireNewRetreat() {
  $("new-form").addEventListener("submit", makeRetreat);
  $("tab-simple").onclick = () => setTab("simple");
  $("tab-advanced").onclick = () => setTab("advanced");
  $("file").onchange = () => chooseFile($("file").files[0]);
  wireDropZone($("drop"));
  $("paste-text").addEventListener("input", () => {
    if ($("paste-text").value.trim()) {
      chosenExample = null;
      $("file").value = "";
      chooseFile(null);
      $("drop-title").textContent = "Using the pasted text";
    }
  });
  $("series-toggle").onchange = () => ($("series-box").hidden = !$("series-toggle").checked);
  $("series-all").onclick = () => document.querySelectorAll("#series-list input").forEach((b) => (b.checked = true));
}

// A file dragged onto the upload box counts as choosing it.
function wireDropZone(drop) {
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
}

function wireRetreatPage() {
  $("retreat-pdf").onclick = () => downloadScript(null, $("retreat-pdf"));
  $("playback-button").onclick = openPlaybackSettings;
  $("talk-button").onclick = () => go(`?talk&r=${retreat.id}`);
  $("notify-button").onclick = async () => {
    const result = await Notification.requestPermission();
    store.set("notify", result === "granted");
    $("notify-button").hidden = true;
    if (result === "granted") toast("You'll get a notification when it's ready, while this page is open.");
  };
  $("log-toggle").onclick = () => (logState ? closeLog() : retreat && openLog(retreat.id));
  $("log-link").onclick = () => retreat && openLog(retreat.id);
  $("log-close").onclick = () => closeLog();
  $("log-download").onclick = downloadLog;
}

function wireAboutMeAndTalk() {
  $("me-form").addEventListener("submit", saveMe);
  $("me-file").onchange = uploadMe;
  $("me-gdoc-form").addEventListener("submit", aboutMeFromGoogleDoc);
  const forget = $("talk-forget");
  confirmTwice(forget, "Click again to forget everything", async () => {
    await api("/api/talk/history", { method: "DELETE" });
    forget.dataset.armed = "";
    forget.textContent = "Forget all our conversations";
    loadTalkHistory();
    toast("The companion has forgotten your past conversations.");
  });
}

let wakingTimer = null;
let wakingClock = null;
const WAKING_PHRASES = [
  "The candles are being lit…",
  "The sacristan is finding the keys…",
  "The server is finishing its morning prayer…",
  "Ringing the bell for the server to come in from the garden…",
  "Brother Server is putting on his sandals…",
  "Warming up the chapel…",
  "The monks are shuffling in for vespers…",
  "Dusting off the hymnals…",
  "Trimming the lamp wicks…",
  "Our server was resting in the Lord. It's getting up now…",
];

function showWaking() {
  $("waking-phrase").textContent = WAKING_PHRASES[Math.floor(Math.random() * WAKING_PHRASES.length)];
  $("waking").hidden = false;
  const began = Date.now();
  const tick = () => {
    const seconds = Math.round((Date.now() - began) / 1000) + 1;
    $("waking-time").textContent = `Waiting ${seconds} second${seconds === 1 ? "" : "s"}`;
    // four seconds in, six seconds out, as the circle grows and shrinks
    $("breath-cue").textContent = ((Date.now() - began) % 10000) < 4000 ? "Breathe in" : "Breathe out";
  };
  tick();
  wakingClock = setInterval(tick, 250);
}

function hideWaking() {
  clearTimeout(wakingTimer);
  clearInterval(wakingClock);
  $("waking").hidden = true;
}

async function start() {
  if (typeof wirePractice === "function") wirePractice();
  drawIcons();
  setPlayIcon(false);
  readDebugFlag();
  document.documentElement.classList.toggle("debug", debugMode());
  // The server sleeps after a quiet spell and can take up to a minute to wake. Say so
  // rather than leave the page blank, and start from the last known options if there
  // are any (the sign-in settings rarely change), checking the server alongside.
  clearTimeout(wakingTimer);
  wakingTimer = setTimeout(showWaking, 1200);
  const cached = store.get("options.cache");
  if (cached) {
    options = cached;
    checkServer().then((ok) => ok && store.set("options.cache", options));
  } else if (await checkServer()) {
    store.set("options.cache", options);
  } else {
    return hideWaking();
  }
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


// ---------------------------------------------------------------- staying up to date
// Browsers may keep the page for a while (GitHub Pages allows ten minutes; phones
// sometimes longer). When the page comes back into view, check whether a newer
// version has been published, and if so reload, unless a prayer or a conversation
// is under way.
const RUNNING_VERSION = new URL(document.querySelector('script[src*="js/core.js"]').src).searchParams.get("v");

async function reloadIfUpdated() {
  if (document.body.classList.contains("praying") || (typeof talkState !== "undefined" && talkState)) return;
  if (typeof practiceRun !== "undefined" && practiceRun) return; // in the middle of a guided exercise
  try {
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: "no-store" })).text();
    const latest = html.match(/js\/core\.js\?v=(\d+)/)?.[1];
    if (latest && RUNNING_VERSION && latest !== RUNNING_VERSION) location.reload();
  } catch {}
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reloadIfUpdated());
reloadIfUpdated();
