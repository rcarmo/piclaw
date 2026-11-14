import { selectLocalTheme } from './select-theme.js';

const root = document.getElementById("app")!;
const theme = await import("../../../web/src/ui/theme.js");
const { WEB_THEME_PRESETS } =
  await import("../../../src/core/ui-theme-catalogue.js");
const { paletteVariables } =
  await import("../../../web/src/ui/theme-palette.js");
const syntaxExpectations = (await import("./theme-syntax-expectations.json"))
  .default;
const syntaxSources = (await import("./vscode-syntax-sources.json")).default;
const { SYNTAX_ROLES, resolveVSCodeSyntax } =
  await import("../../../src/core/theme-syntax.js");
const { terminalThemeFromCss } =
  await import("./palette-projection.js");

const data = {
  uiTheme: "default",
  uiTint: null,
  themes: WEB_THEME_PRESETS.map((t) => ({
    name: t.id,
    label: t.label,
    mode: t.mode,
    colors: t.dark || t.light,
  })),
  colorKeys: [
    "bgPrimary",
    "bgSecondary",
    "textPrimary",
    "textSecondary",
    "borderColor",
    "accent",
    "danger",
    "success",
  ],
};
window.fetch = async () => Response.json(data);
Object.assign(window, {
  themeFixture: {
    ...theme, selectLocalTheme,
    terminalThemeFromCss,
    paletteVariables,
    presets: WEB_THEME_PRESETS,
    syntaxExpectations,
    syntaxSources,
    syntaxRoles: SYNTAX_ROLES,
    resolveVSCodeSyntax,
  },
});
{
  const { html, render, useState } =
    await import("../../../web/src/vendor/preact-htm.js");
  const { ThemeSection } =
    await import("../../../web/src/components/settings/appearance.js");
  theme.initTheme();
  function Fixture() {
    const [settings, setSettings] = useState(data);
    return html`<div class="settings-content">
      <${ThemeSection}
        themes=${data.themes}
        colorKeys=${data.colorKeys}
        settingsData=${settings}
        setStatus=${() => {}}
        mergeSettingsData=${(patch) => setSettings({ ...settings, ...patch })}
      />
    </div>`;
  }
  if (new URLSearchParams(location.search).get("host") === "dialog") {
    const { requestOpenSettingsDialog } =
      await import("../../../web/src/components/settings-dialog-events.js");
    const { SettingsDialogContent } =
      await import("../../../web/src/components/settings-dialog.js");
    requestOpenSettingsDialog({ section: "theme" });
    render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
  } else render(html`<${Fixture} />`, root);
}
const { highlightCodeToHtml } =
  await import("../../../web/src/utils/code-highlighting.js");
const probes = document.createElement("div");
probes.id = "theme-probes";
probes.className = "post-content";
probes.innerHTML =
  '<p id="theme-prose">Welcome to SynthWave Full — the whole interface glows.</p><pre><code><span class="token keyword">const</span> value = <span class="token string">"fixture"</span> + <span class="token number">3</span>;</code></pre><button class="compose-send-btn">Send</button>';
const realCode = document.createElement("pre");
realCode.id = "theme-real-code";
realCode.innerHTML =
  "<code>" +
  highlightCodeToHtml(
    'async function launchNeon(city) {\n  const greeting = "Welcome to the grid";\n  const power = 84;\n  const ready = true;\n  await city.connect({ power, ready });\n  return greeting;\n}',
    "javascript",
  ) +
  "</code>";
probes.append(realCode);
document.body.append(probes);

// Literal highlighter classes test the CSS role contract independently from the
// resolver. The mounted EditorView below also exercises real parser/class output.
const roles: Record<string, string> = {
  keyword: "tok-keyword",
  operator: "tok-operator",
  number: "tok-number",
  string: "tok-string",
  regexp: "tok-regexp",
  comment: "tok-comment",
  variable: "tok-variableName",
  variable2: "tok-variableName2",
  definition: "tok-variableName tok-definition",
  function: "tok-variableName tok-definition tok-function",
  local: "tok-variableName tok-local",
  property: "tok-propertyName",
  propertyDefinition: "tok-propertyName tok-definition",
  type: "tok-typeName",
  class: "tok-className",
  namespace: "tok-namespace",
  label: "tok-labelName",
  macro: "tok-macroName",
  atom: "tok-atom",
  bool: "tok-bool",
  punctuation: "tok-punctuation",
  meta: "tok-meta",
  link: "tok-link",
  heading: "tok-heading",
  invalid: "tok-invalid",
  deleted: "tok-deleted",
  inserted: "tok-inserted",
};
const roleSheet = document.createElement("section");
roleSheet.id = "syntax-roles";
roleSheet.innerHTML = ["post-content", "cm-editor"]
  .map(
    (scope) =>
      `<div class="${scope}"><pre class="cm-content"><code>${Object.entries(
        roles,
      )
        .map(
          ([role, classes]) =>
            `<span data-role="${role}" class="${classes}">${role}</span>`,
        )
        .join(" ")}</code></pre></div>`,
  )
  .join("");
document.body.append(roleSheet);
const { EditorState, EditorView, syntaxHighlighting, javascript } =
  await import("#editor-vendor/codemirror");
const { themeClassHighlighter } =
  await import("../../../extensions/viewers/editor/syntax-highlighter.js");
const editorHost = document.createElement("div");
editorHost.id = "syntax-editor";
editorHost.style.cssText = "margin:16px;max-width:700px;";
document.body.append(editorHost);
const documentText =
  '// Syntax identity\nconst greeting = "Welcome to the grid";\nfunction launchNeon(city) { return city.connect(84, true); }';
const editor = new EditorView({
  state: EditorState.create({
    doc: documentText,
    extensions: [
      javascript(),
      syntaxHighlighting(themeClassHighlighter),
      EditorView.editable.of(false),
    ],
  }),
  parent: editorHost,
});
Object.assign((window as any).themeFixture, {
  destroyEditor: () => editor.destroy(),
});

if (new URLSearchParams(location.search).get("fences") === "1") {
// Exercise the actual fenced-Markdown pipelines and editor preview. Keep these
// nodes mounted while themes change so stale inline colours cannot pass.
await import("../../../web/src/vendor/marked-entry.js");
const classicMarkdown = await import("../../../web/src/markdown.js");

const markdown = '# Fixture\n\n```javascript\nasync function launch(city) {\n  const greeting = "hello"; // comment\n  return city.connect(42, true, greeting);\n}\n```\n\nEnd.\n';
const renderer = classicMarkdown.renderMarkdown;
const timeline = document.createElement("div");
timeline.id = "markdown-timeline";
timeline.className = "post-content";
timeline.innerHTML = renderer(markdown);
document.body.append(timeline);
const preview = document.createElement("div");
preview.id = "markdown-workspace-preview";
document.body.append(preview);
{
  preview.className = "attachment-preview-markdown post-content";
  preview.innerHTML = renderer(markdown);
}
const live = document.createElement("div");
live.id = "markdown-editor-preview";
live.style.cssText = "height:360px;width:850px";
document.body.append(live);
const { editorPaneExtension } = await import("../../../extensions/viewers/editor/editor-extension.js");
const markdownEditor = editorPaneExtension.mount(live, { path: "fixture.md", content: markdown, mtime: null, onSave: async()=>({ok:true}), onDirtyChange: ()=>{} });
Object.assign((window as any).themeFixture, { markdownEditor });

}
