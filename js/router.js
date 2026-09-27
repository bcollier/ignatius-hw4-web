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

const VIEWS = ["signin", "library", "new", "retreat", "research", "talk", "me", "about", "costs", "practice"];
function show(view) {
  window.__appStarted = true; // for the start-up guard in index.html
  if (typeof hideWaking === "function") hideWaking();
  const swap = () => {
    for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
    window.scrollTo(0, 0);
  };
  // A soft cross-fade between views where the browser supports it. Not on iPhones and
  // iPads: there WebKit can leave the page unable to scroll after a view transition
  // (seen in the Home Screen app, the page stuck partway down until reopened).
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const current = VIEWS.find((v) => !$(`view-${v}`).hidden);
  if (document.startViewTransition && !calm && !appleTouch && current && current !== view) document.startViewTransition(swap);
  else swap();
}

async function route() {
  showMessage("");
  clearTimeout(pollTimer);
  const p = params();
  if (!p.has("pray")) closePrayer(false);
  if (!p.has("talk") && talkState) endTalk("You left the conversation.");
  $("site-foot").hidden = !signedIn() || !debugMode();
  $("practice-link").hidden = !signedIn();
  if (p.has("about")) return show("about");
  if (!signedIn()) return show("signin");
  if (p.has("new")) return openNew();
  if (p.has("me")) return openMe();
  if (p.has("costs")) return openCosts();
  if (!p.has("practice") && typeof stopPractice === "function") {
    stopPractice();
    stopMusic();
  }
  if (p.has("practice")) return openPractice(p.get("practice"));
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
  await sendLinkTo($("email").value.trim());
}

// Step one: email the link. Step two: the box to paste it into, shown straight away,
// since on an iPhone the link opens in Safari rather than in a Home Screen app.
async function sendLinkTo(email) {
  $("email").value = email;
  store.set("signin.email", email); // the email's code is checked with the address it went to
  $("signin-button").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $("signin-button").disabled = false;
  $("signin-note").hidden = false;
  const limited = error && /rate limit|too many/i.test(error.message);
  $("signin-note").textContent = limited
    ? "Too many sign-in emails have gone out in the last hour, so no more can be sent just now. Try again in a little while, or try it without an account below."
    : error ? `Couldn't send the link: ${error.message}` : `A sign-in link is on its way to ${email}.`;
  if (!error) showPasteStep();
}

// Step two: the code from the email, on any device (a Home Screen app never
// receives the email's link; elsewhere clicking the link works too). Pasting the link
// stays as a last resort, folded away.
function showPasteStep() {
  $("paste-step").hidden = false;
  $("have-link").hidden = true;
  $("code-step").hidden = false;
  $("link-step-note").hidden = true;
  $("signin-code").focus({ preventScroll: true });
}

const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const inHomeScreenApp = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// A code from a device that's signed in (see /api/handoff): exchanged for a one-time
// sign-in token, which Supabase then turns into a session here.
// Two kinds of code: the one in the sign-in email (six to ten digits, as the Supabase
// project is set up; checked by Supabase with the email address it went to), or the
// eight digits a signed-in browser shows (see /api/handoff). Both can be eight digits,
// so a code is tried as the email's first and as a browser code if that fails.
async function signInWithCode(event) {
  event.preventDefault();
  const note = $("code-note");
  const code = $("signin-code").value.replace(/\D/g, "");
  const email = $("email").value.trim() || store.get("signin.email", "");
  if (code.length < 6) return (note.textContent = "Type the whole code from the email.");
  note.textContent = "Signing in…";
  let failed = null;
  if (email) {
    const { error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
    if (!error) return (note.textContent = "Signed in.");
    failed = error.message;
  }
  if (code.length === 8) {
    try {
      const { token_hash, type } = await postJson("/api/handoff/redeem", { code });
      const { error } = await sb.auth.verifyOtp({ token_hash, type });
      if (!error) return (note.textContent = "Signed in.");
      failed = error.message;
    } catch (err) {
      failed = failed || err.message;
    }
  }
  note.textContent = !email
    ? "Type your email address above first, the one the code was sent to."
    : `That code didn't work (${failed}). Each code works once and expires within an hour; send a new email and use the newest code.`;
}

// The QR code is a link to this app with the code in it (?code=…); scanning it on a
// phone opens the app there and signs in (signInFromLinkCode).
function drawSignInQr(code) {
  const box = $("handoff-qr");
  box.innerHTML = "";
  if (typeof qrcode !== "function") return (box.hidden = true);
  const qr = qrcode(0, "M");
  qr.addData(`${location.origin}${location.pathname}?code=${code}`);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  box.hidden = false;
}

// Opened from a sign-in QR code: use the code in the address, then take it out.
async function signInFromLinkCode() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code || !/^\d{8}$/.test(code)) return false;
  const url = new URL(location.href);
  url.searchParams.delete("code");
  history.replaceState(null, "", url);
  try {
    const { token_hash, type } = await postJson("/api/handoff/redeem", { code });
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    if (error) throw error;
    return true;
  } catch (err) {
    showMessage(`That sign-in code didn't work: ${err.message}. Get a new one on the device where you're signed in.`);
    return false;
  }
}

// In the browser on an iPhone, straight from the email's link: offer the code for the Home
// Screen app. (Anyone signed in can also get one from About me.)
async function offerHandoff(always = false) {
  if (!always && (!cameFromSignInLink || !isIPhone() || inHomeScreenApp())) return;
  if (!session || me?.anonymous) return;
  try {
    const { code } = await postJson("/api/handoff", {});
    $("handoff-code").textContent = `${code.slice(0, 4)} ${code.slice(4)}`;
    drawSignInQr(code);
    $("handoff-box").hidden = false;
  } catch (err) {
    showMessage(err.message);
  }
}

// Sign-in links open in Safari, but an app added to the Home Screen keeps its own
// storage, so there the person pastes the link instead: the link's token is checked here.
async function signInWithPastedLink(event) {
  event.preventDefault();
  const note = $("paste-link-note");
  const text = $("paste-link").value.trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    note.textContent = "That doesn't look like a link. In the email, press and hold the sign-in link, choose Copy Link, and paste it here.";
    return;
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const token = url.searchParams.get("token_hash") || url.searchParams.get("token");
  let error;
  if (hash.get("access_token")) {
    ({ error } = await sb.auth.setSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") }));
  } else if (token) {
    ({ error } = await sb.auth.verifyOtp({ token_hash: token, type: url.searchParams.get("type") || "magiclink" }));
  } else {
    error = { message: "that link has no sign-in code in it" };
  }
  note.textContent = error
    ? `Couldn't sign in: ${error.message}. A link works once and expires after an hour; if it's been used or is old, send a new one.`
    : "Signed in.";
}

async function signedInAs(newSession) {
  session = newSession;
  try {
    me = await api("/api/me");
  } catch (err) {
    return showMessage(err.message);
  }
  fillSettings();
  if (session && !me.anonymous) applyMyDefaults(); // the defaults saved to the account, on this device too
  $("account").hidden = !session;
  $("me-link").hidden = false;
  $("account-email").textContent = !session ? "" : me.anonymous ? "Guest" : `${session.user.email}${me.mode === "full" ? " · premium" : ""}`;
  route();
  offerHandoff(); // on an iPhone, straight from the email: the code for the Home Screen app
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
