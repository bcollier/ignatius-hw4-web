// ================================================================ highlights
// Select words while praying or reading (the passage, a reflection's or deep dive's
// script, the words on the prayer screen) and a "Highlight" button appears under the
// selection (on an iPhone the phone's own menu sits above it). The words are marked on
// the page and saved to the account; they're listed in Settings, marked again wherever
// they appear, and can come back once a week by email or text.

const HL_WHERE = "#stage-text, .passage, .exercise-text, .script, .intro-text";
const HL_MAX = 1200;
let hlSaved = []; // this person's highlights, newest first
let hlLoaded = false;
let hlRange = null; // the selection the button would save
let hlBusy = false;
const hlSignedIn = () => !!session || (typeof options !== "undefined" && options && !options.auth); // local runs have no sign-in

const hlNorm = (s) => s.replace(/\s+/g, " ").trim();

async function loadHighlights() {
  try {
    const body = await api("/api/highlights");
    hlSaved = body.highlights || [];
    hlLoaded = true;
    markAllHighlights();
    return body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the button

function hlButton() {
  let b = $("hl-button");
  if (!b) {
    b = el("button", { type: "button", id: "hl-button", class: "hl-button", hidden: true },
      el("span", { class: "hl-swatch", "aria-hidden": "true" }), "Highlight");
    // Keep the selection when the button is pressed (touch and mouse).
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.onclick = saveSelection;
    document.body.append(b);
  }
  return b;
}

function hideHlButton() {
  const b = $("hl-button");
  if (b) b.hidden = true;
  hlRange = null;
}

function onSelectionChange() {
  if (hlBusy) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !hlSignedIn()) return hideHlButton();
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const where = (node.nodeType === 1 ? node : node.parentElement)?.closest(HL_WHERE);
  const text = hlNorm(sel.toString());
  if (!where || text.length < 2 || text.length > HL_MAX) return hideHlButton();
  hlRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  const b = hlButton();
  b.hidden = false;
  const width = b.offsetWidth || 120;
  b.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
  const below = rect.bottom + 14;
  b.style.top = `${below + 44 < window.innerHeight ? below : Math.max(8, rect.top - 56)}px`;
}

// Where the selection came from: the retreat, the day and the part.
function hlContext(where) {
  const onStage = where.id === "stage-text";
  const day = onStage ? prayerDay?.day : Number(where.closest("[data-hl-day]")?.dataset.hlDay) || null;
  const part = onStage ? (shownText?.step?.part || (shownText?.source?.still ? "silence" : "")) : where.dataset.hlPart || "";
  const d = onStage ? prayerDay : retreat?.plan?.days?.find((x) => x.day === day);
  return { retreat_id: retreat?.id || "", retreat_title: retreat?.plan?.title || "", day: day ?? null, part: String(part).slice(0, 40),
    ref: d?.source_ref ? scriptureRef(d.source_ref).slice(0, 120) : "" };
}

async function saveSelection() {
  const range = hlRange;
  if (!range) return;
  const node = range.commonAncestorContainer;
  const where = (node.nodeType === 1 ? node : node.parentElement)?.closest(HL_WHERE);
  const text = hlNorm(range.toString());
  if (!where || !text) return hideHlButton();
  hlBusy = true;
  wrapRange(range);
  window.getSelection()?.removeAllRanges();
  hlBusy = false;
  hideHlButton();
  try {
    const saved = await postJson("/api/highlights", { text, ...hlContext(where) });
    if (!hlSaved.some((h) => h.id === saved.id)) hlSaved.unshift(saved);
    toast("Highlighted. It's saved under Settings → Your highlights.");
  } catch (err) {
    toast(`Couldn't save the highlight: ${err.message}`);
  }
}

// ---------------------------------------------------------------- marking words on the page

// The text nodes under `root`, in order, skipping ones already marked.
function hlTextNodes(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("mark.user-hl") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
  return out;
}

// Wrap part of one text node in a mark.
function hlWrap(node, start, end) {
  if (end <= start) return;
  let target = node;
  if (start > 0) target = target.splitText(start);
  if (end - start < target.length) target.splitText(end - start);
  const mark = el("mark", { class: "user-hl" });
  target.parentNode.insertBefore(mark, target);
  mark.append(target);
}

function wrapRange(range) {
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const pieces = [];
  for (const n of hlTextNodes(root)) {
    if (!range.intersectsNode(n)) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.length;
    if (end > start) pieces.push([n, start, end]);
  }
  for (const [n, start, end] of pieces.reverse()) hlWrap(n, start, end); // from the end, so offsets stay right
}

// Mark every saved highlight of this retreat (and day) that appears in `where`.
function markHighlightsIn(where) {
  if (!hlSaved.length || !retreat) return;
  const onStage = where.id === "stage-text";
  const day = onStage ? prayerDay?.day : Number(where.closest("[data-hl-day]")?.dataset.hlDay) || null;
  const mine = hlSaved.filter((h) => h.retreat_id === retreat.id && (h.day == null || day == null || h.day === day));
  if (!mine.length) return;
  hlBusy = true;
  for (const h of mine) {
    // One string of the container's text with whitespace collapsed, and where each character came from.
    const nodes = hlTextNodes(where);
    let flat = "";
    const from = [];
    let space = true;
    for (const n of nodes) {
      for (let i = 0; i < n.data.length; i++) {
        const ws = /\s/.test(n.data[i]);
        if (ws && space) continue;
        flat += ws ? " " : n.data[i];
        from.push([n, i]);
        space = ws;
      }
    }
    const at = flat.indexOf(h.text);
    if (at < 0) continue;
    const spans = new Map(); // node -> [first, last+1]
    for (let k = at; k < at + h.text.length; k++) {
      const [n, i] = from.at(k);
      const s = spans.get(n);
      spans.set(n, s ? [s[0], i + 1] : [i, i + 1]);
    }
    for (const [n, [a, b]] of [...spans].reverse()) hlWrap(n, a, b); // spaces too, so the stroke is continuous
  }
  hlBusy = false;
}

function markAllHighlights() {
  document.querySelectorAll(HL_WHERE).forEach(markHighlightsIn);
}

// New text on the page (a day opened, the next part on the prayer screen): mark it.
let hlPending = 0;
const hlObserver = new MutationObserver(() => {
  if (hlBusy || !hlLoaded) return;
  clearTimeout(hlPending);
  hlPending = setTimeout(markAllHighlights, 120);
});

function wireHighlights() {
  document.addEventListener("selectionchange", () => {
    clearTimeout(wireHighlights.t);
    wireHighlights.t = setTimeout(onSelectionChange, 200);
  });
  window.addEventListener("scroll", hideHlButton, { passive: true });
  hlObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------- Settings: the list and the weekly choice

async function showMyHighlights() {
  const box = $("me-highlights");
  if (!box) return;
  box.hidden = !hlSignedIn();
  if (box.hidden) return;
  const list = $("me-hl-list");
  list.replaceChildren(el("li", { class: "hint", text: "Loading…" }));
  const body = await loadHighlights();
  if (!body) {
    list.replaceChildren(el("li", { class: "hint", text: "Couldn't load your highlights." }));
    return;
  }
  drawHighlightList();
  const w = body.weekly, ch = body.channels;
  const email = $("me-hl-email"), sms = $("me-hl-sms"), phone = $("me-hl-phone");
  email.checked = w.email;
  sms.checked = w.sms;
  phone.value = w.phone || "";
  email.disabled = !ch.email || !body.email;
  sms.disabled = !ch.sms;
  $("me-hl-email-note").textContent = !ch.email ? "Email isn't set up on this server yet." : body.email ? `To ${body.email}.` : "Sign in with an email address first.";
  $("me-hl-sms-note").textContent = ch.sms ? "Standard message rates may apply." : "Text messages aren't set up on this server yet.";
  $("me-hl-phone-label").hidden = !sms.checked;
  sms.onchange = () => { $("me-hl-phone-label").hidden = !sms.checked; };
  $("me-hl-weekly-save").onclick = async () => {
    try {
      const saved = await api("/api/highlights/weekly", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.checked, sms: sms.checked, phone: phone.value }) });
      phone.value = saved.phone || "";
      toast(saved.email || saved.sms ? "One highlight will come to you each week." : "No weekly highlight.");
    } catch (err) {
      toast(err.message);
    }
  };
}

function drawHighlightList() {
  const list = $("me-hl-list");
  $("me-hl-count").textContent = hlSaved.length ? `${hlSaved.length} saved` : "";
  if (!hlSaved.length) {
    list.replaceChildren(el("li", { class: "hint", text: "Nothing highlighted yet. Select words in a passage, a reflection or on the prayer screen, then tap Highlight." }));
    return;
  }
  list.replaceChildren(...hlSaved.map((h) => el("li", { class: "hl-item" },
    el("blockquote", { text: h.text }),
    el("p", { class: "meta", text: [h.retreat_title, h.day ? `Day ${h.day}` : "", h.ref, new Date(h.at).toLocaleDateString()].filter(Boolean).join(" · ") }),
    el("button", { type: "button", class: "link danger", text: "Remove", onclick: async () => {
      try {
        await api(`/api/highlights/${h.id}`, { method: "DELETE" });
        hlSaved = hlSaved.filter((x) => x.id !== h.id);
        drawHighlightList();
      } catch (err) {
        toast(err.message);
      }
    } }))));
}
