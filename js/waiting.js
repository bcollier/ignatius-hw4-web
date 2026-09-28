// ================================================================ while the companion writes
// Typed conversations wait a few seconds (up to twenty with the free brain) for each
// reply. Instead of a spinner, something quiet happens, in the app's own manner. Five
// designs; debug mode can choose among them in Settings, where all five play side by
// side. Each one is start(host, you) -> stop(): `host` is the companion's empty reply
// bubble, `you` the person's message just sent (the highlighter works on it).

const WAITING_STYLES = {
  highlighter: { label: "The highlighter", about: "A highlighter moves back over what you wrote and marks its key words, one at a time, as if someone were reading it closely.", start: waitHighlighter },
  quill: { label: "The quill", about: "A line of ink is written in a flowing hand, then lifts and begins again.", start: waitQuill },
  candle: { label: "The candle", about: "A small candle, its flame breathing in a soft halo.", start: waitCandle },
  water: { label: "Still water", about: "Rings spread slowly across still water from a single drop.", start: waitWater },
  gold: { label: "Gold leaf", about: "The first letter of your message becomes an illuminated initial: a vine draws itself around it and gold light passes over.", start: waitGold },
};
const WAITING_DEFAULT = "highlighter";
const calmMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const waitingStyle = () => (store.get("talk.waiting") in WAITING_STYLES ? store.get("talk.waiting") : WAITING_DEFAULT);

function startWaiting(host, you, style = waitingStyle()) {
  host.classList.add("waiting", `waiting-${style}`);
  host.setAttribute("aria-label", "The companion is writing");
  const stop = WAITING_STYLES[style].start(host, you);
  return () => {
    stop?.();
    host.classList.remove("waiting", `waiting-${style}`);
    host.removeAttribute("aria-label");
    host.replaceChildren();
  };
}

const svgEl = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

// ---------------------------------------------------------------- 1. the highlighter

const QUIET_WORDS = new Set(("a about above after again all also am an and any are as at be because been before being below "
  + "between both but by can could did do does doing down during each few for from further had has have having he her here "
  + "hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on "
  + "once only or other our ours ourselves out over own really same she should so some such than that the their theirs them "
  + "themselves then there these they this those through to too under until up very was we were what when where which while "
  + "who whom why will with would you your yours yourself yourselves think feel felt know like just still even maybe kind "
  + "something thing things much going want wanted today been really").split(" "));
// Words that carry weight in prayer rise to the top.
const HEAVY_WORDS = /^(god|jesus|christ|lord|spirit|pray\w*|grace|peace|joy|love\w*|fear\w*|afraid|anxious|anxiety|grief|griev\w*|tired|weary|rest\w*|hope\w*|lost|alone|lonely|father|mother|son|daughter|child\w*|friend\w*|forgiv\w*|sorry|angry|anger|grateful|thank\w*|dark\w*|light|still\w*|silence|heart|tears|cried|cry|work|home|death|dying|sick|ill\w*|wound\w*|heal\w*|call\w*|name)$/i;

