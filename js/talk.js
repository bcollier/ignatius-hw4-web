// ================================================================ talk it over (live voice)
// OpenAI GPT-Live: WebRTC; the server relays the offer and returns the answer.
// xAI Grok voice: WebSocket with a short-lived token from the server; audio is PCM16
// at 24 kHz, captured with an AudioWorklet and played back as scheduled buffers.

let talkState = null;

// ---------------------------------------------------------------- choosing the voice

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

function talkVoiceLine() {
  const providers = talkProviders();
  const info = providers[$("talk-provider").value];
  if (!info) return;
  const v = $("talk-voice").value;
  $("talk-voice-line").textContent = `Voice: ${info.voices[v] || v}, ${info.label}.`;
}

// The conversation voice pickers ("Change voice" on the Talk page). Every choice is
// remembered on this device, per voice service.
function fillTalkSettings() {
  const providers = talkProviders();
  $("talk-voice-change").hidden = !Object.keys(providers).length;
  if (!Object.keys(providers).length) return;
  const psel = $("talk-provider");
  psel.innerHTML = "";
  for (const [id, info] of Object.entries(providers)) psel.add(new Option(info.label, id));
  const savedP = store.get("talk.provider");
  psel.value = providers[savedP] ? savedP : options.talk.default_provider;
  psel.onchange = () => {
    store.set("talk.provider", psel.value);
    fillTalkVoices();
  };
  $("talk-hear").onclick = playTalkSample;
  if (!talkSamples) loadTalkSamples().then(fillTalkVoices); // genders and samples arrive a moment later
  fillTalkVoices();
}

function fillTalkVoices() {
  const provider = $("talk-provider").value;
  const info = talkProviders()[provider];
  const vsel = $("talk-voice");
  vsel.innerHTML = "";
  for (const [id, label] of Object.entries(info.voices)) {
    const gender = talkSample(provider, id)?.gender;
    vsel.add(new Option(gender ? `${label} (${gender})` : label, id));
  }
  const savedV = store.get(`talk.voice.${provider}`);
  vsel.value = info.voices[savedV] ? savedV : info.default_voice in info.voices ? info.default_voice : Object.keys(info.voices)[0];
  vsel.onchange = () => {
    store.set(`talk.voice.${provider}`, vsel.value);
    showSampleButton();
    talkVoiceLine();
  };
  showSampleButton();
  talkVoiceLine();
}

// Most voices have a recorded sample; OpenAI's live-only voices don't.
function showSampleButton() {
  const sample = talkSample($("talk-provider").value, $("talk-voice").value);
  $("talk-hear").hidden = !sample;
  $("talk-no-sample").hidden = !!sample;
}

function playTalkSample() {
  const sample = talkSample($("talk-provider").value, $("talk-voice").value);
  if (!sample) return;
  const a = $("talk-sample-player");
  a.src = sample.file;
  a.play().catch(() => {});
}

// ---------------------------------------------------------------- the talk page

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
  if (!t.enabled) {
    $("talk-context").textContent = "Live conversation isn't set up on this server yet.";
    $("talk-start").disabled = true;
    return;
  }
  const r = retreatId ? retreat : null;
  $("talk-context").textContent = talkContextLine(r);
  talkVoiceLine();
  wireVoiceChange();
  $("talk-limit").hidden = !isFree();
  $("talk-limit").textContent = `Free accounts can talk for ${t.free_seconds} seconds a day. Premium accounts can talk for up to ${Math.round(t.max_seconds / 60)} minutes at a time.`;
  resetTalkControls(t, r);
  loadTalkHistory();
}

function talkContextLine(r) {
  if (!r) return "Not tied to a retreat. Open a retreat and choose “Talk it over” to talk about it.";
  const listened = Object.values(r.days).filter((d) => d.prayed_at || d.listening?.parts_played?.length).length;
  return `About “${r.plan?.title}”: the companion knows its ${r.plan?.days.length} days and that you've listened to ${listened} of them.`;
}

// "Change voice" opens the voice pickers tucked under the current voice.
function wireVoiceChange() {
  $("talk-fields").hidden = true;
  $("talk-voice-change").textContent = "Change voice";
  $("talk-voice-change").onclick = () => {
    $("talk-fields").hidden = !$("talk-fields").hidden;
    $("talk-voice-change").textContent = $("talk-fields").hidden ? "Change voice" : "Done";
  };
}

function resetTalkControls(t, r) {
  const providers = talkProviders();
  $("talk-start").disabled = false;
  $("talk-start").textContent = "Start talking";
  $("talk-start").hidden = false;
  $("talk-stop").hidden = true;
  $("talk-timer").hidden = true;
  // Read the choice when talking starts, so a change just made is used.
  $("talk-start").onclick = () => {
    const provider = providers[$("talk-provider").value] ? $("talk-provider").value : t.default_provider;
    startTalk(provider, $("talk-voice").value, r?.id || null);
  };
  $("talk-stop").onclick = () => endTalk("You ended the conversation.");
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
  startOrb();
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
    // Made during the tap, so the browser lets it run: it drives the orb (and plays Grok's voice).
    const audioCtx = new AudioContext(provider === "xai" ? { sampleRate: 24000 } : {});
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    talkState = { provider, stream, transcriptParts: [], audioCtx };
    status.textContent = "Connecting…";
    if (provider === "xai") await startGrok(stream, voice, retreatId);
    else await startOpenAI(stream, voice, retreatId);
  } catch (err) {
    status.className = "status bad";
    status.textContent = err.name === "NotAllowedError" || err.name === "SecurityError" ? microphoneHelp() : err.message;
    status.append(el("small", { class: "error-code", text: ` (${err.name || "error"})` }));
    $("talk-start").disabled = false;
    cleanupTalk();
    talkState = null;
  }
}

