// ================================================================ evals (?evals, debug mode)
// Are the eval judges measuring anything? Reads evals/<run>.json (written by the API
// repo's evals/analysis.py) and draws it: how each judge uses the scale, every scale's
// distribution, agreement (Krippendorff's alpha, ICC, Cohen's kappa), whether each scale
// can tell the models apart, the models' means with bootstrap intervals, how redundant
// the scales are, and how many passages a real comparison needs. Charts are plain SVG.

const EV_RUN = "full";
// Colour-blind-safe (Okabe-Ito) for judges; a separate set for the models they judge.
const EV_JUDGE_COLORS = { gemini: "#0072B2", muse: "#D55E00", "llama-scout": "#009E73", opus: "#CC79A7", "gpt6-sol": "#56B4E9", fable: "#E69F00" };
const EV_MODEL_COLORS = { opus: "#7B2D8E", "gpt6-sol": "#1F5FA8", muse: "#B8741A", gemma: "#2E7D4F", fable: "#8E2D2D", "gpt6-astra": "#3C3C3C" };
const EV_LEVEL_COLORS = ["#b2182b", "#d6604d", "#f4a582", "#d9d0c1", "#92c5de", "#4393c3", "#2166ac"]; // 1..7, diverging at 4
let evData = null;
let evTrack = "heart";

async function openEvals() {
  show("evals");
  document.title = "Evals · Ignatius at Home";
  if (!debugMode()) {
    $("ev-body").replaceChildren(el("p", { class: "lede", text: "The eval analysis is part of debug mode: turn it on in Settings." }));
    return;
  }
  try {
    evData = evData || await (await fetch(`evals/${EV_RUN}.json?v=${RUNNING_VERSION}`, { cache: "no-store" })).json();
  } catch {
    $("ev-body").replaceChildren(el("p", { class: "lede", text: "No eval results have been published yet." }));
    return;
  }
  renderEvals();
}

// ---------------------------------------------------------------- small helpers

