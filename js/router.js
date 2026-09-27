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
  // A soft cross-fade between views where the browser supports it.
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const current = VIEWS.find((v) => !$(`view-${v}`).hidden);
  if (document.startViewTransition && !calm && current && current !== view) document.startViewTransition(swap);
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

// Step two: in a Home Screen app, the code from Safari (the link opens there); in a
// browser, just click the link. Pasting the link stays as a fallback either way.
function showPasteStep() {
  const homeScreen = inHomeScreenApp();
  $("paste-step").hidden = false;
  $("have-link").hidden = true;
  $("code-step").hidden = !homeScreen && !isIPhone();
  $("link-step-note").hidden = homeScreen || isIPhone();
  if (!$("code-step").hidden) $("signin-code").focus({ preventScroll: true });
}

const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const inHomeScreenApp = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// A code from a device that's signed in (see /api/handoff): exchanged for a one-time
// sign-in token, which Supabase then turns into a session here.
async function signInWithCode(event) {
  event.preventDefault();
  const note = $("code-note");
  note.textContent = "Signing in…";
  try {
    const { token_hash, type } = await postJson("/api/handoff/redeem", { code: $("signin-code").value });
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    note.textContent = error ? `Couldn't sign in: ${error.message}` : "Signed in.";
  } catch (err) {
    note.textContent = err.message;
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
