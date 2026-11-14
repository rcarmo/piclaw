import { h } from "preact";
import { selectLocalTheme } from './select-theme.js';
import { initTheme } from "../../../web/src/ui/theme";
import { WEB_THEME_PRESETS } from "../../../src/core/ui-theme-catalogue";

const params = new URLSearchParams(location.search);
const skin = "classic";
const view = params.get("view") || "ui";
const host = document.getElementById("app")!;
const sessions = [
  { chat_jid: "web:default", agent_name: "Neon", is_active: true },
  { chat_jid: "web:other", agent_name: "Other" },
];
window.fetch = async (input) => {
  const path = String(input);
  if (path.includes("active-chats")) return Response.json({ chats: sessions });
  if (path.includes("branches")) return Response.json({ branches: [] });
  if (path.includes("timeline"))
    return Response.json({ posts: [], has_more: false });
  return Response.json({});
};

if (view === "lightbox") {
  const {
    html,
    render: classicRender,
    useState: classicState,
  } = await import("../../../web/src/vendor/preact-htm");
  const { AttachmentPreviewModal } =
    await import("../../../web/src/components/attachment-preview-modal");
  if (view === "lightbox") {
    function Preview() {
      const [open, setOpen] = classicState(false);
      return html`<button id="open-preview" onClick=${() => setOpen(true)}>
          Preview attachment
        </button>
        <p>Underlying page remains visible.</p>
        ${open && html`<${AttachmentPreviewModal} mediaId=${42} info=${{ filename: "fixture.svg", content_type: "image/svg+xml" }} onClose=${() => setOpen(false)} />`}`;
    }
    classicRender(html`<${Preview} />`, host);
  }
} else if (view === "native-tooltips") {
  const { html, render: classicRender } =
    await import("../../../web/src/vendor/preact-htm");
  const { ComposeBox } =
    await import("../../../web/src/components/compose-box");
  const { Post } = await import("../../../web/src/components/post");
  const timing = {
    type: "agent_timing",
    started_at: "2026-09-21T12:00:00.000Z",
    duration_ms: 62000,
    usage: {
      input_tokens: 12000,
      output_tokens: 3456,
      reasoning_tokens: 1200,
      cache_read_tokens: 7800,
      cache_write_tokens: 900,
      total_tokens: 24156,
      cost_total: 0.01234,
      provider_cost_total: 0.01234,
      cost_provenance: "provider_reported",
    },
  };
  classicRender(
    html`<${Post}
        post=${{ id: 123, timestamp: "2026-09-21T12:01:02.000Z", data: { content: "Timestamp details", sender_name: "Fixture", is_bot_message: true, content_blocks: [timing] } }}
      /><${ComposeBox}
        currentChatJid="web:default"
        activeChatAgents=${[]}
        contextUsage=${{ tokens: 32000, contextWindow: 128000, percent: 25 }}
        onContextCompact=${() => {}}
        capabilities=${{ speech: false, attachmentButton: false, cameraButton: false, locationButton: false, notifications: false, modelPicker: false, commandReference: false }}
        onSubmit=${async () => true}
      />
`,
    host,
  );

} else if (view === "settings") {
  await import("./settings-controls-fixture");
} else if (view === "model" || view === "session") {
  // Reuse real component fixtures, including the Classic session/compose host.
  if (skin === "classic" && view === "session") {
    host.id = "session-picker-fixture-root";
    await import("../../../web/src/dev/session-picker-fixture");
  } else {
    host.id = "picker-root";
    await import("./classic-picker-buttons-fixture");
  }
} else if (view === "ui") {
  host.innerHTML =
    '<section class="post-content"><h2>SynthWave Full</h2><p id="neon-prose">Welcome to the grid. Chat, controls and the composer glow together.</p><p><a href="#app">Follow the neon</a></p></section><div id="real-compose"></div>';
  const compose = document.getElementById("real-compose")!;
  {
    const { ComposeBox } =
      await import("../../../web/src/components/compose-box");
    const { html, render: renderClassic } =
      await import("../../../web/src/vendor/preact-htm.js");
    renderClassic(
      html`<${ComposeBox}
        currentChatJid="web:default"
        activeChatAgents=${[]}
        capabilities=${{ speech: false, attachmentButton: false, cameraButton: false, locationButton: false, notifications: false, modelPicker: false, commandReference: false }}
        onSubmit=${async () => true}
      />`,
      compose,
    );
  }
} else {
  // Native input types and the audited app input class families.
  // Actual model/session/settings/compose components are tested separately.
  const classes = [
    "compose-session-search",
    "compose-model-catalogue-search",
    "model-picker__search",
    "settings-filter-input",
    "settings-header-filter",
    "settings-panel__input",
    "settings-panel__shortcut-input",
    "settings-panel__keyboard-filter",
    "settings-panel__tools-filter",
    "settings-panel__model-filter",
    "modal-dialog__input",
    "search-panel__input",
    "search-panel__scope-select",
    "addons-panel__filter-input",
    "env-section__filter",
    "env-section__add-name",
    "env-section__add-value",
    "scratchpad-panel__input",
    "scratchpad-panel__textarea",
    "provider-wizard__input",
    "provider-wizard__select",
    "timeline-quick-actions-input",
    "workspace-menu-scale-input",
    "language-switcher-select",
    "post-aside-textarea",
    "settings-shortcut-input",
    "command-palette__input",
    "workspace-rename-input",
    "settings-panel__select",
    "settings-panel__stepper-value",
    "settings-stepper-value",
    "settings-input",
    "model-catalogue-settings__search",
  ];
  const types = [
    "text",
    "search",
    "password",
    "email",
    "url",
    "tel",
    "number",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
    "color",
    "range",
    "checkbox",
    "radio",
    "file",
  ];
  host.innerHTML =
    '<h2>Theme focus audit</h2><div id="control-matrix">' +
    types
      .map(
        (type) =>
          `<label>${type}<input data-audit="${type}" type="${type}" aria-label="${type}"></label>`,
      )
      .join("") +
    classes
      .map((name) => {
        const attrs = `data-audit="${name}" class="${name}" aria-label="${name}"`;
        const control = name.includes("textarea")
          ? `<textarea ${attrs}>Text</textarea>`
          : name.includes("select")
            ? `<select ${attrs}><option>Neon</option></select>`
            : `<input ${attrs}>`;
        return `<label>${name}${control}</label>`;
      })
      .join("") +
    '<label>Select<select data-audit="select"><option>Neon</option></select></label><label>Text area<textarea data-audit="textarea">Text</textarea></label><div contenteditable="true" role="textbox" data-audit="editable">Editable text</div><input data-audit="readonly" readonly value="Read only"><input id="disabled-control" disabled value="Disabled"><input aria-invalid="true" data-audit="invalid" value="Invalid"><button id="keyboard-target">Keyboard target</button></div>';
}
initTheme();
selectLocalTheme(params.get("theme") || "synthwave-84-full");

Object.assign(window, {
  themeUi: {
    selectLocalTheme,
    presets: WEB_THEME_PRESETS,
  },
});
