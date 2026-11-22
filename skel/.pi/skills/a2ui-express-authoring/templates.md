# A2UI Express templates for Classic

Pass each Express example to `send_a2ui` in `express` and use the quoted summary as `fallback`. The last example takes `messages` instead. Do not include fences. Use Markdown if the tool is unavailable or the interaction is clearer without controls.

## Approve, revise or decline

Fallback: “Choose what to do with the draft.” A decision is a new user reply in the original thread. Approval applies only to the decision described in the form.

```express
root = Column([
  Text("Approve this draft for hand-off, ask for revisions, or decline."),
  Row([
    Button(Text("Approve draft"), variant="primary", action=Event("approve_draft")),
    Button(Text("Request changes"), action=Event("revise_draft")),
    Button(Text("Decline"), action=Event("decline_draft"))
  ])
])
```

## Pick one option

Fallback: “Choose a format for the report: summary or full report.” The form submits the selected option as a list. The example shows Summary as the default.

```express
$/format = ["summary"];
root = Column([
  ChoicePicker(label="Report format", options=[{value:"summary",label:"Summary"},{value:"full",label:"Full report"}], value=$/format),
  Button(Text("Confirm format"), variant="primary", action=Event("choose_format", {format: $/format}))
])
```

## Open a reference

Fallback: “Read the documentation at https://example.com/docs.” Use HTTPS and name the destination. A link opens in the browser; it does not submit a message or approve an action.

```express
root = Button(Text("Read the documentation"), action=openUrl("https://example.com/docs"))
```

## Collect another note

Fallback: “Add an optional note for the hand-off.” Set `keep_active: true` at creation only when another submission should remain possible. Cancel closes the form without submitting the draft or starting a turn.

```express
$/note = "";
root = Column([
  TextField(label="Hand-off note", value=$/note),
  Row([
    Button(Text("Submit note"), variant="primary", action=Event("add_note", {note: $/note})),
    Button(Text("Close form"), action=Event("cancel"))
  ])
])
```

## Choose a row using v1.0 messages

Fallback: “Choose North or South.” Pass the array as `messages`, without `express`. The relative bindings read from the selected row. The action includes the row's one-based position, structured context and a short user-facing description.

```json
[
  {
    "version": "1.0",
    "createSurface": {
      "surfaceId": "urn:example:region-picker",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      "dataModel": {
        "regions": [
          {"label": "North", "description": "Chose North"},
          {"label": "South", "description": "Chose South"}
        ]
      }
    }
  },
  {
    "version": "1.0",
    "updateComponents": {
      "surfaceId": "urn:example:region-picker",
      "components": [
        {"id": "root", "component": "List", "children": {"componentId": "pick", "path": "/regions"}},
        {
          "id": "pick",
          "component": "Button",
          "child": "row_label",
          "action": {
            "event": {
              "name": "choose_region",
              "userMessage": {"@path": "description"},
              "context": {
                "region": {"@path": "label"},
                "position": {"@call": "@index", "args": {"offset": 1}},
                "source": {"section": "handoff", "tags": ["region"]}
              }
            }
          }
        },
        {"id": "row_label", "component": "Text", "text": {"@path": "label"}}
      ]
    }
  }
]
```

Show progress or a result in ordinary timeline text when there is nothing for the user to do. Do not build an interactive receipt just to acknowledge a submission: the action already creates a normal user reply.
