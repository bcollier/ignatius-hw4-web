// ================================================================ build log (the terminal)

let logState = null; // { rid, after, timer, busy }

const logTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const VENDOR_NAMES = { openrouter: "Anthropic via OpenRouter", jetstream: "Jetstream", microsoft: "Microsoft voice", elevenlabs: "ElevenLabs", openai: "OpenAI", xai: "xAI" };

function logLine(row) {
  const t = el("span", { class: "t-time", text: logTime(row.created_at) });
  if (row.purpose === "step") {
    return el("div", { class: `t-step${/fail|didn't finish/i.test(row.response) ? " t-bad" : ""}` }, t, " ", el("span", { text: `▸ ${row.response}` }));
  }
  const who = options?.search_providers?.[row.provider] || VENDOR_NAMES[row.provider] || row.provider;
  const what = row.purpose === "voice" ? `recording (${row.model})` : `${row.purpose}${row.model && row.purpose !== "research" ? ` · ${row.model}` : ""}`;
  const facts = [
    row.day ? `day ${row.day}` : "",
    row.duration_ms ? `${(row.duration_ms / 1000).toFixed(1)} s` : "",
    row.input_tokens ? `${row.input_tokens.toLocaleString()} tokens in, ${(row.output_tokens || 0).toLocaleString()} out` : "",
    row.web_searches && row.purpose !== "research" ? `${row.web_searches} web searches` : "",
    row.system_chars ? `system prompt ${row.system_chars.toLocaleString()} chars` : "",
  ].filter(Boolean).join(" · ");
  const head = el("summary", {}, t, " ", el("span", { class: row.status === "error" ? "t-bad" : "t-call", text: `→ ${who}: ${what}` }), el("span", { class: "t-dim", text: facts ? `  ${facts}` : "" }));
  return el("details", { class: "t-entry" }, head,
    row.prompt && el("pre", { class: "t-sent", text: `sent:\n${row.prompt}` }),
    row.error ? el("pre", { class: "t-bad", text: `error: ${row.error}` }) : row.response && el("pre", { class: "t-got", text: `received:\n${row.response}` }));
}

function openLog(rid) {
  $("log-card").hidden = false;
  $("log-toggle").textContent = "Hide the technical details";
  if (logState?.rid === rid) return;
  closeLog(false);
  $("terminal").innerHTML = "";
  $("terminal").append(el("div", { class: "t-dim", text: "Connecting to the build log…" }));
  logState = { rid, after: 0, timer: null, first: true };
  pollLog();
}

function closeLog(hide = true) {
  if (logState) clearTimeout(logState.timer);
  logState = null;
  if (hide) {
    $("log-card").hidden = true;
    $("log-toggle").textContent = "Show the technical details";
  }
}

async function pollLog() {
  const s = logState;
  if (!s) return;
  let page;
  try {
    page = await api(`/api/retreats/${s.rid}/log?after=${s.after}`);
  } catch (err) {
    page = { rows: [], busy: true };
  }
  if (logState !== s) return;
  const term = $("terminal");
  const atBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
  if (s.first) {
    term.innerHTML = "";
    if (!page.rows.length) term.append(el("div", { class: "t-dim", text: page.busy ? "Waiting for the first step…" : "Nothing was logged for this retreat." }));
    s.first = false;
  }
  for (const row of page.rows) term.append(logLine(row));
  if (page.rows.length) s.after = page.rows[page.rows.length - 1].id;
  if (atBottom || page.rows.length > 50) term.scrollTop = term.scrollHeight;
  if (page.busy || page.rows.length) s.timer = setTimeout(pollLog, page.busy ? 2000 : 200);
  else term.append(el("div", { class: "t-dim", text: "— end of log —" }));
}

async function downloadLog() {
  const rid = retreat?.id;
  if (!rid) return;
  const button = $("log-download");
  button.textContent = "Preparing…";
  try {
    const full = await api(`/api/retreats/${rid}/log?full=true`);
    const blob = new Blob([JSON.stringify({ retreat: retreat.plan?.title, id: rid, rows: full.rows }, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `build-log-${rid.slice(0, 8)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.textContent = "Download the full log (JSON)";
  }
}
