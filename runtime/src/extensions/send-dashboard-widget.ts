/**
 * send-dashboard-widget – post agent-generated widget HTML to the web timeline.
 *
 * The agent always provides the HTML. The widget runs in a sandboxed iframe.
 * Interactive widgets get `window.piclawWidget` with bridge methods.
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getChatJid } from "../core/chat-context.js";
import { createGeneratedWidgetBlock } from "../channels/web/dashboard-widget.js";
import { postMessagesToolMessage } from "./messages-crud.js";

const SendDashboardWidgetSchema = Type.Object({
  html: Type.String({ description: "Self-contained widget HTML (inline CSS/JS). Rendered in a sandboxed iframe." }),
  content: Type.Optional(Type.String({ description: "Fallback timeline text (shown before the widget is opened)." })),
  title: Type.Optional(Type.String({ description: "Card title in the timeline." })),
  open_label: Type.Optional(Type.String({ description: "Button label (default 'Open widget')." })),
  interactive: Type.Optional(Type.Boolean({ description: "Enable scripts + piclawWidget bridge (default true)." })),
  chat_jid: Type.Optional(Type.String({ description: "Target chat JID (defaults to current chat)." })),
  widget_id: Type.Optional(Type.String({ description: "Stable widget identifier." })),
});

const HINT = `## Dashboard widget posting
Use send_dashboard_widget to post an interactive widget to the PiClaw web timeline.
You must provide \`html\` — a self-contained HTML document fragment with inline CSS and JS.

The widget opens in a floating pane (sandboxed iframe). Interactive widgets (default) get a bridge:

\`\`\`js
// Available as window.piclawWidget inside the widget
piclawWidget.submit({ text: "message" })   // Send text back into the chat
piclawWidget.close({ reason: "done" })      // Programmatic dismiss (pane already has its own close button)
piclawWidget.requestRefresh({ key: "val" }) // Ask host for data (advanced)

// Listen for host responses:
window.addEventListener('piclaw:widget-message', (e) => {
  const payload = e.detail?.payload;  // host state
});
\`\`\`

The \`submit({ text })\` call is the main way to get output from the widget back into the conversation.

Vendored libraries (served from \`/static/common/js/vendor/\`):

Widgets load these on demand via \`<script src>\` inside the iframe — they are NOT pre-loaded by the host page. Each widget only pays for the libraries it actually uses.

- **Babylon.js 9.16** — UMD global build (exposes \`BABYLON\` global):
  \`\`\`html
  <script src="/static/common/js/vendor/babylon/babylon.js"></script>
  <script>
  var canvas = document.getElementById('renderCanvas');
  var engine = new BABYLON.Engine(canvas, true);
  var scene = new BABYLON.Scene(engine);
  var camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/4, Math.PI/3, 10, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  scene.add(new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0,1,0), scene));
  engine.runRenderLoop(function(){ scene.render(); });
  </script>
  \`\`\`
- **ECharts 6.1** — rich charting (bar, line, pie, heatmap, treemap, radar, geo, etc.):
  \`\`\`html
  <script src="/static/common/js/vendor/echarts/echarts.min.js"></script>
  <div id="chart" style="width:100%;height:400px"></div>
  <script>
  var chart = echarts.init(document.getElementById('chart'), 'dark');
  chart.setOption({ xAxis: { data: ['A','B','C'] }, yAxis: {}, series: [{ type: 'bar', data: [10, 20, 30] }] });
  window.addEventListener('resize', function(){ chart.resize(); });
  </script>
  \`\`\`
- **Three.js r185.1** — ESM 3D rendering (scenes, geometries, materials, loaders, post-processing):
  \`\`\`html
  <script type="module">
  import * as THREE from '/static/common/js/vendor/three/three.module.min.js';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x7dd3fc }));
  scene.add(cube, new THREE.AmbientLight(0xffffff, 0.5), new THREE.DirectionalLight(0xffffff, 1));
  camera.position.z = 3;
  (function animate() { cube.rotation.x += 0.01; cube.rotation.y += 0.01; renderer.render(scene, camera); requestAnimationFrame(animate); })();
  </script>
  \`\`\`
- **KaTeX 0.17** — math typesetting (available if the host page has loaded it; check window.katex).
- **Marked 18** — markdown rendering (available if the host page has loaded it; check window.marked).`;

type Params = {
  html: string;
  content?: string;
  title?: string;
  open_label?: string;
  interactive?: boolean;
  chat_jid?: string;
  widget_id?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function err(message: string): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text: message }], details: { posted: 0, error: message } };
}

export const sendDashboardWidget: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${HINT}`,
  }));

  pi.registerTool({
    name: "send_dashboard_widget",
    label: "send_dashboard_widget",
    description: "Post an interactive widget with agent-authored HTML to the web timeline.",
    promptSnippet: "send_dashboard_widget: post an interactive widget (HTML/CSS/JS) to the floating pane. Use piclawWidget.submit({text}) to return output.",
    parameters: SendDashboardWidgetSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_toolCallId, params: Params) {
      const html = typeof params.html === "string" ? params.html.trim() : "";
      if (!html) return err("Provide html with the widget content.");

      const ambientChat = getChatJid("");
      const chatJid = params.chat_jid?.trim() || ambientChat || "";
      if (!chatJid) return err("Cannot determine the active web chat. Provide chat_jid explicitly.");
      if (!chatJid.startsWith("web:")) return err("Generated widgets are only available in the web UI.");

      const block = createGeneratedWidgetBlock({
        html,
        widgetId: params.widget_id?.trim() || undefined,
        title: params.title?.trim(),
        openLabel: params.open_label?.trim(),
        interactive: params.interactive !== false,
      });

      const content = params.content?.trim() || "Widget ready — open to interact.";
      const result = postMessagesToolMessage(
        { action: "post", type: "agent", chat_jid: chatJid, content, content_blocks: [block] },
        chatJid,
      );

      return {
        ...result,
        terminate: true,
        details: { ...(isRecord(result.details) ? result.details : {}), tool: "send_dashboard_widget", widget_id: block.widget_id, chat_jid: chatJid },
      };
    },
  });
};