const EV_SVGNS = "http://www.w3.org/2000/svg";
function evS(tag, attrs = {}, ...children) {
  const node = document.createElementNS(EV_SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  return node;
}
const evSvg = (w, h, cls = "") => evS("svg", { viewBox: `0 0 ${w} ${h}`, class: `ev-svg ${cls}`, role: "img" });
const evPretty = (s) => s.replace(/_/g, " ");
const evF2 = (x) => (x == null ? "–" : x.toFixed(2));
const evPct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const evJudge = (id) => evData.judges.find((j) => j.id === id)?.label.replace(/ \(.*\)/, "") || id;
const evModel = (id) => evData.models.find((m) => m.id === id)?.label.replace(/ \(.*\)/, "") || id;
const evLower = (s) => evData.lower_is_better.includes(s);
const evGood = (s, v) => (evLower(s) ? 8 - v : v);
const evTd = () => evData.tracks_data[evTrack];
const evScales = () => evData.tracks.find((t) => t.id === evTrack).scales;

function evFigure(title, caption, ...content) {
  return el("figure", { class: "card ev-figure" }, el("h3", { text: title }), ...content, caption ? el("figcaption", { class: "hint", text: caption }) : "");
}

function evLegend(items) {
  return el("div", { class: "ev-legend" }, items.map(([label, color, shape = "dot"]) =>
    el("span", {}, el("i", { class: `ev-key ${shape}`, style: `--c:${color}` }), label)));
}

function evReliability(x) {
  if (x == null) return ["not measurable", "none"];
  if (x >= 0.8) return ["reliable", "good"];
  if (x >= 0.667) return ["tentative", "fair"];
  if (x >= 0.4) return ["weak", "poor"];
  return ["not reliable", "none"];
}

// ---------------------------------------------------------------- the page

function renderEvals() {
  const d = evData;
  $("ev-meta").textContent = `Run “${d.run}”, analysed ${d.made.replace("T", " ")} UTC. Judges: ${d.judges.map((j) => j.label).join(", ")}. `
    + `Contestants: ${d.models.map((m) => m.label).join(", ")}. ${d.judgments.length} judgments.`;
  const tabs = $("ev-tracks");
  tabs.replaceChildren(...d.tracks.filter((t) => d.tracks_data[t.id]).map((t) =>
    el("button", { type: "button", role: "tab", "aria-selected": String(t.id === evTrack), text: t.label,
      onclick: () => { evTrack = t.id; renderEvals(); } })));
  $("ev-body").replaceChildren(
    evVerdict(), evJudges(), evDistributions(), evAgreement(), evDiscrimination(),
    evModels(), evRedundancy(), evPower(), evJudgments());
}

// 1 ---------------------------------------------------------------- the short answer
function evVerdict() {
  const rows = evData.tracks.filter((t) => evData.tracks_data[t.id]).map((t) => {
    const td = evData.tracks_data[t.id];
    const o = td.overall;
    const [word, cls] = evReliability(o.icck);
    const usable = td.scales.filter((s) => (s.alpha_std ?? -1) >= 0.667).length;
    const telling = td.scales.filter((s) => s.eta2_p != null && s.eta2_p < 0.05).map((s) => evPretty(s.scale));
    const ceiling = td.scales.reduce((n, s) => n + (s.ceiling || 0), 0) / td.scales.length;
    return el("tr", {},
      el("th", { text: t.label }),
      el("td", {}, el("span", { class: `ev-chip ${cls}`, text: word }), ` ICC(2,k) ${evF2(o.icck)}`),
      el("td", { text: `${evF2(o.icc1)}` }),
      el("td", { text: o.judges_for_08 ? `about ${Math.ceil(o.judges_for_08)}` : "no number would" }),
      el("td", { text: `${usable} of ${td.scales.length}` }),
      el("td", { text: evPct(ceiling) }),
      el("td", { text: telling.length ? telling.join(", ") : "none" }));
  });
  const heart = evData.tracks_data.heart;
  const best = heart?.diffs?.filter((x) => x.lo > 0 || x.hi < 0) || [];
  return el("section", { class: "ev-section" },
    el("h2", { text: "The short answer" }),
    el("p", { text: "Whether these judges' scores can be trusted, evTd by evTd. ICC(2,k) is how reliable the average of all the judges is: the number the reports use. ICC(2,1) is how reliable one judge is alone. Spearman-Brown turns that into how many judges it would take for the average to reach 0.8." }),
    el("div", { class: "ev-table-wrap" }, el("table", { class: "ev-table" },
      el("thead", {}, el("tr", {}, ["Track", "Average of the judges", "One judge", "Judges for 0.8", "Scales with alpha ≥ 0.67", "Scores at 6 or 7", "Scales that separate the models (p < .05)"].map((h) => el("th", { text: h })))),
      el("tbody", {}, rows))),
    el("ul", { class: "ev-findings" },
      el("li", { text: `Most scores sit at the top of the scale, so there's little room for the judges to agree or disagree: this "ceiling" is the main reason agreement statistics are low, even where the judges are rarely more than a point apart.` }),
      el("li", { text: `The overall score (each piece's average across every scale and judge) is steadier than any single scale: it separates the models more clearly than the judges agree on any one quality.` }),
      best.length ? el("li", { text: `For the heart, differences whose 95% interval excludes zero: ${best.map((x) => `${evModel(x.a)} − ${evModel(x.b)} = ${evF2(x.diff)} (${evF2(x.lo)} to ${evF2(x.hi)})`).join("; ")}.` }) : "",
      el("li", { text: "Read the sections below before trusting any ranking: they show where the numbers come from and where they don't." })));
}

// 2 ---------------------------------------------------------------- the judges
function evJudges() {
  const judges = evData.judges.map((j) => j.id);
  const counts = Object.fromEntries(judges.map((j) => [j, Array(7).fill(0)]));
  const sums = Object.fromEntries(judges.map((j) => [j, [0, 0]]));
  for (const r of evData.judgments) {
    if (r.track !== evTrack) continue;
    for (const [s, v] of Object.entries(r.scores)) {
      const g = evGood(s, v);
      counts[r.judge][Math.round(g) - 1]++;
      sums[r.judge][0] += g;
      sums[r.judge][1]++;
    }
  }
  const W = 760, rowH = 34, left = 170, right = 70, top = 26;
  const svg = evSvg(W, top + judges.length * rowH + 30);
  const x = (p) => left + p * (W - left - right);
  svg.append(evS("text", { x: left, y: 14, class: "ev-axis-label" }, "share of that judge's scores, 1 (worst) to 7 (best), lower-is-better scales turned around"));
  judges.forEach((j, i) => {
    const y = top + i * rowH, total = counts[j].reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    svg.append(evS("text", { x: left - 10, y: y + 17, class: "ev-row-label", "text-anchor": "end" }, evJudge(j)));
    counts[j].forEach((n, k) => {
      const w = n / total;
      if (w > 0) {
        svg.append(evS("rect", { x: x(acc), y: y + 2, width: Math.max(0.5, x(acc + w) - x(acc)), height: rowH - 10, fill: EV_LEVEL_COLORS[k] },
          evS("title", {}, `${evJudge(j)}: ${n} scores of ${k + 1} (${evPct(w)})`)));
        if (w > 0.07) svg.append(evS("text", { x: (x(acc) + x(acc + w)) / 2, y: y + 19, class: "ev-in-bar", "text-anchor": "middle" }, String(k + 1)));
      }
      acc += w;
    });
    const mean = sums[j][0] / (sums[j][1] || 1);
    const top67 = (counts[j][5] + counts[j][6]) / total;
    svg.append(evS("text", { x: W - right + 8, y: y + 17, class: "ev-row-value" }, `${evPct(top67)} at 6–7`));
    svg.append(evS("text", { x: W - right + 8, y: y + 30, class: "ev-row-note" }, `mean ${mean.toFixed(2)}`));
  });
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => svg.append(evS("text", { x: x(p), y: top + judges.length * rowH + 16, class: "ev-tick", "text-anchor": "middle" }, evPct(p))));

  const stats = evData.judge_stats;
  const table = el("table", { class: "ev-table" },
    el("thead", {}, el("tr", {}, ["Judge", "Judged", "Failed to answer", "Mean (all tracks)", "Spread of overall scores", "Scores at 6–7", "Scores of 7", "Cost"].map((h) => el("th", { text: h })))),
    el("tbody", {}, stats.map((s) => el("tr", {},
      el("th", {}, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[s.judge] || "#888"}` }), evJudge(s.judge)),
      el("td", { text: s.items }), el("td", { text: `${s.failed}${s.failed ? ` (${evPct(s.failed / (s.items + s.failed))})` : ""}` }),
      el("td", { text: evF2(s.mean) }), el("td", { text: evF2(s.sd) }), el("td", { text: evPct(s.ceiling) }), el("td", { text: evPct(s.top) }),
      el("td", { text: s.usd ? `$${s.usd.toFixed(2)}` : "free" })))));

  const pairs = evTd().pairs;
  const ptable = el("table", { class: "ev-table" },
    el("thead", {}, el("tr", {}, ["Pair", "Weighted κ (per scale, averaged)", "Exact agreement", "Within one point", "Spearman ρ (overall scores)", "Bias (second − first)"].map((h) => el("th", { text: h })))),
    el("tbody", {}, pairs.map((p) => el("tr", {},
      el("th", { text: `${evJudge(p.a)} · ${evJudge(p.b)}` }), el("td", { text: evF2(p.kappa) }), el("td", { text: evPct(p.exact) }),
      el("td", { text: evPct(p.within1) }), el("td", { text: evF2(p.spearman) }), el("td", { text: p.bias == null ? "–" : (p.bias > 0 ? "+" : "") + p.bias.toFixed(2) })))));

  return el("section", { class: "ev-section" },
    el("h2", { text: "The judges" }),
    evFigure(`How each judge uses the scale · ${evTd().label}`,
      "Every score each judge gave, as shares of 1 to 7 (the lower-is-better scales turned around, so right is always good). A judge whose bar is nearly all dark blue has little room left to tell a good piece from a great one.",
      svg, evLegend(EV_LEVEL_COLORS.map((c, i) => [String(i + 1), c, "square"]))),
    evFigure("Each judge in numbers", "Failed to answer: judgments where the model didn't return every score as valid JSON after two tries. The spread is across pieces: how much a judge's overall score moves from one piece to the next.",
      el("div", { class: "ev-table-wrap" }, table)),
    evFigure(`Judge against judge · ${evTd().label}`,
      "Cohen's κ with quadratic weights, computed scale by scale and averaged (pooling the scales would reward two judges merely for knowing which end of the range each scale lives at). κ near 0 with high exact agreement is the ceiling at work: when nearly every score is a 6, agreeing is easy and κ can't tell it from chance. Bias is how much higher the second judge scores on average.",
      el("div", { class: "ev-table-wrap" }, ptable)));
}

// 3 ---------------------------------------------------------------- distributions
function evDistributions() {
  const scales = evScales();
  const judges = evData.judges.map((j) => j.id);
  const byScale = Object.fromEntries(evTd().scales.map((s) => [s.scale, s]));
  const grid = el("div", { class: "ev-multiples", style: `--cols:${judges.length}` });
  grid.append(el("span", {}), ...judges.map((j) => el("span", { class: "ev-col-head" }, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[j]}` }), evJudge(j))));
  for (const s of scales) {
    const info = byScale[s];
    grid.append(el("span", { class: "ev-row-head" }, evPretty(s), evLower(s) ? el("small", { text: " ↓ lower is better" }) : ""));
    const peak = Math.max(1, ...judges.map((j) => Math.max(...(info?.hist[j] || [0]))));
    for (const j of judges) {
      const h = info?.hist[j] || Array(7).fill(0), n = h.reduce((a, b) => a + b, 0);
      const W = 140, H = 46, bw = W / 7;
      const svg = evSvg(W, H + 12, "ev-mini");
      h.forEach((c, k) => {
        const bh = (c / peak) * H;
        svg.append(evS("rect", { x: k * bw + 1.5, y: H - bh, width: bw - 3, height: Math.max(c ? 1 : 0, bh), fill: EV_JUDGE_COLORS[j] || "#888", opacity: 0.85 },
          evS("title", {}, `${evJudge(j)}, ${evPretty(s)}: ${c} of ${n} scored ${k + 1}`)));
        svg.append(evS("text", { x: k * bw + bw / 2, y: H + 10, class: "ev-mini-tick", "text-anchor": "middle" }, String(k + 1)));
      });
      const mean = info?.judge_means?.[j];
      if (mean != null) svg.append(evS("line", { x1: (mean - 0.5) * bw, x2: (mean - 0.5) * bw, y1: 0, y2: H, class: "ev-mean-line" }, evS("title", {}, `mean ${mean.toFixed(2)}`)));
      grid.append(el("div", { class: "ev-cell" }, svg));
    }
  }
  return el("section", { class: "ev-section" },
    el("h2", { text: `Every scale, every judge · ${evTd().label}` }),
    evFigure("Distributions of the raw scores",
      "Each small chart counts one judge's scores on one scale, 1 to 7 as the judge gave them (so for the ↓ scales, low is good). Bars share a height scale across the row, so rows can be compared across judges; the thin line is the judge's mean. Look for piles at one value (no spread to measure) and for judges whose piles sit in different places (a difference in leniency, not in what they saw).",
      el("div", { class: "ev-scroll" }, grid)));
}

