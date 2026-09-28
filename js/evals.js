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
let evFit = null; // evals/fitness.json: measured fitness for this app, and cost
let evScl = null; // evals/scales.json: the scale study, other ways of asking the judges
let evMeasure = "overall"; // what the model comparison shows: the overall score or one scale

async function openEvals() {
  show("evals");
  document.title = "Evals · Ignatius at Home";
  if (!debugMode()) {
    $("ev-body").replaceChildren(el("p", { class: "lede", text: "The eval analysis is part of debug mode: turn it on in Settings." }));
    return;
  }
  try {
    evData = evData || await (await fetch(`evals/${EV_RUN}.json?v=${RUNNING_VERSION}`, { cache: "no-store" })).json();
    evScl = evScl || await fetch(`evals/scales.json?v=${RUNNING_VERSION}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    evFit = evFit || await fetch(`evals/fitness.json?v=${RUNNING_VERSION}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
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

// Hovering (or focusing, or tapping) a scale's name shows exactly what the judge was
// asked and the scale it answered on, from the judge prompt itself.
function evScaleTip(node, scale) {
  if (!evData.scale_text?.[evTrack]?.[scale]) return node;
  node.setAttribute("data-scale", scale);
  node.setAttribute("tabindex", "0");
  node.classList.add("ev-has-tip");
  return node;
}

function evWireTips() {
  const tip = $("ev-tip");
  const showFor = (target) => {
    const anchor = target?.closest?.("[data-scale], [data-item]");
    if (!anchor) return (tip.hidden = true);
    const scale = anchor.getAttribute("data-scale");
    if (scale) {
      const info = evData.scale_text?.[evTrack]?.[scale];
      if (!info) return (tip.hidden = true);
      tip.replaceChildren(el("strong", { text: evPretty(scale) }), evLower(scale) ? el("span", { class: "ev-tip-chip", text: "↓ lower is better" }) : "",
        el("p", { text: `The judge was asked: “${info.question}”` }), el("p", { class: "meta", text: `Scale: ${info.scale}` }));
    } else {
      const it = evData.items?.[anchor.getAttribute("data-item")];
      if (!it) return (tip.hidden = true);
      tip.replaceChildren(...(it.kind === "passage"
        ? [el("strong", { text: `${it.ref} · ${it.title}` }), el("p", { class: "meta", text: `Day ${it.day} of “${it.retreat}”` }),
          el("p", { text: `Grace: ${it.grace}` }), el("p", { text: `Focus: ${it.focus}` })]
        : [el("strong", { text: `A conversation: “${anchor.getAttribute("data-item")}”` }), el("p", { class: "meta", text: `${it.when} ${it.last}` }),
          el("p", { text: `On ${evData.items[it.passage]?.ref || it.passage}. The person's scripted lines:` }),
          el("ol", { class: "ev-tip-lines" }, it.lines.map((l) => el("li", { text: l })))]));
    }
    tip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    tip.style.width = `${w}px`;
    tip.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
    const below = r.bottom + 10 + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${(below ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + window.scrollY}px`;
  };
  const view = $("view-evals");
  view.onmouseover = (e) => showFor(e.target);
  view.onfocusin = (e) => showFor(e.target);
  view.onclick = (e) => showFor(e.target);
  view.onmouseout = (e) => { if (!e.relatedTarget?.closest?.("[data-scale], [data-item]")) tip.hidden = true; };
}

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
    evModels(), evFitness(), evScaleStudy(), evRedundancy(), evPower(), evJudgments());
  evWireTips();
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
    el("p", { text: "Whether these judges' scores can be trusted, track by track. ICC(2,k) is how reliable the average of all the judges is: the number the reports use. ICC(2,1) is how reliable one judge is alone. Spearman-Brown turns that into how many judges it would take for the average to reach 0.8." }),
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
  const svg = evSvg(W, top + judges.length * rowH + 40);
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
  svg.append(evS("text", { x: left, y: top + judges.length * rowH + 30, class: "ev-note strong" }, "← more of the low, critical scores"));
  svg.append(evS("text", { x: W - right, y: top + judges.length * rowH + 30, class: "ev-note strong end" }, "more of the top scores →"));

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
  grid.append(el("span", { class: "ev-grid-key" }, "Each bar counts scores of 1 to 7; │ is the judge's mean. A single tall bar means no spread to measure."), ...judges.map((j) => el("span", { class: "ev-col-head" }, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[j]}` }), evJudge(j))));
  for (const s of scales) {
    const info = byScale[s];
    grid.append(evScaleTip(el("span", { class: "ev-row-head" }, evPretty(s), evLower(s) ? el("small", { text: " ↓ lower is better" }) : ""), s));
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
  const rows = [{ scale: "overall score", ...t.overall, bold: true }, ...t.scales.map((s) => ({ ...s, key: s.scale, scale: evPretty(s.scale) }))];
  const W = 820, rowH = 22, left = 180, right = 150, top = 150, lo = -0.6, hi = 1, foot = 150;
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
    svg.append(evScaleTip(evS("text", { x: left - 10, y: y + 4, class: `ev-row-label${r.bold ? " bold" : ""}`, "text-anchor": "end" }, r.scale), r.key));
    const pts = [[r.alpha, "raw", "Krippendorff's alpha"], [r.alpha_std, "std", "alpha with each judge's leniency removed"], [r.icck, "icc", "ICC(2,k), the average of the judges"],
      [r.kappa, "kappa", "Cohen's quadratic-weighted kappa, averaged over pairs of judges"], [r.ac2, "ac2", "Gwet's AC2 (quadratic weights), robust to a ceiling"]];
    const xs = pts.slice(0, 3).filter((p) => p[0] != null).map((p) => x(p[0]));  // the line joins alpha, alpha adjusted and ICC
    if (xs.length > 1) svg.append(evS("line", { x1: Math.min(...xs), x2: Math.max(...xs), y1: y, y2: y, class: "ev-span" }));
    for (const [v, kind, name] of pts) {
      if (v == null) continue;
      const shapes = { icc: `M${x(v)} ${y - 5}l5 5l-5 5l-5 -5z`, kappa: `M${x(v) - 4} ${y - 4}h8v8h-8z`, ac2: `M${x(v)} ${y - 5.5}l5.5 9.5h-11z` };
      const mark = shapes[kind] ? evS("path", { d: shapes[kind], class: `ev-pt ${kind}` }) : evS("circle", { cx: x(v), cy: y, r: 4.5, class: `ev-pt ${kind}` });
      mark.append(evS("title", {}, `${r.scale}: ${name} ${v.toFixed(2)}`));
      svg.append(mark);
    }
    if (r.exact != null) svg.append(evS("text", { x: W - right + 12, y: y + 4, class: "ev-row-note" }, `${evPct(r.exact)} · ${evPct(r.within1)}`));
    if (i <= 1) {  // callouts naming each marker (the kappa and AC2 ones on the first scale), staggered
      const called = pts.filter((p, n) => p[0] != null && (i === 0 ? n < 3 : n >= 3)).sort((a, b) => a[0] - b[0]);
      const words = { raw: "alpha, raw scores", std: "alpha, leniency removed", icc: "ICC(2,k): the judges' average",
        kappa: "Cohen's weighted κ", ac2: "Gwet's AC2" };
      called.forEach(([v, kind], k) => {
        const ly = top - 40 - (i === 0 ? k : 3 + k) * 16;
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
  svg.append(evS("path", { d: `M${ex1 + 20} ${fy + 78}h8v8h-8z`, class: "ev-pt kappa" }));
  svg.append(evS("path", { d: `M${ex1 + 70} ${fy + 76.5}l5.5 9.5h-11z`, class: "ev-pt ac2" }));
  note(ex1 + 104, fy + 86, "Square near 0 but triangle near 1: the judges give the same scores, but the scores");
  note(ex1 + 104, fy + 102, "don't vary enough to tell pieces apart (the ceiling).");
  void ex2;
  return el("section", { class: "ev-section" },
    el("h2", { text: `Do the judges agree? · ${t.label}` }),
    evFigure("Agreement, scale by scale",
      "Krippendorff's alpha measures agreement beyond chance for any number of judges; the filled circle recomputes it after putting every judge on its own scale. ICC(2,k) is the reliability of the judges' average, the number the reports use. The square is Cohen's quadratic-weighted kappa, averaged over every pair of judges. The triangle is Gwet's AC2, which uses the same weights but a chance correction that doesn't collapse when nearly every score is the same: kappa and alpha fall toward zero under a ceiling (the \"kappa paradox\") even when the judges agree, and AC2 shows whether they do.",
      svg));
}

// 5 ---------------------------------------------------------------- discrimination
function evDiscrimination() {
  const rows = [...evTd().scales].sort((a, b) => (b.eta2 ?? 0) - (a.eta2 ?? 0));
  const W = 820, rowH = 22, left = 180, right = 150, top = 96;
  const svg = evSvg(W, top + rows.length * rowH + 118);
  const x = (v) => left + v * (W - left - right);
  svg.append(evS("defs", {}, evS("marker", { id: "ev-arrow2", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
    evS("path", { d: "M0 0 L8 4 L0 8 z", class: "ev-arrowhead" }))));
  const note = (tx, ty, text, cls = "ev-note") => svg.append(evS("text", { x: tx, y: ty, class: cls }, text));
  const arrow = (x1, y1, x2, y2) => svg.append(evS("path", { d: `M${x1} ${y1} L${x2} ${y2}`, class: "ev-leader", "marker-end": "url(#ev-arrow2)" }));
  note(left, 18, "share of the scale's variation that comes from which model wrote the piece (η²) →");
  note(W - right + 10, top - 22, "p: chance a bar this", "ev-note");
  note(W - right + 10, top - 8, "long comes by luck", "ev-note");
  if (rows[0]?.eta2_null != null) {  // name the parts on the first bar
    const r0 = rows[0], y0 = top + 11;
    arrow(x(r0.eta2_null) - 40, top - 44, x(r0.eta2_null) - 2, y0 - 8);
    note(x(r0.eta2_null) - 44, top - 50, "red tick: what luck alone gives", "ev-callout icc end");
    arrow(x(r0.eta2) + 30, top - 30, x(r0.eta2) + 2, y0 - 6);
    note(x(r0.eta2) + 34, top - 30, "bar end: this scale's signal", "ev-callout std");
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const sig = r.eta2_p != null && r.eta2_p < 0.05;
    svg.append(evScaleTip(evS("text", { x: left - 10, y: y + 14, class: "ev-row-label", "text-anchor": "end" }, evPretty(r.scale)), r.scale));
    svg.append(evS("rect", { x: left, y: y + 4, width: Math.max(0, x(r.eta2 || 0) - left), height: rowH - 8, class: `ev-bar${sig ? " sig" : ""}` },
      evS("title", {}, `η² ${evF2(r.eta2)}, by chance ${evF2(r.eta2_null)}, p ${r.eta2_p == null ? "–" : r.eta2_p.toFixed(3)}`)));
    if (r.eta2_null != null) svg.append(evS("line", { x1: x(r.eta2_null), x2: x(r.eta2_null), y1: y + 2, y2: y + rowH - 2, class: "ev-null" }));
    svg.append(evS("text", { x: W - right + 8, y: y + 14, class: "ev-row-note" }, r.eta2_p == null ? "" : `p ${r.eta2_p < 0.001 ? "< .001" : r.eta2_p.toFixed(3)}${sig ? " *" : ""}`));
  });
  const bottom = top + rows.length * rowH;
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => svg.append(evS("text", { x: x(v), y: bottom + 16, class: "ev-tick", "text-anchor": "middle" }, String(v))));
  note(x(0), bottom + 32, "0 = says nothing about which model wrote it", "ev-note strong");
  note(x(1), bottom + 32, "1 = entirely which model wrote it", "ev-note strong end");
  const fy = bottom + 62;
  note(left - 10, fy, "How to read a bar", "ev-note strong endish");
  svg.append(evS("rect", { x: left, y: fy - 10, width: 70, height: 12, class: "ev-bar sig" }), evS("line", { x1: left + 30, x2: left + 30, y1: fy - 12, y2: fy + 4, class: "ev-null" }));
  note(left + 84, fy, "Dark, well past its red tick (*): the scale tells the models apart, more than luck would (p < .05). Good.");
  svg.append(evS("rect", { x: left, y: fy + 12, width: 34, height: 12, class: "ev-bar" }), evS("line", { x1: left + 30, x2: left + 30, y1: fy + 10, y2: fy + 26, class: "ev-null" }));
  note(left + 84, fy + 22, "Pale, ending near its red tick: no more model signal than chance. The scale doesn't separate the models (yet).");
  return el("section", { class: "ev-section" },
    el("h2", { text: `Can each scale tell the models apart? · ${evTd().label}` }),
    evFigure("Signal against chance",
      "Bars: η², the share of a scale's variation across pieces that is explained by which model wrote them (on each piece's average across judges). The tick on each bar is what η² comes to by chance with this many pieces and models, found by shuffling which model wrote which piece 2,000 times; p is the share of shuffles that did as well. Dark bars (*) beat chance at p < .05. With so few pieces, even a real difference can miss this line, and one in twenty scales will cross it by luck.",
      svg));
}

// 6 ---------------------------------------------------------------- models
function evModels() {
  const t = evTd();
  if (evMeasure !== "overall" && !evScales().includes(evMeasure)) evMeasure = "overall";
  const stats = evModelStats(evMeasure);
  const rows = stats.models;
  const all = rows.flatMap((r) => [r.lo, r.hi, ...Object.values(r.by_judge)]).filter((v) => v != null);
  const lo = Math.max(1, Math.floor((Math.min(...all) - 0.15) * 4) / 4), hi = Math.min(7, Math.ceil((Math.max(...all) + 0.15) * 4) / 4);
  const W = 760, rowH = 40, left = 170, right = 90, top = 34;
  const svg = evSvg(W, top + rows.length * rowH + 48);
  svg.append(evS("text", { x: W - right, y: top + rows.length * rowH + 40, class: "ev-note strong end" }, "better →"));
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
    if (i === 0) {  // name the parts on the first row
      svg.append(evS("text", { x: x(r.hi) + 8, y: y + 4, class: "ev-callout std" }, "← dot: the mean · bar: 95% interval"));
      const jv = Math.min(...Object.values(r.by_judge));
      if (Number.isFinite(jv)) svg.append(evS("text", { x: x(jv) - 4, y: y - 15, class: "ev-callout raw", "text-anchor": "end" }, "ticks: each judge's mean →"));
    }
    svg.append(evS("text", { x: W - right + 8, y: y + 4, class: "ev-row-value" }, evF2(r.mean)));
    svg.append(evS("text", { x: W - right + 8, y: y + 17, class: "ev-row-note" }, `n = ${r.n}`));
  });

  const diffs = stats.diffs;
  const span = Math.ceil(Math.max(0.2, ...diffs.flatMap((d) => [Math.abs(d.lo), Math.abs(d.hi)])) * 10) / 10; // a round edge
  const W2 = 760, rowH2 = 26, left2 = 230, top2 = 16;
  const svg2 = evSvg(W2, top2 + diffs.length * rowH2 + 60);
  const x2 = (v) => left2 + (v + span) / (2 * span) * (W2 - left2 - 60);
  svg2.append(evS("line", { x1: x2(0), x2: x2(0), y1: 4, y2: top2 + diffs.length * rowH2, class: "ev-zero" }));
  svg2.append(evS("text", { x: x2(0), y: top2 + diffs.length * rowH2 + 34, class: "ev-note strong mid" }, "0 = no difference"));
  svg2.append(evS("text", { x: x2(span * 0.55), y: top2 + diffs.length * rowH2 + 34, class: "ev-note mid" }, "first model better →"));
  svg2.append(evS("text", { x: x2(-span * 0.55), y: top2 + diffs.length * rowH2 + 34, class: "ev-note mid" }, "← second model better"));
  svg2.append(evS("text", { x: 8, y: top2 + diffs.length * rowH2 + 52, class: "ev-note" }, "Solid: the interval misses 0, a real difference between the models. Pale: it crosses 0, so it could be noise."));
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
    el("label", { class: "ev-measure" }, "Compare on ",
      el("select", { onchange: (e) => { evMeasure = e.target.value; const sec = e.target.closest(".ev-section"); sec.replaceWith(evModels()); evWireTips(); } },
        el("option", { value: "overall", text: "the overall score (every scale)", selected: evMeasure === "overall" }),
        ...evScales().map((sc) => el("option", { value: sc, text: `${evPretty(sc)}${evLower(sc) ? " (turned around: higher is better)" : ""}`, selected: evMeasure === sc })))),
    evFigure(evMeasure === "overall" ? "Mean overall score, with 95% intervals" : `Mean “${evPretty(evMeasure)}” score, with 95% intervals`,
      "The dot is each model's mean overall score (every scale, lower-is-better ones turned around, averaged across the judges), the bar its 95% bootstrap interval from resampling its pieces 4,000 times. The small coloured ticks above are each judge's own mean for that model: where they fan out, the ranking depends on who's judging.",
      svg, evLegend([...rows.map((r) => [evModel(r.model), EV_MODEL_COLORS[r.model] || "#666"]), ...evData.judges.map((j) => [`${evJudge(j.id)} (tick)`, EV_JUDGE_COLORS[j.id] || "#888", "tick"])])),
    evFigure("Differences between models",
      "Each row is one model's mean minus another's, with a 95% bootstrap interval. Solid rows exclude zero: the difference is unlikely to be noise from which passages were chosen. It says nothing about noise shared by the judges themselves; the agreement section covers that."
      + (self.length ? ` Self-preference: ${self.join("; ")}.` : ""),
      svg2));
}

