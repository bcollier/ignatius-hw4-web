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
  const listenHow = $("me-listen"), pause = $("me-pause");
  listenHow.value = store.get("talk.handsFree", true) === false ? "tap" : "hands";
  pause.value = store.get("talk.endPause") || "normal";
  $("me-pause-label").hidden = listenHow.value === "tap";
  listenHow.onchange = () => {
    store.set("talk.handsFree", listenHow.value === "tap" ? false : null);
    $("me-pause-label").hidden = listenHow.value === "tap";
    toast(listenHow.value === "tap" ? "Tap to talk." : "Hands-free: it listens and answers when you pause.");
  };
  pause.onchange = () => {
    store.set("talk.endPause", pause.value === "normal" ? null : pause.value);
    toast(`Pause before it answers: ${pause.value}.`);
  };
  showBootTimes();
  showMyHighlights();
  showCalendarFeed();
  $("me-debug").checked = debugMode();
  $("me-evals-link").hidden = !debugMode();
  showWaitingPreviews();
  $("me-debug").onchange = (e) => {
    store.set("debug", e.target.checked || null);
    showBootTimes();
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


// ---------------------------------------------------------------- server start-up (debug)
// Each day's cold starts (the dot is the median, the line runs to the longest), warm
// opens (small ring) and the daily check (diamond), in seconds, over the last 30 days.

const bootS = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

async function showBootTimes() {
  const box = $("me-boot");
  box.hidden = !debugMode();
  if (box.hidden) return;
  const chart = $("me-boot-chart");
  chart.replaceChildren(el("p", { class: "hint", text: "Loading the start-up times…" }));
  let data;
  try {
    data = await api("/api/boot-timing?days=30");
  } catch (err) {
    chart.replaceChildren(el("p", { class: "hint", text: `Couldn't load the start-up times: ${err.message}` }));
    return;
  }
  const secs = (ms) => (ms == null ? null : ms / 1000);
  $("me-boot-lede").textContent = data.typical_cold_ms == null
    ? "No cold starts recorded yet. Each visit records its wait from now on."
    : `A typical cold start makes people wait ${Math.round(secs(data.typical_cold_ms))} seconds (median of ${data.cold_n} in the last 30 days; 9 in 10 are under ${Math.round(secs(data.cold_p90_ms))} s). When the server is already awake, the wait is well under a second.`;
  chart.replaceChildren(bootChart(data));
}

function bootChart(data) {
  const W = 760, H = 320, L = 56, R = 90, T = 24, B = 64;
  const today = new Date();
  const days = Array.from({ length: 30 }, (_, i) => new Date(today.getTime() - (29 - i) * 864e5).toISOString().slice(0, 10));
  const byDay = Object.fromEntries(data.days.map((d) => [d.day, d]));
  const top = Math.max(60, ...data.days.map((d) => Math.max(d.cold_max_ms || 0, d.probe_ms || 0) / 1000));
  const yMax = Math.ceil(top / 15) * 15;
  const x = (i) => L + (i + 0.5) * ((W - L - R) / days.length);
  const y = (s) => T + (1 - s / yMax) * (H - T - B);
  const svg = bootS("svg", { viewBox: `0 0 ${W} ${H}`, class: "boot-svg", role: "img", "aria-label": "Seconds waiting for the server each day" });
  for (let s = 0; s <= yMax; s += 15) {
    svg.append(bootS("line", { x1: L, x2: W - R, y1: y(s), y2: y(s), class: "boot-grid" }),
      bootS("text", { x: L - 8, y: y(s) + 4, class: "boot-tick", "text-anchor": "end" }, String(s)));
  }
  svg.append(bootS("text", { x: 14, y: (T + H - B) / 2, class: "boot-axis", "text-anchor": "middle", transform: `rotate(-90 14 ${(T + H - B) / 2})` }, "seconds waiting"));
  days.forEach((d, i) => {
    if ((days.length - 1 - i) % 7 === 0) {  // weekly, counting back from today
      const [, m, dd] = d.split("-");
      svg.append(bootS("text", { x: x(i), y: H - B + 18, class: "boot-tick", "text-anchor": "middle" }, `${Number(m)}/${Number(dd)}`));
    }
    const r = byDay[d];
    if (!r) return;
    const tip = [`${d}: ${r.n} visit${r.n === 1 ? "" : "s"}`, r.cold_n ? `${r.cold_n} cold start${r.cold_n === 1 ? "" : "s"}, median ${(r.cold_median_ms / 1000).toFixed(1)} s, longest ${(r.cold_max_ms / 1000).toFixed(1)} s` : "no cold starts",
      r.warm_median_ms != null ? `awake: median ${(r.warm_median_ms / 1000).toFixed(2)} s` : "", r.probe_ms != null ? `daily check: ${(r.probe_ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join("\n");
    const g = bootS("g", {}, bootS("title", {}, tip));
    if (r.cold_n) {
      g.append(bootS("line", { x1: x(i), x2: x(i), y1: y(r.cold_median_ms / 1000), y2: y(r.cold_max_ms / 1000), class: "boot-whisker" }),
        bootS("circle", { cx: x(i), cy: y(r.cold_median_ms / 1000), r: 5, class: "boot-cold" }));
    }
    if (r.warm_median_ms != null) g.append(bootS("circle", { cx: x(i), cy: y(r.warm_median_ms / 1000), r: 3.5, class: "boot-warm" }));
    if (r.probe_ms != null) {
      const px = x(i), py = y(r.probe_ms / 1000);
      g.append(bootS("path", { d: `M${px} ${py - 6}l6 6l-6 6l-6 -6z`, class: "boot-probe" }));
    }
    svg.append(g);
  });
  if (data.typical_cold_ms != null) {
    const ty = y(data.typical_cold_ms / 1000);
    svg.append(bootS("line", { x1: L, x2: W - R, y1: ty, y2: ty, class: "boot-typical" }),
      bootS("text", { x: W - R + 8, y: ty + 4, class: "boot-note strong" }, `typical: ${Math.round(data.typical_cold_ms / 1000)} s`));
  }
  const key = [["boot-cold", "cold start: dot = median, line up to the longest"], ["boot-warm", "already awake"], ["boot-probe", "daily check"]];
  const keyX = [L + 6, L + 330, L + 470];
  key.forEach(([cls, label], k) => {
    const ky = H - 14, kx = keyX.at(k);
    svg.append(cls === "boot-probe" ? bootS("path", { d: `M${kx} ${ky - 6}l6 6l-6 6l-6 -6z`, class: cls }) : bootS("circle", { cx: kx, cy: ky, r: cls === "boot-cold" ? 5 : 3.5, class: cls }),
      bootS("text", { x: kx + 12, y: ky + 4, class: "boot-note" }, label));
  });
  return svg;
}


// ---------------------------------------------------------------- prayed days on your calendar
async function showCalendarFeed() {
  const box = $("me-calendar");
  box.hidden = typeof hlSignedIn === "function" ? !hlSignedIn() : !session;
  if (box.hidden) return;
  const show = (feed) => {
    $("me-cal-off").hidden = feed.on;
    $("me-cal-ready").hidden = !feed.on;
    if (!feed.on) return;
    $("me-cal-google").href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.webcal)}`;
    $("me-cal-apple").href = feed.webcal;
    $("me-cal-url").value = feed.https;
    $("me-cal-url").onfocus = (e) => e.target.select();
    $("me-cal-copy").onclick = () => navigator.clipboard?.writeText(feed.https).then(() => toast("Copied. Now open Google Calendar's add-from-URL page and paste it."), () => { $("me-cal-url").select(); toast("Select the address above and copy it."); });
  };
  try {
    show(await api("/api/calendar/feed"));
  } catch {
    box.hidden = true;
    return;
  }
  $("me-cal-on").onclick = async () => {
    try {
      show(await postJson("/api/calendar/feed", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }));
      toast("Your calendar is ready: add it below.");
    } catch (err) {
      toast(err.message);
    }
  };
  $("me-cal-off-btn").onclick = async () => {
    try {
      await api("/api/calendar/feed", { method: "DELETE" });
      show({ on: false });
      toast("The calendar is off; the old address no longer works.");
    } catch (err) {
      toast(err.message);
    }
  };
}
