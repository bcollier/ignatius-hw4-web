// ================================================================ settings (the Advanced tab)
// Every option lives in the Advanced panel and is remembered in this browser, so
// Simple uses the same choices. The panel moves into the dialog when a day is rebuilt.

const PROMPT_FIELDS = { plan: "plan-prompt", heart: "heart-prompt", deep: "deep-prompt" };
const defaultPrompt = (key) => (key === "heart" ? options.prompts.heart.companion : options.prompts[key]);
const allowedModels = () => options.models.filter((m) => (isFree() ? m.free : true));
const allowedTiers = () => Object.entries(options.tiers).filter(([key]) => !isFree() || key === "free");

// Fill the Advanced tab from the server's options and this browser's saved choices.
// Every choice is saved as it's made, so it's there next time.
function fillSettings() {
  forgetOldDefaults();
  fillModelSelects();
  fillResearch();
  fillVoiceSelects();
  fillPlaybackFields();
  fillPromptFields();
  fillGuideFields();
  wireResetButtons();
  fillTalkSettings();
}

function modelOptionLabel(m) {
  // Rates show only in Advanced (the Simple tab never shows prices).
  return m.free ? `${m.label} · free` : `${m.label} · $${m.input_per_m} in / $${m.output_per_m} out per million tokens`;
}

function fillModelSelects() {
  const allowed = allowedModels();
  const savedModel = store.get("model");
  const fallback = allowed.some((m) => m.id === options.default_model) ? options.default_model : allowed[0]?.id;
  for (const select of document.querySelectorAll(".model-select")) {
    select.innerHTML = "";
    for (const m of allowed) select.add(new Option(modelOptionLabel(m), m.id));
    select.value = allowed.some((m) => m.id === savedModel) ? savedModel : fallback;
    select.onchange = () => {
      // One model plans and writes: the two menus move together.
      document.querySelectorAll(".model-select").forEach((other) => (other.value = select.value));
      store.set("model", select.value);
      fillResearch();
      updateEstimate();
    };
  }
}

function fillVoiceSelects() {
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
  const premium = allowedTiers().some(([key]) => key === "premium");
  $("voice-sets").hidden = !premium;
  $("use-free-voices").onclick = () => useVoiceSet(DEFAULT_VOICES);
  $("use-premium-voices").onclick = () => useVoiceSet(PREMIUM_DEFAULT_VOICES);
  updateEstimate();
  $("tier-note").textContent = allowedTiers().map(([, t]) => `${t.label}: up to ${t.max_chars.toLocaleString()} characters a section`).join(". ") + ".";
}

// The prayer's order, silences and on-screen view; they cost nothing to change, so
// they also apply to retreats already made.
const PLAYBACK_DEFAULTS = { sequence: "lectio", "grace-silence": "3", pause: "30", "pray-view": "both" };