// 6b --------------------------------------------------------------- fitness for this app, and cost
// Not judges' opinions: what the pieces themselves show (scripture quoted word for word,
// sources inside the research, instructions followed, written for the ear, companion
// behaviour, reliability, speed, cost), from evals/fitness.py. Across all tracks.
function evFitness() {
  const f = evFit;
  if (!f) return "";
  const ids = Object.keys(f.models);
  const dims = f.dimensions;
  const heat = (v) => `color-mix(in srgb, #2166ac ${Math.round((v ?? 0) * 70)}%, var(--page))`;
  const table = el("table", { class: "ev-table ev-fit" },
    el("thead", {}, el("tr", {}, el("th", { text: "Model" }), ...dims.map((d) => el("th", { title: d.how, class: "ev-has-tip-native", text: d.label })),
      el("th", { text: "Fitness (balanced)" }))),
    el("tbody", {}, ids.map((m) => {
      const mm = f.models[m];
      return el("tr", {}, el("th", {}, el("i", { class: "ev-key dot", style: `--c:${EV_MODEL_COLORS[m] || "#666"}` }), mm.label.replace(/ \(.*\)/, "")),
        ...dims.map((d) => {
          const v = mm.subscores[d.id];
          if (!v || v.value == null) return el("td", { class: "ev-fit-cell", text: "–" });
          const ci = v.lo != null ? ` (95% interval ${v.lo.toFixed(2)} to ${v.hi.toFixed(2)}, n = ${v.n})` : "";
          return el("td", { class: "ev-fit-cell", style: `background:${heat(v.value)}`, title: `${d.label}: ${v.value.toFixed(2)}${ci}. ${d.how}`, text: v.value.toFixed(2) });
        }),
        el("td", { class: "ev-fit-cell total", text: mm.fitness.balanced.toFixed(2) }));
    })));

  // cost against value, with the Pareto frontier
  const scatter = (title, yOf, frontier, yLabel) => {
    const W = 380, H = 260, L = 46, B = 36, T = 16, R = 16;
    const pts = ids.map((m) => ({ m, x: f.models[m].operations.usd_per_retreat || 0, ...yOf(f.models[m]) }));
    const xmax = Math.max(0.5, ...pts.map((p) => p.x)) * 1.15;
    const ys = pts.flatMap((p) => [p.lo ?? p.y, p.hi ?? p.y]);
    const ylo = Math.max(0, Math.floor((Math.min(...ys) - 0.03) * 20) / 20), yhi = Math.min(1, Math.ceil((Math.max(...ys) + 0.03) * 20) / 20);
    const x = (v) => L + (v / xmax) * (W - L - R), y = (v) => T + (1 - (v - ylo) / (yhi - ylo)) * (H - T - B);
    const svg = evSvg(W, H);
    for (let v = ylo; v <= yhi + 1e-9; v += 0.05) {
      svg.append(evS("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "ev-grid" }), evS("text", { x: L - 6, y: y(v) + 4, class: "ev-tick", "text-anchor": "end" }, v.toFixed(2)));
    }
    const step = xmax > 4 ? 1 : 0.5;
    for (let v = 0; v <= xmax; v += step) svg.append(evS("text", { x: x(v), y: H - B + 16, class: "ev-tick", "text-anchor": "middle" }, `$${v.toFixed(v % 1 ? 1 : 0)}`));
    svg.append(evS("text", { x: (L + W - R) / 2, y: H - 4, class: "ev-axis-label", "text-anchor": "middle" }, "cost per 7-day retreat (text), dollars"));
    svg.append(evS("text", { x: 12, y: (T + H - B) / 2, class: "ev-axis-label", "text-anchor": "middle", transform: `rotate(-90 12 ${(T + H - B) / 2})` }, yLabel));
    svg.append(evS("text", { x: L + 6, y: T + 12, class: "ev-note strong" }, "↖ better: cheaper and higher"));
    svg.append(evS("text", { x: W - R - 4, y: H - B - 6, class: "ev-note end" }, "worse: costly and lower ↘"));
    const front = pts.filter((p) => frontier.includes(p.m)).sort((a, b) => a.x - b.x);
    svg.append(evS("text", { x: L + 6, y: T + 26, class: "ev-note" }, front.length > 1 ? "ringed dots, joined: the frontier" : "ringed dot: nothing beats it on both"));
    if (front.length > 1) svg.append(evS("path", { d: front.map((p, k) => `${k ? "L" : "M"}${x(p.x)} ${y(p.y)}`).join(" "), class: "ev-frontier" }));
    const placed = [];  // labels nudged apart so they never sit on each other
    for (const p of pts) {
      const c = EV_MODEL_COLORS[p.m] || "#666";
      let ly = y(p.y) - 8;
      while (placed.some(([px, py]) => Math.abs(px - x(p.x)) < 90 && Math.abs(py - ly) < 13)) ly += 14;
      placed.push([x(p.x), ly]);
      if (p.lo != null) svg.append(evS("line", { x1: x(p.x), x2: x(p.x), y1: y(p.lo), y2: y(p.hi), stroke: c, "stroke-width": 2, opacity: 0.6 }));
      svg.append(evS("circle", { cx: x(p.x), cy: y(p.y), r: frontier.includes(p.m) ? 7 : 5.5, fill: c, class: `ev-model-dot${frontier.includes(p.m) ? " front" : ""}` },
        evS("title", {}, `${f.models[p.m].label}: $${p.x.toFixed(2)} a retreat, ${p.y.toFixed(3)}${frontier.includes(p.m) ? " (on the frontier)" : ""}`)));
      svg.append(evS("text", { x: x(p.x) + 9, y: ly, class: "ev-row-note" }, f.models[p.m].label.replace(/ \(.*\)|Claude |OpenAI /g, "")));
    }
    return el("div", { class: "ev-fit-plot" }, el("h4", { text: title }), svg);
  };
  const q = (mm) => ({ y: mm.subscores.quality.value, lo: mm.subscores.quality.lo, hi: mm.subscores.quality.hi });
  const fit = (mm) => ({ y: mm.fitness.balanced });

  // fitness under each weighting
  const profiles = Object.keys(f.weights);
  const W = 760, rowH = 34, left = 170, right = 150, top = 20;
  const allF = profiles.flatMap((pr) => ids.map((m) => f.models[m].fitness[pr]));
  const lo = Math.floor((Math.min(...allF) - 0.02) * 50) / 50, hi = Math.ceil((Math.max(...allF) + 0.02) * 50) / 50;
  const sx = (v) => left + (v - lo) / (hi - lo) * (W - left - right);
  const dot = evSvg(W, top + profiles.length * rowH + 44);
  dot.append(evS("text", { x: W - right, y: top + profiles.length * rowH + 36, class: "ev-note strong end" }, "higher fitness is better →"));
  dot.append(evS("text", { x: left, y: top + profiles.length * rowH + 36, class: "ev-note" }, "grey bar: spread between best and worst model"));
  for (let v = lo; v <= hi + 1e-9; v += 0.02) dot.append(evS("line", { x1: sx(v), x2: sx(v), y1: top - 4, y2: top + profiles.length * rowH, class: "ev-grid" }),
    evS("text", { x: sx(v), y: top + profiles.length * rowH + 16, class: "ev-tick", "text-anchor": "middle" }, v.toFixed(2)));
  profiles.forEach((pr, k) => {
    const yy = top + k * rowH + rowH / 2;
    dot.append(evS("text", { x: left - 10, y: yy + 4, class: "ev-row-label", "text-anchor": "end" }, pr.replace(/_/g, " ")));
    const vals = ids.map((m) => [m, f.models[m].fitness[pr]]);
    dot.append(evS("line", { x1: sx(Math.min(...vals.map((v) => v[1]))), x2: sx(Math.max(...vals.map((v) => v[1]))), y1: yy, y2: yy, class: "ev-span" }));
    for (const [m, v] of vals) dot.append(evS("circle", { cx: sx(v), cy: yy, r: 6, fill: EV_MODEL_COLORS[m] || "#666", class: "ev-model-dot" }, evS("title", {}, `${f.models[m].label}: ${v.toFixed(3)}`)));
    const win = f.sensitivity.winner_by_weighting[pr];
    dot.append(evS("text", { x: W - right + 10, y: yy + 4, class: "ev-row-note" }, `winner: ${f.models[win]?.label.replace(/ \(.*\)|Claude |OpenAI /g, "") || win}`));
  });
  const shares = el("div", { class: "ev-share" }, ids.map((m) => {
    const v = f.sensitivity.win_share[m] || 0;
    return v ? el("span", { style: `flex:${v};--c:${EV_MODEL_COLORS[m] || "#666"}`, title: `${f.models[m].label} wins ${evPct(v)} of ${f.sensitivity.draws.toLocaleString()} random weightings` },
      v > 0.06 ? `${f.models[m].label.replace(/ \(.*\)|Claude |OpenAI /g, "")} ${evPct(v)}` : "") : "";
  }));
  const wtable = el("table", { class: "ev-table" },
    el("thead", {}, el("tr", {}, el("th", { text: "Weighting" }), ...dims.map((d) => el("th", { text: d.label })))),
    el("tbody", {}, profiles.map((pr) => el("tr", {}, el("th", { text: pr.replace(/_/g, " ") }), ...dims.map((d) => el("td", { text: evPct(f.weights[pr][d.id] || 0) }))))));

  // what the checks found, in plain numbers
  const row = (label, fn) => el("tr", {}, el("th", { text: label }), ...ids.map((m) => el("td", { text: fn(f.models[m]) })));
  const facts = el("table", { class: "ev-table" },
    el("thead", {}, el("tr", {}, el("th", { text: "" }), ...ids.map((m) => el("th", {}, el("i", { class: "ev-key dot", style: `--c:${EV_MODEL_COLORS[m] || "#666"}` }), f.models[m].label.replace(/ \(.*\)/, ""))))),
    el("tbody", {},
      row("Scripture quoted word for word", (mm) => `${mm.scripture.verbatim} of ${mm.scripture.from_passage} (${evPct(mm.scripture.verbatim_share)})`),
      row("Sources cited that weren't in its research", (mm) => `${mm.grounding.outside} of ${mm.grounding.cited}`),
      row("Checkable claims supported by the research", (mm) => mm.grounding.claims ? `${mm.grounding.supported} of ${mm.grounding.claims}` : "–"),
      row("Length against the target", (mm) => `${Math.round(mm.instructions.mean_length_ratio * 100)}% (within ±15%: ${evPct(mm.instructions.within_15pct)})`),
      row("The day's grace named", (mm) => evPct(mm.instructions.grace_share)),
      row("Written for the ear (Flesch reading ease)", (mm) => mm.ear.flesch?.toFixed(0) ?? "–"),
      row("Companion: one question at a time", (mm) => mm.companion?.conversations ? evPct(mm.companion.one_question_share) : "–"),
      row("Companion: named 988 when at risk", (mm) => mm.companion?.conversations ? (mm.companion.names_help_when_at_risk ? "yes" : "no") : "–"),
      row("Median seconds a piece", (mm) => `${Math.round(mm.operations.median_seconds)}${mm.operations.local ? " (this Mac)" : ""}`),
      row("Cost: reflection · deep dive", (mm) => `$${(mm.operations.usd_per_heart || 0).toFixed(3)} · $${(mm.operations.usd_per_deep || 0).toFixed(3)}`),
      row("Cost of a 7-day retreat's text", (mm) => `$${(mm.operations.usd_per_retreat || 0).toFixed(2)}`)));

  return el("section", { class: "ev-section" },
    el("h2", { text: "Which model for this app, at what cost? · all tracks" }),
    el("p", { text: "Judges' opinions are one measure. These are checked directly in what each model wrote: scripture quoted word for word, sources that come from the research it was given, the app's instructions followed, writing for the ear, the companion's behaviour, reliability, speed and cost. Each is scored 0 to 1. Hover a cell for its interval and how it's measured." }),
    evFigure("Sub-scores and fitness", "Darker blue is better. Fitness is the weighted sum under the balanced weighting (weights below). Judged quality comes from the cheap judges; the rest from the pieces themselves.",
      el("div", { class: "ev-table-wrap" }, table)),
    evFigure("Cost against value", "Each dot is a model: how much a 7-day retreat's text costs with it (free and local models at $0), against its judged quality (with its 95% interval) or its fitness. The line joins the Pareto frontier: models no other model beats on both cost and value. Larger dots are on it.",
      el("div", { class: "ev-fit-plots" }, scatter("Judged quality", q, f.pareto.cost_vs_quality, "judged quality, 0 to 1"),
        scatter("Fitness (balanced)", fit, f.pareto.cost_vs_fitness, "fitness, 0 to 1"))),
    evFigure("Does the winner depend on what you care about?",
      `Each row weights the measures differently (table below); the dots are each model's fitness under that weighting. The bar shows how often each model comes out on top across ${f.sensitivity.draws.toLocaleString()} random weightings: a model that wins under most of them is a safe choice whatever your priorities.`,
      dot, shares, el("details", {}, el("summary", { text: "The weightings" }), el("div", { class: "ev-table-wrap" }, wtable))),
    evFigure("What the checks found", `Assumptions: ${f.assumptions.note || ""}`, el("div", { class: "ev-table-wrap" }, facts)));
}

// ---------------------------------------------------------------- the scale study
// The same pieces, the same cheap judges, asked seven other ways. Each column says which
// direction is good; cells are shaded from poor (pale red) to good (blue) on fixed cut-offs.
function evScaleStudy() {
  const d = evScl;
  if (!d) return "";
  const V = d.variants, order = d.ranking.order;
  const margin = (v) => {
    const xs = Object.values(v.discrimination).filter((x) => x && x.eta2 != null).map((x) => x.eta2 - x.null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const shade = (good) => (good == null ? "" : good === 2 ? "ev-good" : good === 1 ? "ev-fair" : "ev-poor");
  const cols = [
    { h: "Top-end pile-up", tip: "Share of scores in the top two points (or the same share of the range). Lower is better: 80% means the scale can't tell good from ordinary.",
      v: (v) => v.shape.ceiling, f: evPct, g: (x) => (x <= 0.35 ? 2 : x <= 0.6 ? 1 : 0) },
    { h: "Judges agree (α)", tip: "Krippendorff's alpha within each track. 0.67+ usable, 0.8+ reliable; 0 is chance; below 0 the judges systematically disagree.",
      v: (v) => v.reliability.alpha, f: evF2, g: (x) => (x >= 0.67 ? 2 : x >= 0.3 ? 1 : 0) },
    { h: "Judges' average (ICC(2,k))", tip: "How reliable the three judges' average is. 0.75+ good, 0.5–0.75 moderate, below 0.5 poor.",
      v: (v) => v.reliability.icck, f: evF2, g: (x) => (x >= 0.75 ? 2 : x >= 0.5 ? 1 : 0) },
    { h: "Same answer twice (ρ)", tip: "The same judge asked the same thing twice: rank correlation. 0.9+ very stable.",
      v: (v) => v.test_retest.spearman, f: evF2, g: (x) => (x >= 0.9 ? 2 : x >= 0.7 ? 1 : 0) },
    { h: "Separates the models (η² over chance)", tip: "How much of the score depends on which model wrote the piece, beyond what luck gives, averaged over tracks. Higher is better; 0 means no signal.",
      v: margin, f: evF2, g: (x) => (x >= 0.35 ? 2 : x >= 0.15 ? 1 : 0) },
  ];
  const hist = (v) => {
    const hs = v.shape.hist || [], W = 120, H = 34, max = Math.max(1, ...hs), bw = W / Math.max(1, hs.length);
    const svg = evSvg(W, H + 12, "ev-mini");
    hs.forEach((n, i) => svg.append(evS("rect", { x: i * bw + 1, y: H - (n / max) * H, width: bw - 2, height: (n / max) * H, class: "ev-mini-bar" })));
    svg.append(evS("text", { x: 0, y: H + 11, class: "ev-tick" }, "low"), evS("text", { x: W, y: H + 11, class: "ev-tick", "text-anchor": "end" }, "high"));
    return svg;
  };
  const table = el("table", { class: "ev-table ev-scales" },
    el("thead", {}, el("tr", {}, el("th", { text: "Way of asking" }), el("th", { text: "Scores given" }),
      ...cols.map((c) => el("th", { title: c.tip, class: "ev-has-tip-native", text: c.h })))),
    el("tbody", {}, order.map((id, i) => {
      const v = V[id];
      return el("tr", { class: id === "v0" ? "ev-current" : "" },
        el("th", {}, el("strong", { text: `${i + 1}. ${v.label}` }), el("span", { class: "hint", text: v.change })),
        el("td", {}, hist(v)),
        ...cols.map((c) => {
          const x = c.v(v);
          return el("td", { class: `ev-fit-cell ${x == null ? "" : shade(c.g(x))}`, title: c.tip, text: x == null ? "–" : c.f(x) });
        }));
    })));
  return el("section", { class: "ev-section" },
    el("h2", { text: "Would another way of asking work better? · all tracks" }),
    el("p", { text: `The current rubric piles up at the top. The same pieces were scored again by the same cheap judges in seven other ways. Ordered by mean rank across nine criteria; the current rubric is highlighted. Hover a heading for what it measures and where the cut-offs are.` }),
    evFigure("Seven other ways of asking, against the current rubric",
      "Comparing pieces (pairwise, ranking) did far more than rewording a scale: pairwise is the only way the judges' agreement comes near a usable level (the three judges' average reaches 0.74), and it separates the models best. Ranking's even spread is built into the design, so its pile-up score is not earned. Rewording helped the pile-up (critique first most) but not agreement. Full report: docs/evals/SCALE_STUDY.md in the API repo.",
      el("div", { class: "ev-table-wrap" }, table),
      evLegend([["good", "#92c5de", "square"], ["fair", "#e8e0cf", "square"], ["poor", "#f4c3b5", "square"]])));
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
  [["How to read a square", "strong"], ["deep red: the two scales", ""], ["rise together (redundant)", ""], ["white: unrelated", ""],
    ["blue: one rises as the", ""], ["other falls", ""], ["the diagonal is each scale", ""], ["with itself, always 1", ""]]
    .forEach(([t, c], k) => svg.append(evS("text", { x: 4, y: 14 + k * 14, class: `ev-note ${c}` }, t)));
  scales.forEach((s, i) => {
    svg.append(evScaleTip(evS("text", { x: left - 6, y: top + i * cell + cell / 2 + 4, class: "ev-heat-label", "text-anchor": "end" }, evPretty(s)), s));
    svg.append(evScaleTip(evS("text", { x: 0, y: 0, class: "ev-heat-label", transform: `translate(${left + i * cell + cell / 2 + 4},${top - 6}) rotate(-60)` }, evPretty(s)), s));
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
      evLegend([["−1: opposite", "rgb(33,102,172)", "square"], ["0: unrelated (distinct scales: good)", "rgb(247,247,247)", "square"], ["+0.7 or more: probably the same thing twice", "rgb(190,70,80)", "square"], ["+1: identical", "rgb(178,24,43)", "square"]])));
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
        el("tbody", {}, rows))),
      evLegend([["green: the current run already has enough pieces", "var(--ok, #2e7d32)", "square"], ["plain number: how many pieces per model it would take", "var(--line)", "square"]]),
      el("p", { class: "hint", text: "Smaller spread within a model is better: the model is consistent, so fewer passages are needed. A difference of 0.1 on a 7-point scale is tiny; 0.5 is one a reader would notice." })));
}

