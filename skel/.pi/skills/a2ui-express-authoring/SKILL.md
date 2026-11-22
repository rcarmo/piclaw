---
name: a2ui-express-authoring
description: Show a small interactive form, decision or set of links in the current Piclaw Classic web thread using send_a2ui and A2UI Express.
---

# A2UI Express in Classic

Use `send_a2ui` for small forms in the current Classic thread. Only use it when the tool is available and controls are clearer than prose. Otherwise, ask the same question in Markdown or in the channel's text format. Do not ask the model to emit raw content blocks.

Prefer bare [A2UI Express](https://a2ui.org/) in `express`, without Markdown fences or `<a2ui>` tags. Provide a short `fallback` that makes sense without the form.

For wire features the Express parser cannot express, pass `messages` instead of `express`. Start with a v1.0 `createSurface` using the [Basic Catalogue](https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json), and use the same draft `surfaceId` throughout the batch. Piclaw returns the ID to use on later updates. For example, the system index is `{"@call":"@index","args":{"offset":1}}` and is available inside repeated template items.

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

- `root` is required when creating a surface. Classic renders the 18 Basic Catalogue component types, including tabs, modals, images, audio, video, sliders and date/time inputs.
- Use absolute bindings like `$/topic` for shared values. `List`, `Row` and `Column` can repeat a component with `_template($/rows, row)`. In the repeated component, `$label` reads `label` from that row. Include only the expected fields in the button's `Event` context.
- `ChoicePicker` binds a list of selected option values: initialise it with `[]` or `["value"]`. Use `displayStyle="chips"` for compact choices and `filterable=true` for a search field.
- `Event("cancel")` closes an agent form without submitting values. A normal event submits a new user input in the original thread. Set `keep_active` only when repeated submissions are useful.
- Use `openUrl("https://example.com/docs")` or `openUrl($/url)` for a link that opens on click. The resolved target must be an HTTP(S) URL without credentials. Basic Catalogue functions can format labels and validate inputs. Custom functions, embedded HTML and remote catalogues are unsupported.
- Never request keys, tokens, OTPs or other credentials in an agent form. Built-in auth flows have separate private controls.
- To edit, supply the post ID and current revision returned by the tool. For a component update, start with `surface("returned-surface-id", update=true)`; for a data update, assign the path. To remove it, use `deleteSurface("returned-surface-id")` with the post ID and revision.

Use [these templates](templates.md) for an approval, a choice, a reference link or a repeatable form.

Prompt pattern: “If `send_a2ui` is available in this Classic thread, ask this one question as a small form with readable fallback text. Submit only the fields needed to answer it. Otherwise ask in plain text.”

Adaptive Cards have been retired. Rewrite old authoring prompts to call `send_a2ui` with Express source. Old posts keep their ordinary text; their controls cannot be used.
