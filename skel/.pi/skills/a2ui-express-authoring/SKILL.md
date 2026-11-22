---
name: a2ui-express-authoring
description: Show a small interactive form, decision or set of links in the current Piclaw Classic web thread using send_a2ui and A2UI Express.
---

# A2UI Express in Classic

Use `send_a2ui` for small, conversation-owned forms. Use normal Markdown for prose, simple lists and non-web users. The tool accepts bare [A2UI Express](https://a2ui.org/) source, not JSON, Markdown fences or `<a2ui>` tags. Provide a short `fallback` that makes sense without the form.

```text
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

- `root` is required when creating a surface. Supported components: `Text`, `Column`, `Row`, `Card`, `Divider`, `Button`, `TextField`, `CheckBox`, and `ChoicePicker`.
- Bind inputs to absolute `$` data paths. `ChoicePicker` binds a list of selected option values: initialise it with `[]` or `["value"]` using double quotes for strings. Include only the expected fields in the button's `Event` context.
- `Event("cancel")` closes an agent form without submitting values. A normal event submits a new user input in the original thread. Set `keep_active` only when repeated submissions are useful.
- `openUrl("https://example.com/docs")` is a static browser link. Dynamic URLs, custom functions, embedded HTML and remote catalogs are unsupported.
- Never request keys, tokens, OTPs or other credentials in an agent form. Built-in auth flows have separate private controls.
- To edit, supply the post ID and current revision returned by the tool. For a component update, start with `surface("returned-surface-id", update=true)`; for a data update, assign the path. To remove it, use `deleteSurface("returned-surface-id")` with the post ID and revision.

Adaptive Cards have been retired. Old posts keep their ordinary text, with no live card controls.