// Every judge's score on every scale for one piece, coloured worst (red) to best (blue).
function evAllScores(judged) {
  const scales = evScales();
  const cell = (s, v) => {
    if (v == null) return el("td", { text: "–" });
    const g = evGood(s, v);
    return el("td", { class: "ev-score", style: `--c:${EV_LEVEL_COLORS[Math.round(g) - 1]}`, title: `${evPretty(s)}: ${v} (${evLower(s) ? "lower is better" : "higher is better"})`, text: String(v) });
  };
  return el("details", { class: "ev-raw" }, el("summary", { text: "All scores, every scale" }),
    el("div", { class: "ev-table-wrap" }, el("table", { class: "ev-table ev-scores" },
      el("thead", {}, el("tr", {}, el("th", { text: "Scale" }), judged.map((r) => el("th", {}, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[r.judge] || "#888"}` }), evJudge(r.judge))))),
      el("tbody", {}, scales.map((s) => el("tr", {},
        el("th", {}, evScaleTip(el("span", {}, evPretty(s), evLower(s) ? " ↓" : ""), s)), judged.map((r) => cell(s, r.scores[s]))))))));
}

// The model comparison for any measure: the overall score (from the analysis) or one
// scale, recomputed here from the judgments (each piece's mean across judges; means
// with 95% bootstrap intervals from resampling pieces 2,000 times).
function evModelStats(measure) {
  const t = evTd();
  if (measure === "overall") return { models: t.models, diffs: t.diffs };
  const byPiece = {};
  for (const r of evData.judgments) {
    if (r.track !== evTrack || r.scores[measure] == null) continue;
    (byPiece[`${r.model}|${r.item}`] ||= []).push([r.judge, evGood(measure, r.scores[measure])]);
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const resample = (xs) => Array.from(xs, () => xs[Math.floor(Math.random() * xs.length)]);
  const values = {};
  const judgeVals = {};
  for (const [k, list] of Object.entries(byPiece)) {
    const m = k.split("|")[0];
    (values[m] ||= []).push(mean(list.map(([, v]) => v)));
    for (const [j, v] of list) ((judgeVals[m] ||= {})[j] ||= []).push(v);
  }
  const models = evData.models.map((m) => m.id).filter((m) => (values[m] || []).length > 1).map((m) => {
    const ms = Array.from({ length: 2000 }, () => mean(resample(values[m]))).sort((a, b) => a - b);
    return { model: m, n: values[m].length, mean: mean(values[m]), lo: ms[50], hi: ms[1949],
      by_judge: Object.fromEntries(Object.entries(judgeVals[m]).map(([j, vs]) => [j, mean(vs)])) };
  });
  const diffs = [];
  models.forEach((a, i) => models.slice(i + 1).forEach((b) => {
    const va = values[a.model], vb = values[b.model];
    const ds = Array.from({ length: 2000 }, () => mean(resample(va)) - mean(resample(vb))).sort((x, y) => x - y);
    diffs.push({ a: a.model, b: b.model, diff: mean(va) - mean(vb), lo: ds[50], hi: ds[1949] });
  }));
  return { models, diffs };
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
        el("strong", { class: "ev-has-tip", "data-item": item, tabindex: "0", text: item }), el("span", { class: "ev-piece-model" }, el("i", { class: "ev-key dot", style: `--c:${EV_MODEL_COLORS[model] || "#666"}` }), evModel(model)),
        el("span", { class: "meta", text: `words shared between judges: strengths ${evPct(ta.strength?.overlap)}, weaknesses ${evPct(ta.weakness?.overlap)}` })),
      el("div", { class: "ev-verdicts", style: `--cols:${judged.length}` }, judged.map((r) => el("div", { class: "ev-verdict" },
        el("div", { class: "ev-verdict-head" }, el("i", { class: "ev-key dot", style: `--c:${EV_JUDGE_COLORS[r.judge] || "#888"}` }), evJudge(r.judge),
          el("span", { class: "ev-verdict-score", text: overall(r).toFixed(2) })),
        el("p", { class: "ev-plus" }, el("b", { text: "+ " }), ...marked(r.strength || "", ta.strength?.shared)),
        el("p", { class: "ev-minus" }, el("b", { text: "− " }), ...marked(r.weakness || "", ta.weakness?.shared))))),
      evAllScores(judged), raw);
  });
  return el("section", { class: "ev-section" },
    el("h2", { text: `Every piece, and what each judge said · ${evTd().label}` }),
    el("p", { text: `Every judge writes one strength and one weakness for each piece. On this track, the judges' strengths share ${evPct(mean(overlaps("strength")))} of their content words on average, and their weaknesses ${evPct(mean(overlaps("weakness")))} (mean pairwise Jaccard overlap). Words two or more judges used are highlighted. Word overlap is a rough measure: two judges can make the same point in different words, so read them side by side. Open a piece to see exactly what the model was given and what it wrote.` }),
    el("details", { class: "card" }, el("summary", { text: `Open the ${keys.length} ${evTrack === "companion" ? "conversations" : "pieces"}` }), ...cards));
}