async function startOpenAI(stream, voice, retreatId) {
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
    talkState.remoteStream = e.streams[0];
    if (talkState.meters) talkState.meters.ai = makeMeter(talkState.audioCtx, talkState.audioCtx.createMediaStreamSource(e.streams[0]));
  };
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
  const ctx = talkState.audioCtx || new AudioContext({ sampleRate: 24000 });
  // The companion's voice goes through one node, so the orb can follow it.
  const aiOut = ctx.createGain();
  aiOut.connect(ctx.destination);
  talkState.aiOut = aiOut;
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
  src.connect(t.aiOut || t.ctx.destination);
  const at = Math.max(t.ctx.currentTime + 0.02, t.playAt);
  src.start(at);
  t.playAt = at + buffer.duration;
  t.sources.add(src);
  src.onended = () => t.sources.delete(src);
}

// ---------------------------------------------------------------- the orb
// It follows the sound: your microphone while you speak, the companion's voice while
// it speaks, and breathes slowly in between.

function makeMeter(ctx, node) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  node.connect(analyser);
  return { analyser, buf: new Float32Array(analyser.fftSize) };
}

function meterLevel(m) {
  if (!m) return 0;
  m.analyser.getFloatTimeDomainData(m.buf);
  let sum = 0;
  for (const v of m.buf) sum += v * v;
  return Math.sqrt(sum / m.buf.length);
}

function startOrb() {
  const t = talkState;
  const ctx = t.audioCtx;
  const orb = $("talk-orb");
  if (!ctx) return;
  ctx.resume?.().catch(() => {});
  t.meters = {
    mic: makeMeter(ctx, ctx.createMediaStreamSource(t.stream)),
    ai: t.aiOut ? makeMeter(ctx, t.aiOut) : t.remoteStream ? makeMeter(ctx, ctx.createMediaStreamSource(t.remoteStream)) : null,
  };
  let mic = 0, ai = 0;
  const tick = () => {
    if (talkState !== t) return;
    mic = Math.max(meterLevel(t.meters.mic), mic * 0.88);
    ai = Math.max(meterLevel(t.meters.ai), ai * 0.88);
    const speaking = ai > 0.015;
    const listening = !speaking && mic > 0.03;
    orb.classList.toggle("speaking", speaking);
    orb.classList.toggle("listening", listening);
    orb.style.setProperty("--level", Math.min(1, (speaking ? ai : listening ? mic : 0) * 5).toFixed(3));
    t.orbFrame = requestAnimationFrame(tick);
  };
  tick();
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
  cancelAnimationFrame(t.orbFrame);
  const orb = $("talk-orb");
  orb.classList.remove("speaking", "listening");
  orb.style.removeProperty("--level");
  try { if (t.audioCtx && t.audioCtx !== t.ctx) t.audioCtx.close(); } catch {}
  try { t.pc?.close(); } catch {}
  try { t.ws?.close(); } catch {}
  try { t.capture?.disconnect(); } catch {}
  try { t.ctx?.close(); } catch {}
  t.stream?.getTracks().forEach((track) => track.stop());
  if (t.audio) t.audio.srcObject = null;
}


// ---------------------------------------------------------------- the companion's instructions

async function fillCompanionPrompt() {
  const box = $("companion-prompt");
  const fallback = options.prompts?.companion || "";
  try {
    const me = await api("/api/profile");
    box.value = me.companion_prompt || fallback;
  } catch {
    box.value = fallback;
  }
  $("companion-status").textContent = box.value === fallback ? "Using the default." : "Using your own instructions.";
}

async function saveCompanionPrompt(text) {
  $("companion-status").textContent = "Saving…";
  try {
    const custom = text.trim() === (options.prompts?.companion || "").trim() ? "" : text;
    await postJson("/api/profile", { companion_prompt: custom }, "PUT");
    $("companion-status").textContent = custom ? "Saved. Your instructions are used from the next conversation." : "Using the default.";
  } catch (err) {
    $("companion-status").textContent = err.message;
  }
}

function wireCompanionPrompt() {
  $("talk-prompt").addEventListener("toggle", () => $("talk-prompt").open && fillCompanionPrompt());
  $("companion-save").onclick = () => saveCompanionPrompt($("companion-prompt").value);
  $("companion-reset").onclick = () => {
    $("companion-prompt").value = options.prompts?.companion || "";
    saveCompanionPrompt("");
  };
}


// Where to turn the microphone on, for the browser the person is using. On an iPhone
// the browser asks only once per site; after that it has to be allowed in Settings.
function microphoneHelp() {
  const ua = navigator.userAgent;
  const iphone = /iPhone|iPad|iPod/.test(ua);
  if (iphone && /CriOS/.test(ua)) {
    return "The microphone is blocked for Chrome. Open the iPhone's Settings app, tap Apps, then Chrome, and turn on Microphone. "
      + "Then come back, reload this page and tap Start talking; when Chrome asks, choose Allow.";
  }
  if (iphone) {
    return "The microphone is blocked. In Safari, tap the page menu (aA) next to the address, then Website Settings, and set Microphone to Allow. "
      + "If it's still blocked, open the Settings app, tap Apps, then Safari, and set Microphone to Allow.";
  }
  return "The microphone wasn't allowed. Click the icon at the left of the address bar, allow the microphone for this site, and try again.";
}
