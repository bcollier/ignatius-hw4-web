// ================================================================ new retreat

function openNew() {
  show("new");
  fillIdeaDays();
  noteEmptyAboutMe();
  document.title = "New retreat · Ignatius at Home";
  if ($("advanced").parentElement !== $("panel-advanced")) $("panel-advanced").append($("advanced"));
  setTab(store.get("tab", "simple"));
  $("start-date").value = localToday();
  $("watch-build-label").hidden = !debugMode();
  $("watch-build").checked = debugMode() && !!store.get("watchBuild", false);
  $("watch-build").onchange = () => store.set("watchBuild", $("watch-build").checked);
  $("what-happens").open = !library.length || !!chosenExample; // open for a first retreat
  loadExampleDocs();
  if (!library.length) api("/api/retreats").then((b) => { library = b.retreats; fillSeriesList(); }).catch(() => {});
  fillSeriesList();
}

function setTab(tab) {
  $("tab-simple").setAttribute("aria-selected", String(tab === "simple"));
  $("tab-advanced").setAttribute("aria-selected", String(tab === "advanced"));
  $("panel-advanced").hidden = tab !== "advanced";
  store.set("tab", tab);
}

function fillSeriesList() {
  const ul = $("series-list");
  const checked = new Set([...ul.querySelectorAll("input:checked")].map((b) => b.value));
  ul.innerHTML = "";
  for (const r of [...library].sort((a, b) => a.created_at - b.created_at).filter((r) => r.status === "ready")) {
    ul.append(el("li", {}, el("label", { class: "check" },
      el("input", { type: "checkbox", value: r.id, checked: checked.has(r.id) }),
      ` ${r.title} · ${new Date(r.created_at * 1000).toLocaleDateString()}`)));
  }
  if (!ul.children.length) ul.append(el("li", { class: "hint", text: "No finished retreats yet." }));
}

let chosenExample = null; // slug of an example document ("be-still", or "be-still.txt")
let exampleDocs = [];

function chooseFile(file) {
  if (file) chosenExample = null;
  $("drop").classList.toggle("chosen", !!file || !!chosenExample);
  const ex = chosenExample && exampleDocs.find((e) => e.slug === chosenExample.replace(/\.txt$/, ""));
  $("drop-title").textContent = file ? file.name
    : ex ? `Using the example: ${ex.title}${chosenExample.endsWith(".txt") ? " (plain text)" : ""}`
    : "Choose a PDF, Word or text file";
  previewFile(file);
  document.querySelectorAll(".example-doc").forEach((c) => c.classList.toggle("chosen", !!chosenExample && c.dataset.slug === chosenExample.replace(/\.txt$/, "")));
}

// A first look at the chosen file: the server reads its start and says what it is (a
// working title and two or three sentences), so the person can see it's the right file
// rather than "P1W3P.pdf". If that fails, the file name simply stays.
let previewFor = null; // the file being described; a newer choice wins
let dropHintDefault = null;

