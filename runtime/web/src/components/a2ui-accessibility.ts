export type A2uiAria = Partial<Record<'aria-label' | 'aria-description' | 'aria-live' | 'aria-hidden', string>>;

/** Project only the v1.0 accessibility fields, not arbitrary DOM attributes. */
export function a2uiAria(descriptor: unknown, read: (value: unknown) => unknown): A2uiAria {
    if (!descriptor || typeof descriptor !== 'object') return {};
    const { label, description, live, hidden } = descriptor as Record<string, unknown>;
    const attrs: A2uiAria = {};
    const name = read(label), detail = read(description), hide = read(hidden);
    if (typeof name === 'string' && name) attrs['aria-label'] = name;
    if (typeof detail === 'string' && detail) attrs['aria-description'] = detail;
    if (live === 'off' || live === 'polite' || live === 'assertive') attrs['aria-live'] = live;
    if (typeof hide === 'boolean') attrs['aria-hidden'] = String(hide);
    return attrs;
}
