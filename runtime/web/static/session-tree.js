const elements = {
  count: document.querySelector("#count"),
  filter: document.querySelector("#filter"),
  navigate: document.querySelector("#navigate"),
  refresh: document.querySelector("#refresh"),
  selection: document.querySelector("#selection"),
  selectionId: document.querySelector("#selection-id"),
  selectionPreview: document.querySelector("#selection-preview"),
  selectionType: document.querySelector("#selection-type"),
  status: document.querySelector("#status"),
  summarize: document.querySelector("#summarize"),
  tree: document.querySelector("#tree"),
};

const params = new URLSearchParams(window.location.search);
const chatJid = params.get("chat_jid")?.trim() || "web:default";
let nodes = [];
let selectedId = null;

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function nodeType(node) {
  return stringValue(node.role) || stringValue(node.type) || "entry";
}

function nodePreview(node) {
  return stringValue(node.previewText)
    || stringValue(node.preview)
    || stringValue(node.detail)
    || nodeType(node);
}

function depthFor(node, byId) {
  let depth = 0;
  let parentId = stringValue(node.parentId);
  const seen = new Set([node.id]);
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = stringValue(byId.get(parentId).parentId);
  }
  return depth;
}

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
  elements.status.hidden = !message;
}

function selectNode(node) {
  selectedId = node.id;
  elements.selection.hidden = false;
  elements.selectionType.textContent = nodeType(node);
  elements.selectionId.textContent = node.id;
  elements.selectionPreview.textContent = nodePreview(node);
  render();
}

function render() {
  const query = elements.filter.value.trim().toLowerCase();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visible = query
    ? nodes.filter((node) => [node.id, nodeType(node), nodePreview(node), node.label]
      .some((value) => stringValue(value).toLowerCase().includes(query)))
    : nodes;

  elements.count.textContent = query
    ? `${visible.length} match${visible.length === 1 ? "" : "es"}`
    : `${nodes.length} entr${nodes.length === 1 ? "y" : "ies"}`;
  elements.tree.replaceChildren();

  for (const node of visible) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `tree-row${node.active ? " active" : ""}${node.id === selectedId ? " selected" : ""}`;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", node.id === selectedId ? "true" : "false");
    row.style.setProperty("--tree-depth", String(depthFor(node, byId)));
    row.addEventListener("click", () => selectNode(node));

    const dot = document.createElement("span");
    dot.className = "tree-dot";
    dot.setAttribute("aria-hidden", "true");

    const tag = document.createElement("span");
    tag.className = "tree-tag";
    tag.textContent = nodeType(node);

    const preview = document.createElement("span");
    preview.className = "tree-preview";
    preview.textContent = nodePreview(node);

    const id = document.createElement("span");
    id.className = "mono muted";
    id.textContent = stringValue(node.id).slice(-7);

    row.append(dot, tag, preview, id);
    elements.tree.append(row);
  }

  elements.tree.hidden = visible.length === 0;
  if (visible.length === 0) {
    setStatus(query ? "No entries match this filter." : "Session tree is empty.");
  } else {
    setStatus("");
  }
}

function submitNavigation(summarize) {
  if (!selectedId) return;
  const text = `/tree ${selectedId}${summarize ? " --summarize" : ""}`;
  window.parent.postMessage({ type: "piclaw:widget-submit", payload: { text } }, window.location.origin);
  setStatus(`Sent ${text}`);
}

async function loadTree() {
  elements.refresh.disabled = true;
  setStatus("Loading session tree…");
  try {
    const url = new URL("/agent/session-tree", window.location.origin);
    url.searchParams.set("chat_jid", chatJid);
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.error && !payload.nodes?.length) throw new Error(payload.error);
    nodes = Array.isArray(payload.nodes) ? payload.nodes.filter((node) => node && typeof node.id === "string") : [];
    selectedId = nodes.some((node) => node.id === selectedId)
      ? selectedId
      : (stringValue(payload.leafId) || nodes.find((node) => node.active)?.id || nodes[0]?.id || null);
    const selected = nodes.find((node) => node.id === selectedId);
    if (selected) selectNode(selected);
    else {
      elements.selection.hidden = true;
      render();
    }
  } catch (error) {
    nodes = [];
    elements.tree.hidden = true;
    elements.selection.hidden = true;
    setStatus(error instanceof Error ? error.message : "Failed to load session tree.", true);
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.filter.addEventListener("input", render);
elements.filter.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  elements.filter.value = "";
  render();
});
elements.navigate.addEventListener("click", () => submitNavigation(false));
elements.summarize.addEventListener("click", () => submitNavigation(true));
elements.refresh.addEventListener("click", loadTree);

loadTree();