function keywords(text, most = 4) {
  const words = [...text.matchAll(/[\p{L}’']{4,}/gu)].map((m) => ({ word: m[0], at: m.index }));
  const scored = words.filter((w) => !QUIET_WORDS.has(w.word.toLowerCase()))
    .map((w) => ({ ...w, score: w.word.length + (HEAVY_WORDS.test(w.word) ? 8 : 0) + (/^\p{Lu}/u.test(w.word) && w.at > 0 ? 3 : 0) }));
  const seen = new Set();
  const best = scored.sort((a, b) => b.score - a.score).filter((w) => !seen.has(w.word.toLowerCase()) && seen.add(w.word.toLowerCase())).slice(0, most);
  return best.sort((a, b) => a.at - b.at);
}

function waitHighlighter(host, you) {
  host.append(el("span", { class: "wait-note", text: "reading what you wrote" }), el("span", { class: "wait-dots" }, el("i"), el("i"), el("i")));
  const source = you?.querySelector(".said") || you;
  if (!source) return null;
  const original = source.textContent;
  const marks = keywords(original);
  if (!marks.length) return () => {};
  // Wrap each key word in a <mark>, keeping the text exactly as it was.
  const parts = [];
  let pos = 0;
  for (const m of marks) {
    parts.push(document.createTextNode(original.slice(pos, m.at)), el("mark", { class: "hl", text: m.word }));
    pos = m.at + m.word.length;
  }
  parts.push(document.createTextNode(original.slice(pos)));
  source.replaceChildren(...parts);
  const spans = [...source.querySelectorAll("mark.hl")];
  const timers = [];
  if (calmMotion()) spans.forEach((s) => s.classList.add("on", "still"));
  else {
    const cycle = () => {
      spans.forEach((s, i) => timers.push(setTimeout(() => s.classList.add("on"), 350 + i * 750)));
      timers.push(setTimeout(() => {
        spans.forEach((s) => s.classList.add("fade"));
        timers.push(setTimeout(() => { spans.forEach((s) => s.classList.remove("on", "fade")); cycle(); }, 900));
      }, 350 + spans.length * 750 + 2600));
    };
    cycle();
  }
  return () => {
    timers.forEach(clearTimeout);
    spans.forEach((s) => s.classList.add("fade"));
    setTimeout(() => { source.textContent = original; }, 700); // the message goes back to plain text
  };
}

// ---------------------------------------------------------------- 2. the quill

function waitQuill(host) {
  // A line of cursive: loops and joins, drawn left to right, with the nib riding the stroke.
  const d = "M6 30 C 18 6, 26 6, 24 22 C 22 36, 36 34, 42 20 C 46 10, 54 10, 52 24 C 50 34, 62 34, 66 22 "
    + "C 70 12, 78 14, 76 26 C 74 36, 90 32, 94 20 C 97 11, 106 12, 104 24 C 102 34, 118 34, 122 22 C 125 13, 133 14, 132 25 "
    + "C 131 33, 146 32, 152 22";
  const svg = svgEl("svg", { viewBox: "0 0 160 40", class: "wait-quill", "aria-hidden": "true" },
    svgEl("path", { d, class: "ink" }),
    svgEl("circle", { r: "1.6", cx: "0", cy: "0", class: "blot", style: `offset-path: path('${d}')` }),
    svgEl("path", { d: "M0 0 l -12 -26 c 6 2, 12 8, 13 22 z M0 0 l -9 -19", class: "feather", style: `offset-path: path('${d}')` }));
  host.append(svg);
  if (calmMotion()) svg.classList.add("still");
  return null;
}

// ---------------------------------------------------------------- 3. the candle

function waitCandle(host) {
  host.append(svgEl("svg", { viewBox: "0 0 60 60", class: "wait-candle", "aria-hidden": "true" },
    svgEl("circle", { cx: "30", cy: "20", r: "16", class: "halo" }),
    svgEl("rect", { x: "24", y: "30", width: "12", height: "26", rx: "2", class: "wax" }),
    svgEl("path", { d: "M30 30 v -4", class: "wick" }),
    svgEl("path", { d: "M30 9 C 34 16, 35 21, 30 27 C 25 21, 26 16, 30 9 Z", class: "flame" }),
    svgEl("path", { d: "M30 18 C 31.5 21, 31.5 23, 30 26 C 28.5 23, 28.5 21, 30 18 Z", class: "core" })),
    el("span", { class: "wait-note", text: "a moment of quiet" }));
  return null;
}

// ---------------------------------------------------------------- 4. still water

function waitWater(host) {
  host.append(svgEl("svg", { viewBox: "0 0 120 44", class: "wait-water", "aria-hidden": "true" },
    svgEl("ellipse", { cx: "60", cy: "22", rx: "6", ry: "2", class: "ring r1" }),
    svgEl("ellipse", { cx: "60", cy: "22", rx: "6", ry: "2", class: "ring r2" }),
    svgEl("ellipse", { cx: "60", cy: "22", rx: "6", ry: "2", class: "ring r3" }),
    svgEl("circle", { cx: "60", cy: "22", r: "1.8", class: "drop" })));
  return null;
}

// ---------------------------------------------------------------- 5. gold leaf

function waitGold(host, you) {
  const letter = ((you?.textContent || "").match(/\p{L}/u)?.[0] || "A").toUpperCase();
  const vine = "M6 54 C 6 30, 10 12, 30 8 C 46 5, 54 14, 54 26 C 54 40, 40 44, 36 36 M54 26 C 58 34, 56 48, 44 54 "
    + "M12 40 c 4 -2, 8 0, 8 4 M44 12 c 2 -4, 6 -4, 8 -2";
  const box = el("span", { class: "wait-gold", "aria-hidden": "true" },
    svgEl("svg", { viewBox: "0 0 60 60" }, svgEl("rect", { x: "3", y: "3", width: "54", height: "54", rx: "3", class: "frame" }),
      svgEl("path", { d: vine, class: "vine" }),
      svgEl("circle", { cx: "30", cy: "8", r: "2.2", class: "bud" }), svgEl("circle", { cx: "54", cy: "26", r: "2.2", class: "bud" })),
    el("b", { text: letter }));
  host.append(box, el("span", { class: "wait-note", text: "illuminating" }));
  if (calmMotion()) box.classList.add("still");
  return null;
}

// ---------------------------------------------------------------- the Settings preview

const PREVIEW_TEXT = "This morning the word immediately stayed with me, and I felt tired but strangely at peace with my father.";

function waitingPreviews(box) {
  box.replaceChildren();
  const chosen = waitingStyle();
  for (const [id, s] of Object.entries(WAITING_STYLES)) {
    const you = el("li", { class: "you" }, el("span", { class: "said", text: PREVIEW_TEXT }));
    const host = el("li", { class: "companion" });
    const card = el("label", { class: `wait-preview${id === chosen ? " chosen" : ""}` },
      el("span", { class: "wait-preview-head" }, el("input", { type: "radio", name: "wait-style", value: id, checked: id === chosen,
        onchange: () => { store.set("talk.waiting", id); waitingPreviews(box); toast(`Waiting animation: ${s.label}.`); } }),
        el("strong", { text: s.label })),
      el("ol", { class: "talk-transcript chat preview" }, you, host),
      el("span", { class: "hint", text: s.about }));
    box.append(card);
    startWaiting(host, you, id); // they keep playing; the page replaces them when it's left
  }
}
