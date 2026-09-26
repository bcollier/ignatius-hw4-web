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
  const forget = $("talk-forget");
  confirmTwice(forget, "Click again to forget everything", async () => {
    await api("/api/talk/history", { method: "DELETE" });
    forget.dataset.armed = "";
    forget.textContent = "Forget all our conversations";
    loadTalkHistory();
    toast("The companion has forgotten your past conversations.");
  });
}

async function start() {
  readDebugFlag();
  document.documentElement.classList.toggle("debug", debugMode());
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