// 4 ---------------------------------------------------------------- agreement
function evAgreement() {
  const t = evTd();
  const rows = [{ scale: "overall score", ...t.overall, bold: true }, ...t.scales.map((s) => ({ ...s, scale: evPretty(s.scale) }))];
  const W = 820, rowH = 22, left = 180, right = 150, top = 118, lo = -0.6, hi = 1, foot = 118;
  const H = top + rows.length * rowH + foot;
  const svg = evSvg(W, H, "ev-agree");
  const x = (v) => left + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (W - left - right);
  const bottom = top + rows.length * rowH;
  const note = (tx, ty, text, cls = "ev-note") => svg.append(evS("text", { x: tx, y: ty, class: cls }, text));
  const arrow = (x1, y1, x2, y2) => svg.append(evS("path", { d: `M${x1} ${y1} L${x2} ${y2}`, class: "ev-leader", "marker-end": "url(#ev-arrow)" }));
  svg.append(evS("defs", {}, evS("marker", { id: "ev-arrow", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
    evS("path", { d: "M0 0 L8 4 L0 8 z", class: "ev-arrowhead" }))));

  // the scale itself, labelled where it matters
  svg.append(evS("rect", { x: x(0.8), y: top - 6, width: x(1) - x(0.8), height: rows.length * rowH + 4, class: "ev-band good" }));
  svg.append(evS("rect", { x: x(0.667), y: top - 6, width: x(0.8) - x(0.667), height: rows.length * rowH + 4, class: "ev-band fair" }));
  svg.append(evS("rect", { x: x(lo), y: top - 6, width: x(0) - x(lo), height: rows.length * rowH + 4, class: "ev-band worse" }));
  note(x(1), 16, "1 = perfect agreement", "ev-note strong end");
  arrow(x(1) - 4, 22, x(1) - 1, top - 10);
  note(x(0), 16, "0 = no better than chance", "ev-note strong mid");
  arrow(x(0), 22, x(0), top - 10);
  note(x(lo) + 2, 16, "below 0 = systematic", "ev-note strong");
  note(x(lo) + 2, 30, "disagreement", "ev-note strong");
  note((x(0.667) + x(0.8)) / 2, top - 12, "tentative", "ev-band-label mid");
  note((x(0.8) + x(1)) / 2, top - 12, "reliable", "ev-band-label mid");
  svg.append(evS("line", { x1: x(0), x2: x(0), y1: top - 6, y2: bottom, class: "ev-zero" }));
  note(W - right + 12, top - 26, "exact agreement ·", "ev-note");
  note(W - right + 12, top - 12, "within one point", "ev-note");

  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    svg.append(evS("line", { x1: left, x2: W - right, y1: y, y2: y, class: "ev-guide" }));
    svg.append(evS("text", { x: left - 10, y: y + 4, class: `ev-row-label${r.bold ? " bold" : ""}`, "text-anchor": "end" }, r.scale));
    const pts = [[r.alpha, "raw", "Krippendorff's alpha"], [r.alpha_std, "std", "alpha with each judge's leniency removed"], [r.icck, "icc", "ICC(2,k), the average of the judges"]];
    const xs = pts.filter((p) => p[0] != null).map((p) => x(p[0]));
    if (xs.length > 1) svg.append(evS("line", { x1: Math.min(...xs), x2: Math.max(...xs), y1: y, y2: y, class: "ev-span" }));
    for (const [v, kind, name] of pts) {
      if (v == null) continue;
      const mark = kind === "icc" ? evS("path", { d: `M${x(v)} ${y - 5}l5 5l-5 5l-5 -5z`, class: `ev-pt ${kind}` }) : evS("circle", { cx: x(v), cy: y, r: 4.5, class: `ev-pt ${kind}` });
      mark.append(evS("title", {}, `${r.scale}: ${name} ${v.toFixed(2)}`));
      svg.append(mark);
    }
    if (r.exact != null) svg.append(evS("text", { x: W - right + 12, y: y + 4, class: "ev-row-note" }, `${evPct(r.exact)} · ${evPct(r.within1)}`));
    if (i === 0) {  // callouts naming each marker, on the first row, staggered so they never collide
      const called = pts.filter((p) => p[0] != null).sort((a, b) => a[0] - b[0]);
      const words = { raw: "alpha, raw scores", std: "alpha, leniency removed", icc: "ICC(2,k): the judges' average" };
      called.forEach(([v, kind], k) => {
        const ly = top - 40 - k * 16;
        const lx = Math.min(W - right - 10, Math.max(left + 10, x(v)));
        svg.append(evS("path", { d: `M${x(v)} ${y - 7} L${x(v)} ${ly + 3}`, class: "ev-leader thin" }));
        note(lx + 4, ly, words[kind], `ev-callout ${kind}`);
      });
    }
  });
  [-0.5, 0, 0.5, 0.667, 0.8, 1].forEach((v) => svg.append(evS("text", { x: x(v), y: bottom + 16, class: "ev-tick", "text-anchor": "middle" }, v === 0.667 ? ".67" : String(v))));

  // how to read it: two drawn examples
  const fy = bottom + 44;
  note(left - 10, fy, "How to read a row", "ev-note strong endish");
  const ex1 = left + 10;
  svg.append(evS("line", { x1: ex1, x2: ex1 + 90, y1: fy + 18, y2: fy + 18, class: "ev-span" }));
  svg.append(evS("circle", { cx: ex1, cy: fy + 18, r: 4.5, class: "ev-pt raw" }));
  svg.append(evS("circle", { cx: ex1 + 90, cy: fy + 18, r: 4.5, class: "ev-pt std" }));
  note(ex1 + 104, fy + 22, "A long gap from hollow to filled: the judges order the pieces alike but disagree about how generous to be.");
  const ex2 = x(0);
  svg.append(evS("circle", { cx: ex1 + 45, cy: fy + 48, r: 4.5, class: "ev-pt std" }));
  svg.append(evS("line", { x1: ex1 + 45, x2: ex1 + 45, y1: fy + 38, y2: fy + 58, class: "ev-zero" }));
  note(ex1 + 104, fy + 52, "A filled circle near 0: even allowing for generosity, they don't rank the pieces alike.");
  void ex2;
  return el("section", { class: "ev-section" },
    el("h2", { text: `Do the judges agree? · ${t.label}` }),
    evFigure("Agreement, scale by scale",
      "Krippendorff's alpha measures agreement beyond chance for any number of judges. The filled circle recomputes it after putting every judge on its own scale (its mean and spread removed). ICC(2,k) is the reliability of the judges' average, the number the reports use.",
      svg));
}

