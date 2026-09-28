// ================================================================ about me ("user info.md")

async function openMe() {
  show("me");
  document.title = "Settings · Ignatius at Home";
  $("me-status").textContent = "";
  showAccount();
  const speed = $("me-speed");
  speed.replaceChildren(...VOICE_SPEEDS.map(([v, label]) => new Option(label, v)));
  speed.value = String(voiceSpeed());
  speed.onchange = () => {
    store.set("play.speed", speed.value === "1" ? null : speed.value);
    [$("player"), typeof practiceAudio !== "undefined" ? practiceAudio : null].forEach((a) => a && atVoiceSpeed(a));
    toast(`Voice speed: ${speed.selectedOptions[0].textContent.toLowerCase()}.`);
  };
  $("me-debug").checked = debugMode();
  $("me-evals-link").hidden = !debugMode();
  showWaitingPreviews();
  $("me-debug").onchange = (e) => {
    store.set("debug", e.target.checked || null);
    document.documentElement.classList.toggle("debug", debugMode());
    $("costs-link").hidden = !debugMode();
    $("evals-link").hidden = !debugMode();
    $("me-evals-link").hidden = !debugMode();
    showWaitingPreviews();
    $("debug-badge").hidden = !debugMode();
  };
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

// A Google Doc by its link (on a phone, Google Docs can't be picked as files).
async function aboutMeFromGoogleDoc() {
  if (!$("me-gdoc").value.trim()) return showMessage("Paste the Google Doc's link first.");
  $("me-status").textContent = "Reading your Google Doc…";
  try {
    const p = await postJson("/api/profile/google-doc", { link: $("me-gdoc").value.trim() });
    if ($("me-notes").value.trim() !== (p.companion_notes || "").trim()) {
      await postJson("/api/profile", { companion_notes: $("me-notes").value }, "PUT");
      p.companion_notes = $("me-notes").value;
    }
    renderMe(p);
    $("me-gdoc").value = "";
    $("me-status").textContent = p.summarized ? "Saved as a summary of your Google Doc." : "Saved from your Google Doc.";
  } catch (err) {
    $("me-status").textContent = "";
    showMessage(err.message);
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


// Who is signed in, and signing out (on a phone the header has no room for it).
function showAccount() {
  const box = $("me-account");
  const who = $("account-email").textContent.trim();
  box.hidden = $("account").hidden || !who;
  $("me-account-box").hidden = box.hidden;
  box.innerHTML = "";
  if (box.hidden) return;
  box.append(el("span", { text: `Signed in as ${who}` }),
    el("button", { type: "button", class: "link", text: "Sign out", onclick: () => $("signout").click() }));
  if (!me?.anonymous) box.append(el("button", { type: "button", class: "link", text: "Sign in on your phone (QR code)",
    onclick: async () => { await offerHandoff(true); go("?"); } }));
}


// Debug mode: the five waiting animations, playing side by side, to choose from.
function showWaitingPreviews() {
  $("me-waiting-box").hidden = !debugMode();
  if (debugMode()) waitingPreviews($("me-waiting"));
  else $("me-waiting").replaceChildren();
}