async function previewFile(file) {
  const hint = $("drop-hint");
  dropHintDefault ??= hint.textContent;
  previewFor = file || null;
  $("drop").classList.remove("previewed");
  if (!file) {
    hint.replaceChildren(dropHintDefault);
    return;
  }
  const maxMb = options?.limits?.max_upload_mb ?? DEFAULT_MAX_UPLOAD_MB;
  if (!/\.(pdf|docx|txt|md|jpe?g|png)$/i.test(file.name) || file.size > maxMb * 1024 * 1024) {
    hint.replaceChildren(dropHintDefault);
    return;
  }
  hint.replaceChildren("Reading it to see what it is", el("span", { class: "wait-dots", "aria-hidden": "true" }, el("i"), el("i"), el("i")));
  const form = new FormData();
  form.append("file", file);
  if ($("plan-model").value) form.append("model", $("plan-model").value);
  let seen;
  try {
    seen = await api("/api/retreats/preview", { method: "POST", body: form });
  } catch {
    seen = null;
  }
  if (previewFor !== file) return; // another file was chosen meanwhile
  if (!seen) {
    hint.replaceChildren(dropHintDefault);
    return;
  }
  $("drop").classList.add("previewed");
  $("drop-title").textContent = seen.title;
  const about = [file.name, seen.pages ? `${seen.pages} page${seen.pages === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  hint.replaceChildren(el("span", { class: "drop-description", text: seen.description }),
    el("span", { class: "drop-file", text: `${about} · Not the right file? Choose another.` }));
}

// Example documents to build from, with a look at the source first.
async function loadExampleDocs() {
  if (!exampleDocs.length) {
    try {
      exampleDocs = (await api("/api/examples")).examples || [];
    } catch {
      exampleDocs = [];
    }
  }
  $("example-picker").hidden = !exampleDocs.length;
  const box = $("example-docs");
  box.innerHTML = "";
  for (const e of exampleDocs) box.append(exampleDocCard(e));
  chooseFile(null);
}

// Choosing an example (or its plain-text version) replaces any file or pasted text;
// choosing it again un-chooses it.
function useExample(slug) {
  chosenExample = chosenExample === slug ? null : slug;
  $("file").value = "";
  $("paste-text").value = "";
  chooseFile(null);
  if (chosenExample) $("what-happens").open = true;
}

function exampleDocCard(e) {
  return el("div", { class: "example-doc", "data-slug": e.slug },
    e.cover_url ? el("img", { src: fileUrl(e.cover_url), alt: "", loading: "lazy" }) : el("span"),
    el("div", { class: "example-doc-body" },
      el("strong", { text: e.title }),
      el("span", { class: "meta", text: `${e.days} days${e.subtitle ? ` · ${e.subtitle}` : ""}` }),
      e.description && el("span", { class: "hint", text: e.description }),
      el("span", { class: "row-buttons" },
        el("button", { type: "button", class: "secondary", text: "Use this example", onclick: () => useExample(e.slug) }),
        el("a", { href: fileUrl(e.pdf_url), target: "_blank", rel: "noopener", text: "Look at the PDF" }),
        e.txt_url && el("button", { type: "button", class: "link", text: "or its plain-text version", onclick: () => useExample(`${e.slug}.txt`) }))));
}

const DEFAULT_MAX_UPLOAD_MB = 15; // until /api/options says otherwise

// "Make my retreat": check the choices here first (so mistakes show at once), send
// everything in one request, and go to the retreat to watch it being made.
async function makeRetreat(event) {
  event.preventDefault();
  showMessage("");
  let form;
  try {
    form = newRetreatForm();
  } catch (problem) {
    return showMessage(problem.message);
  }
  const button = $("make-button");
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const made = await api("/api/retreats", { method: "POST", body: form });
    if ($("watch-build").checked) store.set(`watch.${made.id}`, true);
    resetNewForm();
    go(`?r=${made.id}`);
  } catch (err) {
    showMessage(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Make my retreat";
  }
}

// The request, from what's on the form. Throws an Error with a message to show.
function newRetreatForm() {
  const idea = $("idea-text").value.trim();
  const ideaPhoto = $("idea-photo").files[0];
  const gdoc = $("retreat-gdoc").value.trim();
  if (gdoc && !/docs\.google\.com\/document\/d\//.test(gdoc)) throw new Error("That doesn't look like a Google Doc link. It should start with https://docs.google.com/document/d/");
  const file = idea || ideaPhoto || gdoc ? null : chosenSourceFile();
  if (!file && !chosenExample && !idea && !ideaPhoto && !gdoc) throw new Error("Choose a file, paste some text, link a Google Doc, describe an idea, or pick an example first.");
  if (file && !/\.(pdf|docx|txt|md|jpe?g|png)$/i.test(file.name)) throw new Error("PDF, Word (.docx), text (.txt) and photo (.jpg, .png) files are supported.");
  const maxMb = options?.limits?.max_upload_mb ?? DEFAULT_MAX_UPLOAD_MB;
  if (file && file.size > maxMb * 1024 * 1024) throw new Error(`That file is larger than ${maxMb} MB.`);
  const form = new FormData();
  if (gdoc && !idea && !ideaPhoto) form.append("google_doc", gdoc);
  else if (idea || ideaPhoto) {
    form.append("idea", idea);
    form.append("idea_days", $("idea-days").value);
    if (ideaPhoto) form.append("photo", ideaPhoto);
  } else if (file) form.append("file", file);
  else form.append("example", chosenExample);
  form.append("model", $("plan-model").value);
  form.append("personal", $("personal").checked ? "true" : "false");
  form.append("start_date", $("start-date").value || localToday());
  form.append("options", JSON.stringify(buildOptions()));
  const planPrompt = $("plan-prompt").value;
  if (planPrompt.trim() !== defaultPrompt("plan").trim()) form.append("plan_prompt", planPrompt);
  if ($("series-toggle").checked) {
    const ids = [...document.querySelectorAll("#series-list input:checked")].map((b) => b.value);
    if (!ids.length) throw new Error("Choose at least one earlier week, or untick the series box.");
    form.append("series", ids.join(","));
  }
  return form;
}

// A chosen file, or pasted text sent as a text file.
function chosenSourceFile() {
  const file = $("file").files[0];
  const pasted = $("paste-text").value.trim();
  if (!file && pasted) return new File([pasted], "Pasted text.txt", { type: "text/plain" });
  return file;
}

// "Make it personal" only means something once there's something in About me.
async function noteEmptyAboutMe() {
  try {
    const p = await api("/api/profile");
    $("personal-hint").hidden = !!p.about?.trim();
  } catch {}
}

// Days for a retreat from an idea: one to the most a retreat can have, a week by default.
function fillIdeaDays() {
  const select = $("idea-days");
  if (select.options.length) return;
  const most = options?.limits?.max_days || 14;
  for (let n = 1; n <= most; n++) select.append(el("option", { value: n, text: n === 1 ? "1 day" : `${n} days` }));
  select.value = "7";
}

function resetNewForm() {
  $("new-form").reset();
  chosenExample = null;
  chooseFile(null);
  $("series-box").hidden = true;
  fillSettings();
}