// 5 ---------------------------------------------------------------- discrimination
function evDiscrimination() {
  const rows = [...evTd().scales].sort((a, b) => (b.eta2 ?? 0) - (a.eta2 ?? 0));
  const W = 760, rowH = 22, left = 180, right = 110, top = 22;
  const svg = evSvg(W, top + rows.length * rowH + 26);
  const x = (v) => left + v * (W - left - right);
  svg.append(evS("text", { x: left, y: 12, class: "ev-axis-label" }, "share of the scale's variation that is which model wrote the piece (η²)"));
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const sig = r.eta2_p != null && r.eta2_p < 0.05;
    svg.append(evS("text", { x: left - 10, y: y + 14, class: "ev-row-label", "text-anchor": "end" }, evPretty(r.scale)));
    svg.append(evS("rect", { x: left, y: y + 4, width: Math.max(0, x(r.eta2 || 0) - left), height: rowH - 8, class: `ev-bar${sig ? " sig" : ""}` },
      evS("title", {}, `η² ${evF2(r.eta2)}, by chance ${evF2(r.eta2_null)}, p ${r.eta2_p == null ? "–" : r.eta2_p.toFixed(3)}`)));
    if (r.eta2_null != null) svg.append(evS("line", { x1: x(r.eta2_null), x2: x(r.eta2_null), y1: y + 2, y2: y + rowH - 2, class: "ev-null" }));
    svg.append(evS("text", { x: W - right + 8, y: y + 14, class: "ev-row-note" }, r.eta2_p == null ? "" : `p ${r.eta2_p < 0.001 ? "< .001" : r.eta2_p.toFixed(3)}${sig ? " *" : ""}`));
  });
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => svg.append(evS("text", { x: x(v), y: top + rows.length * rowH + 16, class: "ev-tick", "text-anchor": "middle" }, String(v))));
  return el("section", { class: "ev-section" },
    el("h2", { text: `Can each scale tell the models apart? · ${evTd().label}` }),
    evFigure("Signal against chance",
      "Bars: η², the share of a scale's variation across pieces that is explained by which model wrote them (on each piece's average across judges). The tick on each bar is what η² comes to by chance with this many pieces and models, found by shuffling which model wrote which piece 2,000 times; p is the share of shuffles that did as well. Dark bars (*) beat chance at p < .05. With so few pieces, even a real difference can miss this line, and one in twenty scales will cross it by luck.",
      svg));
}

