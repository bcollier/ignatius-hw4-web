// ================================================================ agents (?agents)
// Every AI agent in the app: what it does, when it runs, its prompt, and its model.
// A person can read any prompt and make their own version, saved to their account
// (GET/PUT /api/agents). New retreat starts from their versions (myAgentPrompt), the
// Talk page reads the same companion prompt, and the server uses the rest in each job.

let myAgents = {}; // {agent id: the person's own prompt}, loaded at sign-in
const AGENT_SOURCE = "https://github.com/bcollier/ignatius-hw4-api/blob/main/app/agent_prompts/";

const myAgentPrompt = (id) => myAgents[id] || "";

async function loadMyAgents() {
  try {
    myAgents = (await api("/api/agents?mine_only=true")).custom || {};
  } catch {
    myAgents = {};
  }
}

async function openAgents() {
  show("agents");
  document.title = "Agents · Ignatius at Home";
  $("agents-list").replaceChildren(el("p", { class: "meta", text: "Loading the agents…" }));
  try {
    renderAgents(await api("/api/agents"));
  } catch (err) {
    showMessage(err.message);
  }
}

function renderAgents(data) {
  myAgents = Object.fromEntries(data.agents.filter((a) => a.custom).map((a) => [a.id, a.custom]));
  const groups = [...new Set(data.agents.map((a) => a.group))];
  $("agents-list").replaceChildren(...groups.map((g) => el("section", { class: "agent-group" },
    el("h2", { text: g }), ...data.agents.filter((a) => a.group === g).map((a) => agentCard(a, data.max_chars)))));
  $("agents-fixed").replaceChildren(...data.fixed.map((f) => el("details", { class: "card agent-fixed" },
    el("summary", {}, el("strong", { text: f.name }), el("span", { class: "meta", text: ` · ${f.what}` })),
    el("pre", { class: "agent-prompt", text: f.text }))));
}

function agentCard(a, maxChars) {
  const card = el("article", { class: "card agent-card", id: `agent-${a.id}` });
  const current = a.custom || a.default;
  card.append(
    el("div", { class: "agent-head" }, el("h3", { text: a.name }),
      el("span", { class: `agent-badge${a.custom ? " mine" : ""}`, text: a.custom ? "Your version" : "Default" })),
    el("p", { text: a.what }),
    el("dl", { class: "agent-facts" },
      el("dt", { text: "When" }), el("dd", { text: a.when }),
      el("dt", { text: "Given" }), el("dd", { text: a.gets }),
      el("dt", { text: "Default" }), el("dd", {}, el("a", { href: AGENT_SOURCE + a.file, target: "_blank", rel: "noopener", text: `app/agent_prompts/${a.file}` }))),
    agentModelRow(a));
  const read = el("details", { class: "agent-read" },
    el("summary", { text: `Read the prompt (${current.length.toLocaleString()} characters)` }),
    el("pre", { class: "agent-prompt", text: current }));
  const actions = el("div", { class: "row-buttons" },
    el("button", { type: "button", class: "secondary", text: a.custom ? "Edit your version" : "Make your own version",
      onclick: () => editAgent(card, a, maxChars) }),
    a.custom ? el("button", { type: "button", class: "link", text: "Go back to the default", onclick: () => saveAgent(a, "") }) : "");
  card.append(read, actions);
  return card;
}

function editAgent(card, a, maxChars) {
  const box = el("textarea", { rows: 18, spellcheck: true, "aria-label": `${a.name}: your version`, maxlength: maxChars });
  box.value = a.custom || a.default;
  const status = el("span", { class: "meta", role: "status" });
  const editor = el("div", { class: "agent-editor" },
    el("p", { class: "hint", text: "Change anything. It's saved to your account and used from the next time this agent runs."
      + (a.needs?.length ? ` Keep ${a.needs.join(", ")}: the app fills it in.` : "") }),
    box,
    el("div", { class: "row-buttons" },
      el("button", { type: "button", text: "Save", onclick: async () => {
        status.textContent = "Saving…";
        await saveAgent(a, box.value.trim() === a.default.trim() ? "" : box.value);
      } }),
      el("button", { type: "button", class: "link", text: "Cancel", onclick: () => editor.remove() }),
      status));
  card.querySelector(".agent-editor")?.remove();
  card.append(editor);
  box.focus();
}

async function saveAgent(a, prompt, model) {
  try {
    const body = model === undefined ? { prompt } : { model };
    const data = await postJson(`/api/agents/${a.id}`, body, "PUT");
    renderAgents(data);
    if (typeof fillSettings === "function") fillSettings(); // New retreat starts from the new version
    toast(model !== undefined ? "Model saved." : prompt ? `Saved your version of ${a.name}.` : `${a.name} is back to the default.`);
    $(`agent-${a.id}`)?.scrollIntoView({ block: "nearest" });
  } catch (err) {
    showMessage(err.message);
  }
}

// The model row. Planning and writing share New retreat's menus, and the companion the
// Talk page's (both remembered on this device, and kept on the account with "Save my
// defaults"); the Examen and the companion's memory choose theirs here.
function agentModelRow(a) {
  if (!a.model_kind) return "";
  const select = el("select", { "aria-label": `Model for ${a.name}` });
  let note = "";
  if (a.model_kind === "server") {
    for (const m of a.models) select.add(new Option(m.label, m.id));
    select.value = a.model;
    select.onchange = () => saveAgent(a, undefined, select.value);
  } else if (a.model_kind === "plan" || a.model_kind === "write") {
    const key = a.model_kind === "plan" ? "model.plan" : "model.write";
    for (const m of allowedModels()) select.add(new Option(m.free ? `${m.label} · free` : m.label, m.id));
    select.value = store.get(key) ?? store.get("model") ?? options.default_model;
    select.onchange = () => {
      store.set(key, select.value);
      fillSettings();
      toast("Model chosen on this device. \"Save my defaults\" under New retreat keeps it on your account.");
    };
    note = a.model_kind === "plan" ? "The planning model in New retreat." : "The writing model in New retreat, shared by the heart, deep dive and guidance.";
  } else if (a.model_kind === "talk") {
    fillTalkChoices(select);
    note = "The same choice as \"Change voice\" on Talk it over. Live voices talk and listen at once; a brain takes turns.";
  }
  return el("div", { class: "agent-model" }, el("label", {}, "Model ", select), note ? el("span", { class: "meta small", text: note }) : "");
}

// The companion's choices in one menu: each live voice, and each brain that takes turns.
function fillTalkChoices(select) {
  const providers = talkProviders();
  const brains = options.talk?.turn_brains?.[isFree() ? "free" : "full"] || {};
  for (const [id, info] of Object.entries(providers)) {
    if (id === "turns") for (const [b, label] of Object.entries(brains)) select.add(new Option(`Taking turns: ${label}`, `turns|${b}`));
    else select.add(new Option(`${info.label} (live voice)`, id));
  }
  const provider = store.get("talk.provider") || options.talk?.default_provider;
  select.value = provider === "turns" ? `turns|${store.get("talk.brain") || Object.keys(brains)[0]}` : provider;
  select.onchange = () => {
    const [p, brain] = select.value.split("|");
    store.set("talk.provider", p);
    if (brain) store.set("talk.brain", brain);
    fillTalkSettings();
    toast("Chosen on this device for Talk it over.");
  };
}