function fillPlaybackFields() {
  for (const [id, fallback] of Object.entries(PLAYBACK_DEFAULTS)) {
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
}

// A prompt equal to the default isn't saved, so a later change to the default applies.
function fillPromptFields() {
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
}

function fillGuideFields() {
  const box = $("guide-fields");
  box.innerHTML = "";
  for (const [name, text] of Object.entries(options.prompts.guide)) {
    const area = el("textarea", { rows: 3, "data-guide": name });
    area.value = store.get(`guide.${name}`) ?? text;
    area.oninput = () => store.set(`guide.${name}`, area.value === text ? null : area.value);
    box.append(el("label", {}, options.prompts.guide_labels?.[name] || name, area));
  }
}

// Saved settings, by key prefix: what "Reset every option" clears.
const SETTING_KEYS = /^(model|voice\.|play\.|prompt\.|guide\.|tailor|searchProvider|talk\.)/;

function wireResetButtons() {
  $("reset-guide").onclick = () => {
    Object.keys(options.prompts.guide).forEach((n) => store.set(`guide.${n}`, null));
    fillSettings();
  };
  $("reset-all").onclick = () => {
    try {
      Object.keys(localStorage).filter((k) => SETTING_KEYS.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch {}
    fillSettings();
    toast("Every option is back to its default.");
  };
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


// Four different ElevenLabs voices, for premium accounts (one click in Advanced).
const PREMIUM_DEFAULT_VOICES = {
  guide: "EXAVITQu4vr4xnSDxMaL", // Sarah
  reading: "JBFqnCBsd6RMkjVDRZzb", // George
  heart: "nPczCjzI2devNBz1zQrb", // Brian
  deep: "Xb7hH8MSUJpSbSDYk0k2", // Alice
};

function useVoiceSet(set) {
  for (const section of SECTIONS) {
    const select = $(`voice-${section}`);
    if (![...select.options].some((o) => o.value === set[section])) continue;
    select.value = set[section];
    store.set(`voice.${section}`, select.value);
  }
  updateEstimate();
}

// Saved choices that still equal an old default follow the new default instead.
// (A choice someone made on purpose is kept.)
const OLD_DEFAULTS = { model: "anthropic/claude-opus-5", "voice.heart": "en-US-AndrewMultilingualNeural" };
function forgetOldDefaults() {
  if (store.get("defaults.v2")) return;
  for (const [key, old] of Object.entries(OLD_DEFAULTS)) if (store.get(key) === old) store.set(key, null);
  store.set("defaults.v2", true);
}

// ================================================================ the estimate (Advanced tab)


const modelLabel = (id) => (options.models.find((m) => m.id === id)?.label || id || "").replace(/ \(.*\)$/, "");
const tierOfVoice = (voice) => Object.entries(options.tiers).find(([, t]) => voice in t.voices)?.[0] || "free";

// An estimate for a new retreat with the choices on screen, calibrated on a real
// seven-day build (Claude Fable with web search, ElevenLabs voices): tokens per day
// for each part, and about 6,600 recorded characters a day.
const PER_DAY_TOKENS = { heart: [2400, 950], deep: [61000, 2800], guide: [4500, 950] };
const PLAN_TOKENS = [24000, 4500];
const DEEP_SEARCHES_PER_DAY = 4;
const CHARS_PER_DAY = { reading: 800, heart: 1900, deep: 2300, guide: 1600 };

function estimateRetreat(days = 7) {
  const model = options.models.find((m) => m.id === $("write-model").value);
  const planModel = options.models.find((m) => m.id === $("plan-model").value);
  if (!model || !planModel) return null;
  const cost = (m, [inTok, outTok]) => (m.free ? 0 : (inTok * m.input_per_m + outTok * m.output_per_m) / 1e6);
  let writing = cost(planModel, PLAN_TOKENS);
  for (const tokens of Object.values(PER_DAY_TOKENS)) writing += days * cost(model, tokens);
  if (!model.free && options.web_search) writing += days * DEEP_SEARCHES_PER_DAY * (model.web_search_each || 0);
  const voices = chosenVoices();
  const premiumChars = days * Object.entries(CHARS_PER_DAY)
    .reduce((n, [part, chars]) => n + (tierOfVoice(voices[part]) === "premium" ? chars : 0), 0);
  const voice = (premiumChars / 1000) * (options.elevenlabs?.usd_per_1k_chars || 0);
  return { total: writing + voice, writing, voice, premiumChars, model, days };
}

function updateEstimate() {
  const note = $("advanced-estimate");
  if (!note || !options) return;
  const e = estimateRetreat();
  note.hidden = !e;
  if (!e) return;
  const voicePart = e.premiumChars
    ? `ElevenLabs voices about ${money(e.voice)} (${Math.round(e.premiumChars / 1000)}k characters)`
    : "free Microsoft voices";
  note.textContent = e.total > 0
    ? `Estimated for a seven-day retreat with these choices: about ${money(e.total)}. Writing with ${modelLabel(e.model.id)} about ${money(e.writing)}, ${voicePart}.`
    : "Estimated for a seven-day retreat with these choices: free (open models and Microsoft voices).";
}