// 6 ---------------------------------------------------------------- models
function evModels() {
  const t = evTd();
  const rows = t.models;
  const all = rows.flatMap((r) => [r.lo, r.hi, ...Object.values(r.by_judge)]).filter((v) => v != null);
  const lo = Math.max(1, Math.floor((Math.min(...all) - 0.15) * 4) / 4), hi = Math.min(7, Math.ceil((Math.max(...all) + 0.15) * 4) / 4);
  const W = 760, rowH = 40, left = 170, right = 90, top = 26;
  const svg = evSvg(W, top + rows.length * rowH + 30);
  const x = (v) => left + (v - lo) / (hi - lo) * (W - left - right);
  for (let v = Math.ceil(lo * 4) / 4; v <= hi + 1e-9; v += 0.25) {
    svg.append(evS("line", { x1: x(v), x2: x(v), y1: top - 6, y2: top + rows.length * rowH, class: "ev-grid" }));
    svg.append(evS("text", { x: x(v), y: top + rows.length * rowH + 16, class: "ev-tick", "text-anchor": "middle" }, v.toFixed(2)));
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const c = EV_MODEL_COLORS[r.model] || "#666";
    svg.append(evS("text", { x: left - 10, y: y + 4, class: "ev-row-label", "text-anchor": "end" }, evModel(r.model)));
    svg.append(evS("line", { x1: x(r.lo), x2: x(r.hi), y1: y, y2: y, stroke: c, "stroke-width": 3, "stroke-linecap": "round" }));
    Object.entries(r.by_judge).forEach(([j, v]) => svg.append(evS("line", { x1: x(v), x2: x(v), y1: y - 11, y2: y - 5, stroke: EV_JUDGE_COLORS[j] || "#888", "stroke-width": 2.5 },
      evS("title", {}, `${evJudge(j)}: ${v.toFixed(2)}`))));
    svg.append(evS("circle", { cx: x(r.mean), cy: y, r: 6, fill: c, class: "ev-model-dot" }, evS("title", {}, `${evModel(r.model)}: ${evF2(r.mean)} (${evF2(r.lo)} to ${evF2(r.hi)}), ${r.n} pieces`)));
    svg.append(evS("text", { x: W - right + 8, y: y + 4, class: "ev-row-value" }, evF2(r.mean)));
    svg.append(evS("text", { x: W - right + 8, y: y + 17, class: "ev-row-note" }, `n = ${r.n}`));
  });

  const diffs = t.diffs;
  const span = Math.ceil(Math.max(0.2, ...diffs.flatMap((d) => [Math.abs(d.lo), Math.abs(d.hi)])) * 10) / 10; // a round edge
  const W2 = 760, rowH2 = 26, left2 = 230, top2 = 16;
  const svg2 = evSvg(W2, top2 + diffs.length * rowH2 + 28);
  const x2 = (v) => left2 + (v + span) / (2 * span) * (W2 - left2 - 60);
  svg2.append(evS("line", { x1: x2(0), x2: x2(0), y1: 4, y2: top2 + diffs.length * rowH2, class: "ev-zero" }));
  diffs.forEach((dd, i) => {
    const y = top2 + i * rowH2 + rowH2 / 2;
    const clear = dd.lo > 0 || dd.hi < 0;
    svg2.append(evS("text", { x: left2 - 10, y: y + 4, class: "ev-row-label", "text-anchor": "end" }, `${evModel(dd.a)} − ${evModel(dd.b)}`));
    svg2.append(evS("line", { x1: x2(dd.lo), x2: x2(dd.hi), y1: y, y2: y, class: `ev-ci${clear ? " clear" : ""}` }));
    svg2.append(evS("circle", { cx: x2(dd.diff), cy: y, r: 4.5, class: `ev-pt diff${clear ? " clear" : ""}` }, evS("title", {}, `${evF2(dd.diff)} (${evF2(dd.lo)} to ${evF2(dd.hi)})`)));
    svg2.append(evS("text", { x: W2 - 52, y: y + 4, class: "ev-row-note" }, `${dd.diff > 0 ? "+" : ""}${evF2(dd.diff)}`));
  });
  [-span, -span / 2, 0, span / 2, span].forEach((v) => svg2.append(evS("text", { x: x2(v), y: top2 + diffs.length * rowH2 + 18, class: "ev-tick", "text-anchor": "middle" }, (v > 0 ? "+" : "") + v.toFixed(2))));

  const self = t.self_preference.map((s) => `${evJudge(s.judge)} rated its own model's pieces ${evF2(Math.abs(s.preference))} points ${s.preference >= 0 ? "more" : "less"} generously, relative to the other judges, than it rated the rest`);
  return el("section", { class: "ev-section" },
    el("h2", { text: `The models · ${t.label}` }),
    evFigure("Mean overall score, with 95% intervals",
      "The dot is each model's mean overall score (every scale, lower-is-better ones turned around, averaged across the judges), the bar its 95% bootstrap interval from resampling its pieces 4,000 times. The small coloured ticks above are each judge's own mean for that model: where they fan out, the ranking depends on who's judging.",
      svg, evLegend([...rows.map((r) => [evModel(r.model), EV_MODEL_COLORS[r.model] || "#666"]), ...evData.judges.map((j) => [`${evJudge(j.id)} (tick)`, EV_JUDGE_COLORS[j.id] || "#888", "tick"])])),
    evFigure("Differences between models",
      "Each row is one model's mean minus another's, with a 95% bootstrap interval. Solid rows exclude zero: the difference is unlikely to be noise from which passages were chosen. It says nothing about noise shared by the judges themselves; the agreement section covers that."
      + (self.length ? ` Self-preference: ${self.join("; ")}.` : ""),
      svg2));
}

