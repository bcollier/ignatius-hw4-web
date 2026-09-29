// ================================================================ Apple Health (through Shortcuts)
// A web app can't write to Apple Health; an Apple Shortcut can. The person makes a small
// Shortcut once (Settings → Apple Health explains how), and after each prayer or practice
// the app offers "Add 16 mindful minutes to Apple Health", which runs it with the minutes
// actually spent, from when the prayer began to when it finished. Kept per device.

const healthOn = () => store.get("health.on", false) === true;
const healthShortcut = () => store.get("health.shortcut") || "Log Prayer";
const isStandaloneApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function shortcutsUrl(minutes) {
  const name = encodeURIComponent(healthShortcut());
  // In Safari the Shortcuts app can come straight back here; from the Home Screen app,
  // coming back would open Safari instead, so there the person switches back themselves.
  return isStandaloneApp()
    ? `shortcuts://run-shortcut?name=${name}&input=text&text=${minutes}`
    : `shortcuts://x-callback-url/run-shortcut?name=${name}&input=text&text=${minutes}&x-success=${encodeURIComponent(location.href)}`;
}

function mindfulMinutes(beganAt, finishedAt = Date.now()) {
  const ms = finishedAt - new Date(beganAt || finishedAt).getTime();
  return Math.max(1, Math.min(180, Math.round(ms / 60000)));
}

// The button shown after a prayer or practice ("" when Apple Health is off here).
function healthButton(beganAt) {
  if (!healthOn() || !beganAt) return "";
  const minutes = mindfulMinutes(beganAt);
  const link = el("a", { class: "button secondary health-button", href: shortcutsUrl(minutes) },
    el("span", { class: "health-heart", "aria-hidden": "true", text: "♥" }),
    ` Add ${minutes} mindful minute${minutes === 1 ? "" : "s"} to Apple Health`);
  link.addEventListener("click", () => {
    setTimeout(() => { link.replaceChildren(`Sent ${minutes} minute${minutes === 1 ? "" : "s"} to Apple Health`); link.classList.add("sent"); }, 400);
  });
  return link;
}

function showHealthSettings() {
  const on = $("me-health-on"), name = $("me-health-name");
  if (!on) return;
  on.checked = healthOn();
  name.value = healthShortcut();
  $("me-health-steps").hidden = !on.checked;
  on.onchange = () => {
    store.set("health.on", on.checked || null);
    $("me-health-steps").hidden = !on.checked;
    toast(on.checked ? "After each prayer you'll be offered Add to Apple Health." : "Apple Health is off on this device.");
  };
  $("me-health-name-echo").textContent = healthShortcut();
  name.onchange = () => {
    store.set("health.shortcut", name.value.trim() && name.value.trim() !== "Log Prayer" ? name.value.trim() : null);
    $("me-health-name-echo").textContent = healthShortcut();
  };
  $("me-health-test").onclick = () => { location.href = shortcutsUrl(1); };
}
