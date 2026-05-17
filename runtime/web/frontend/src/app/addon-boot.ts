/**
 * addon-boot.ts — Exposes globals for addon web bundles and loads installed addon entries.
 *
 * This must run BEFORE addon web bundles load. It sets:
 *   - globalThis.__piclawSettingsPaneRegistry
 *   - globalThis.__piclaw_web
 *   - globalThis.__piclawPreactHtm / globalThis.__piclawPreact
 *
 * Then fetches and loads addon web bundle entries from /agent/addons/web-entries.
 */

import { h, render, Component } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { html as htmHtml } from 'htm/preact';
import {
    registerSettingsPane,
    unregisterSettingsPane,
    notifySettingsPanesChanged,
} from '../panels/settings/pane-registry';

const html: unknown = htmHtml;

let addonBootDone = false;
let addonLoadPromise: Promise<void> | null = null;

function normalizeUrl(value: unknown, base: string): string | null {
    const input = typeof value === 'string' ? value.trim() : '';
    if (!input) return null;
    try {
        return new URL(input, base).href;
    } catch {
        return null;
    }
}

/** Install globalThis bindings used by addon web bundles. */
export function installAddonGlobals(): void {
    if (typeof globalThis === 'undefined') return;

    const settingsPaneRegistry = {
        registerSettingsPane: (def: unknown) => {
            registerSettingsPane(def as Parameters<typeof registerSettingsPane>[0]);
            notifySettingsPanesChanged();
            return () => {
                unregisterSettingsPane((def as { id: string }).id);
                notifySettingsPanesChanged();
            };
        },
        unregisterSettingsPane,
        notifySettingsPanesChanged,
    };

    (globalThis as Record<string, unknown>).__piclawSettingsPaneRegistry = settingsPaneRegistry;

    // __piclaw_web surface (settings pane registration + more)
    (globalThis as Record<string, unknown>).__piclaw_web = {
        registerSettingsPane: settingsPaneRegistry.registerSettingsPane,
    };

    // Preact + htm globals for addon web bundles that use HTM syntax
    const preactHtm = {
        h,
        html,
        render,
        Component,
        useState,
        useEffect,
        useRef,
        useCallback,
        useMemo,
    };
    (globalThis as Record<string, unknown>).__piclawPreactHtm = preactHtm;
    (globalThis as Record<string, unknown>).__piclawPreact = preactHtm;
}

/** Load all installed addon web bundle entries. */
export async function loadAddonWebEntries(): Promise<void> {
    if (addonLoadPromise) return addonLoadPromise;

    addonLoadPromise = (async () => {
        installAddonGlobals();
        try {
            const response = await fetch('/agent/addons/web-entries', { credentials: 'same-origin' });
            if (!response.ok) return;
            const payload = await response.json().catch(() => null);
            const entries: unknown[] = Array.isArray(payload?.entries) ? payload.entries : [];
            const origin = typeof window !== 'undefined' ? (window.location?.origin || 'http://localhost') : 'http://localhost';
            for (const entry of entries) {
                const href = normalizeUrl((entry as Record<string, unknown>)?.url, origin);
                if (!href) continue;
                await loadScript(href);
            }
        } catch (error) {
            console.warn('[addon-boot] Failed to fetch addon web entries:', error);
        }
    })();

    return addonLoadPromise;
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = src;
        script.onload = () => resolve();
        script.onerror = (err) => {
            console.warn('[addon-boot] Failed to load addon web bundle:', src, err);
            resolve(); // Don't reject — skip broken addons
        };
        document.head.appendChild(script);
    });
}

/** Initialize addon boot once. Must be called before addon bundles load. */
export function initAddonBoot(): void {
    if (addonBootDone) return;
    addonBootDone = true;
    installAddonGlobals();
    void loadAddonWebEntries();
}
