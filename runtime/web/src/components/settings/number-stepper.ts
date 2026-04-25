// @ts-nocheck
import { html, useCallback } from '../../vendor/preact-htm.js';

function toFiniteNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNumberValue(value, { min = -Infinity, max = Infinity } = {}) {
    const parsedMin = Number.isFinite(Number(min)) ? Number(min) : -Infinity;
    const parsedMax = Number.isFinite(Number(max)) ? Number(max) : Infinity;
    return Math.min(parsedMax, Math.max(parsedMin, Number(value)));
}

export function normalizeNumberValue(value, { fallback = 0, min = -Infinity, max = Infinity } = {}) {
    const next = toFiniteNumber(value, fallback);
    return clampNumberValue(next, { min, max });
}

export function stepNumberValue(value, {
    direction = 1,
    step = 1,
    fallback = 0,
    min = -Infinity,
    max = Infinity,
} = {}) {
    const base = normalizeNumberValue(value, { fallback, min, max });
    const delta = Math.abs(toFiniteNumber(step, 1)) || 1;
    const signedDirection = Number(direction) < 0 ? -1 : 1;
    return clampNumberValue(base + (signedDirection * delta), { min, max });
}

export function NumberStepper({
    value,
    min,
    max,
    step = 1,
    fallback,
    width = '80px',
    disabled = false,
    label,
    onChange,
}) {
    const effectiveFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : normalizeNumberValue(value, { fallback: 0, min, max });
    const commitValue = useCallback((next) => {
        const normalized = normalizeNumberValue(next, { fallback: effectiveFallback, min, max });
        onChange?.(normalized);
    }, [effectiveFallback, min, max, onChange]);

    const nudge = useCallback((direction) => {
        const next = stepNumberValue(value, { direction, step, fallback: effectiveFallback, min, max });
        onChange?.(next);
    }, [effectiveFallback, max, min, onChange, step, value]);

    return html`
        <span class="settings-number-stepper">
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Decrease ${label || 'value'}`}
                title=${`Decrease ${label || 'value'}`}
                disabled=${disabled}
                onClick=${() => nudge(-1)}
            >−</button>
            <input
                class="settings-number-input"
                type="number"
                value=${value}
                min=${min}
                max=${max}
                step=${step}
                disabled=${disabled}
                style=${`width:${width}`}
                onInput=${(e) => commitValue(e.target.value)}
            />
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Increase ${label || 'value'}`}
                title=${`Increase ${label || 'value'}`}
                disabled=${disabled}
                onClick=${() => nudge(1)}
            >+</button>
        </span>
    `;
}