// 7 ---------------------------------------------------------------- redundancy
function evRedundancy() {
  const t = evTd();
  const { scales, matrix } = t.corr;
  const n = scales.length, cell = n > 12 ? 26 : 40, left = 150, top = 150;
  const W = left + n * cell + 10, H = top + n * cell + 10;
  const svg = evSvg(W, H, "ev-heat");
  const color = (r) => {
    if (r == null) return "var(--line)";
    const v = Math.max(-1, Math.min(1, r));
    const pos = [178, 24, 43], neg = [33, 102, 172], mid = [247, 247, 247];
    const to = v >= 0 ? pos : neg, a = Math.abs(v);
    return `rgb(${mid.map((m, i) => Math.round(m + (to[i] - m) * a)).join(",")})`;
  };
  scales.forEach((s, i) => {
    svg.append(evS("text", { x: left - 6, y: top + i * cell + cell / 2 + 4, class: "ev-heat-label", "text-anchor": "end" }, evPretty(s)));
    svg.append(evS("text", { x: 0, y: 0, class: "ev-heat-label", transform: `translate(${left + i * cell + cell / 2 + 4},${top - 6}) rotate(-60)` }, evPretty(s)));
    scales.forEach((s2, j) => {
      const r = matrix[i][j];
      svg.append(evS("rect", { x: left + j * cell, y: top + i * cell, width: cell - 1, height: cell - 1, fill: color(r) }, evS("title", {}, `${evPretty(s)} × ${evPretty(s2)}: r = ${evF2(r)}`)));
      if (cell >= 26 && i !== j && r != null) svg.append(evS("text", { x: left + j * cell + cell / 2, y: top + i * cell + cell / 2 + 3, class: `ev-heat-value${Math.abs(r) > 0.6 ? " light" : ""}`, "text-anchor": "middle" }, (Math.abs(r) < 0.05 ? ".0" : r.toFixed(1).replace("0.", "."))));
    });
  });
  return el("section", { class: "ev-section" },
    el("h2", { text: `Are the scales saying different things? · ${t.label}` }),
    evFigure("How the scales move together",
      `Pearson correlation between every pair of scales, on each piece's average across judges (lower-is-better scales turned around, so red always means "good together"). One factor explains ${evPct(t.first_factor)} of all the scales' variation${t.fruit_mean_r != null ? `, and the nine fruits of the Spirit correlate ${evF2(t.fruit_mean_r)} with each other on average` : ""}. A block of deep red means those scales are one measurement under several names; a scale that's pale everywhere is either measuring something distinct or measuring nothing (check its agreement above).`,
      el("div", { class: "ev-scroll" }, svg),
      evLegend([["−1", "rgb(33,102,172)", "square"], ["0", "rgb(247,247,247)", "square"], ["+1", "rgb(178,24,43)", "square"]])));
}

