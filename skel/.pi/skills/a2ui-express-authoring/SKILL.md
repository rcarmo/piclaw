---
name: a2ui-express-authoring
description: Show a small interactive form, decision or set of links in the current Piclaw Classic web thread using send_a2ui and A2UI Express.
---

# A2UI Express in Classic

Use `send_a2ui` for small forms in the current Classic thread when the renderer offers the A2UI v1.0 Basic Catalogue for this turn. Otherwise, ask the same question in Markdown or in the channel's text format. Do not emit raw content blocks. If the tool returns a v1.0 validation error, use its `surfaceId` and field `path` to correct the definition before trying again.

Prefer bare [A2UI Express](https://a2ui.org/) in `express`, without Markdown fences or `<a2ui>` tags. Provide a short `fallback` that makes sense without the form.

For wire features the Express parser cannot express, pass `messages` instead of `express`. Start with a v1.0 `createSurface` using the [Basic Catalogue](https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json), and use the same draft `surfaceId` throughout the batch. You can send the model and components in later updates. Classic shows the fallback until `root` arrives, then fills in child components as their definitions arrive. Use the returned surface ID, post ID and current revision to update or delete the surface.

If `createSurface` omits `catalogId`, each component must name the Basic Catalogue in `@catalogId`, and each non-system function call must name it in `catalogId`. Use identifiers such as `row_label` for component IDs and function argument names. The system index (`{"@call":"@index","args":{"offset":1}}`) needs no catalogue and is available inside repeated template items.

```express
$/topic = "";
$/notify = false;
root = Column([
  Text("Choose what to include"),
  TextField(label="Topic", value=$/topic),
  CheckBox(label="Notify me", value=$/notify),
  Row([
    Button(Text("Submit"), variant="primary", action=Event("confirm", {topic: $/topic, notify: $/notify})),
    Button(Text("Cancel"), action=Event("cancel"))
  ])
]);
```

- Include `root` when creating a surface with Express. Classic renders the 18 Basic Catalogue component types, including tabs, modals, images, audio, video, sliders and date/time inputs.
- Use absolute bindings like `$/topic` for shared values. `List`, `Row` and `Column` can repeat a component with `_template($/rows, row)`. In the repeated component, `$label` reads `label` from that row. Include only the expected fields in the button's `Event` context.
- `ChoicePicker` binds a list of selected option values: initialise it with `[]` or `["value"]`. Use `displayStyle="chips"` for compact choices and `filterable=true` for a search field.
- `Event("cancel")` closes an agent form without submitting values. A normal event submits a new user input in the original thread. Set `keep_active` only when repeated submissions are useful.
- Use `openUrl("https://example.com/docs")` or `openUrl($/url)` for a link that opens on click. The resolved target must be an HTTP(S) URL without credentials. Use Basic Catalogue functions to format values. For wire components, add `@checks` with a condition binding or function and an optional fallback message. Use `@accessibility.label` or `description` when the visible label does not explain the control. A remote function needs a trusted host registration; the default host provides none. Classic does not fetch catalogues or render embedded HTML.
- Set `createSurface.sendDataModel: true` only when the agent needs the full model on each message. Classic includes valid drafts for the current surface revision, even if a control was not named in the event context. Only the owning agent gets that metadata. Closing a form with `cancel` submits nothing.
- `TextField` with `variant="obscured"` only masks the display. Its value can be sent to the agent and saved in chat. Never request keys, tokens, OTPs or other credentials in an agent form. Built-in auth flows use separate private controls.
- To edit, supply the post ID and current revision returned by the tool. For a component update, start with `surface("returned-surface-id", update=true)`; for a data update, assign the path. To remove it, use `deleteSurface("returned-surface-id")` with the post ID and revision.

Use [these templates](templates.md) for an approval, a choice, a reference link, a repeatable form or a v1.0 wire example.

Prompt pattern: “If `send_a2ui` is available in this Classic thread, ask this one question as a small form with readable fallback text. Submit only the fields needed to answer it. Otherwise ask in plain text.”

Adaptive Cards have been retired. Rewrite old authoring prompts to call `send_a2ui` with Express source. Old posts keep their ordinary text; their controls cannot be used.
