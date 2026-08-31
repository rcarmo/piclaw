---
title: Atomic live-preview parity
tags: [piclaw, editor, atomic-port]
status: draft
---

# H1 Heading Fold Target

Intro paragraph with **bold**, _italic_, ~~strike~~, `inline code`, #tag, [safe link](https://example.com "Example"), [reference link][ref-link], [collapsed ref][], and [shortcut ref].

- [ ] Top-level unchecked task
- [x] Top-level checked task

## H2 Child Heading

> [!warning]- Collapsed warning
> Body line hidden when collapsed but editable when active.
> - [ ] Nested task inside callout

> Regular blockquote
> with continuation and **strong text**.

![Alt image](https://example.com/image.png "Image title")

![Pasted image](atomic-port-parity-20260831-151050.png)

![Relative image](assets/editor-preview.png)

```ts
export function demo(value: string) {
  return value.toUpperCase();
}
```

| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| pipe | x \| y | z     |

Footnote reference[^note] and unresolved reference[^missing].

[ref-link]: https://example.com/reference "Reference title"
[collapsed ref]: https://example.com/collapsed
[shortcut ref]: https://example.com/shortcut

[^note]: Footnote definition with back-reference.

---

### Long/viewport sentinel

This section is used by browser tests to scroll into late parsed content on tablet/mobile viewports.