// 8 ---------------------------------------------------------------- power
function evPower() {
  const rows = evData.tracks.filter((t) => evData.tracks_data[t.id]).map((t) => {
    const td = evData.tracks_data[t.id];
    const now = Math.min(...td.models.map((m) => m.n));
    return el("tr", {}, el("th", { text: t.label }), el("td", { text: evF2(td.within_model_sd) }), el("td", { text: String(now) }),
      ...["0.1", "0.2", "0.5"].map((k) => {
        const need = td.power[k];
        return el("td", { class: need != null && need <= now ? "ok" : "", text: need == null ? "–" : String(need) });
      }));
  });
  return el("section", { class: "ev-section" },
    el("h2", { text: "How many passages would a fair comparison need?" }),
    evFigure("Passages per model to see a real difference",
      "From the spread of overall scores among one model's own pieces: how many pieces each model would need for a difference of 0.1, 0.2 or 0.5 points (on the 1–7 scale) to be found 80% of the time at p < .05. Green: the current run already has enough. This treats the judges' average as the truth; if the judges don't agree (above), more passages won't fix that, more or better judges will.",
      el("div", { class: "ev-table-wrap" }, el("table", { class: "ev-table" },
        el("thead", {}, el("tr", {}, ["Track", "Spread within a model", "Pieces per model now", "for 0.1", "for 0.2", "for 0.5"].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows)))));
}

// 9 ---------------------------------------------------------------- every piece, and what each judge said
function evJudgments() {
  const scales = evScales();
  const rows = evData.judgments.filter((r) => r.track === evTrack);
  const overall = (r) => scales.reduce((a, s) => a + evGood(s, r.scores[s] ?? 4), 0) / scales.length;
  const byPiece = {};
  for (const r of rows) (byPiece[`${r.model}|${r.track}|${r.item}`] ||= []).push(r);
  const keys = Object.keys(byPiece).sort((a, b) => a.split("|")[2].localeCompare(b.split("|")[2]) || a.localeCompare(b));
  const agree = evData.text_agreement || {};
  const overlaps = (f) => keys.map((k) => agree[k]?.[f]?.overlap).filter((v) => v != null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const marked = (text, shared) => {  // words two or more judges used, marked
    if (!shared?.length) return [text];
    const re = new RegExp(`\\b(${shared.map((w) => w.replace(/[^a-z]/g, "")).join("|")})\\w*`, "gi");
    const out = [];
    let pos = 0;
    for (const m of text.matchAll(re)) {
      out.push(text.slice(pos, m.index), el("mark", { class: "ev-shared", text: m[0] }));
      pos = m.index + m[0].length;
    }
    out.push(text.slice(pos));
    return out;
  };
  const cards = keys.map((k) => {
    const [model, , item] = k.split("|");
    const judged = byPiece[k].sort((a, b) => a.judge.localeCompare(b.judge));
    const ta = agree[k] || {};
    const piece = evData.pieces?.[k];
    const raw = piece ? el("details", { class: "ev-raw" }, el("summary", { text: evTrack === "companion" ? "Read the whole conversation" : "What it was given, and what it wrote" }),
      el("div", { class: "ev-raw-grid" },
        el("div", {}, el("h5", { text: `Given${piece.given_chars > piece.given.length ? ` (first ${piece.given.length.toLocaleString()} of ${piece.given_chars.toLocaleString()} characters)` : ""}` }),
          el("pre", { class: "ev-raw-text", text: piece.given })),
        el("div", {}, el("h5", { text: piece.turns ? "The conversation" : `Wrote (${piece.words || "?"} words, ${Math.round(piece.seconds || 0)} s)` }),
          piece.turns ? el("ol", { class: "talk-transcript chat ev-conv" }, piece.turns.map((t) => el("li", { class: t.who === "user" ? "you" : "companion", text: t.text })))
            : el("div", { class: "ev-raw-text prose", text: piece.wrote }),
          piece.sources?.length ? el("p", { class: "hint", text: `Sources it listed: ${piece.sources.length}` }) : ""))) : "";
    return el("article", { class: "card ev-piece" },
      el("header", {},
        el("strong", { text: item }), el("span", { class: "ev-piece-model" }, el("i", { class: "ev-key dot", style: `--c:${EV_MODEL_COLORS[model] || "#666"}` }), evModel(model)),
        el("span", { class: "meta", text: `words shared between judges: strengths ${evPct(ta.strength?.overlap)}, weaknesses ${evPct(ta.weakness?.overlap)}` })),
      el("div", { class: "ev-verdicts", style: `--cols:${judged.length}` }, judged.map((r) => el("div", { class: "ev-verdict" },
        el("div", { class: "ev-verdict-head" }, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[r.judge] || "#888"}` }), evJudge(r.judge),
          el("span", { class: "ev-verdict-score", text: overall(r).toFixed(2) })),
        el("p", { class: "ev-plus" }, el("b", { text: "+ " }), ...marked(r.strength || "", ta.strength?.shared)),
        el("p", { class: "ev-minus" }, el("b", { text: "− " }), ...marked(r.weakness || "", ta.weakness?.shared))))),
      raw);
  });
  return el("section", { class: "ev-section" },
    el("h2", { text: `Every piece, and what each judge said · ${evTd().label}` }),
    el("p", { text: `Every judge writes one strength and one weakness for each piece. On this track, the judges' strengths share ${evPct(mean(overlaps("strength")))} of their content words on average, and their weaknesses ${evPct(mean(overlaps("weakness")))} (mean pairwise Jaccard overlap). Words two or more judges used are highlighted. Word overlap is a rough measure: two judges can make the same point in different words, so read them side by side. Open a piece to see exactly what the model was given and what it wrote.` }),
    el("details", { class: "card" }, el("summary", { text: `Open the ${keys.length} ${evTrack === "companion" ? "conversations" : "pieces"}` }), ...cards));
}
