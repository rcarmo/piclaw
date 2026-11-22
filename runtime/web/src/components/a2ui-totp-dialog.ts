import { html, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';

export type TotpPresentation = { manual_code: string; qr: string; expires_at: number };

/** This response is never part of the post, data bindings, or exported transcript. */
export function readTotpPresentation(response: unknown): TotpPresentation | undefined {
    const value = response && typeof response === 'object' ? (response as { totp_presentation?: Partial<TotpPresentation> }).totp_presentation : undefined;
    if (!value || typeof value.manual_code !== 'string' || !/^[A-Z2-7]{8,128}$/.test(value.manual_code)
        || typeof value.qr !== 'string' || value.qr.length > 200_000 || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/.test(value.qr)
        || typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at) || value.expires_at <= Date.now()) return undefined;
    return { manual_code: value.manual_code, qr: value.qr, expires_at: value.expires_at };
}

export function A2uiTotpDialog({ presentation, dismiss, confirm }: {
    presentation: TotpPresentation;
    dismiss(): void;
    confirm(code: string): Promise<void>;
}) {
    const dialog = useRef<HTMLDialogElement | null>(null);
    const input = useRef<HTMLInputElement | null>(null);
    const submitting = useRef(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    useLayoutEffect(() => {
        const element = dialog.current!;
        element.showModal();
        const timer = setTimeout(dismiss, Math.max(0, presentation.expires_at - Date.now()));
        return () => { clearTimeout(timer); if (element.open) element.close(); };
    }, [presentation.expires_at, dismiss]);
    async function submit(event: SubmitEvent) {
        event.preventDefault(); event.stopPropagation();
        if (submitting.current || !input.current) return;
        const code = input.current.value;
        input.current.value = '';
        submitting.current = true; setPending(true); setError('');
        try { await confirm(code); dismiss(); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not confirm TOTP.'); }
        finally { submitting.current = false; setPending(false); }
    }
    return html`<dialog ref=${dialog} class="a2ui-surface a2ui-private-dialog" data-no-session-dashboard-shortcut="" aria-label="TOTP enrolment"
        onCancel=${(event: Event) => { event.preventDefault(); dismiss(); }}>
        <form class="a2ui-column" onSubmit=${submit} aria-busy=${pending}>
            <strong>TOTP enrolment</strong>
            <span>Scan the QR code or enter the manual key in your authenticator.</span>
            <img src=${presentation.qr} alt="TOTP enrolment QR code" width="160" height="160" />
            <div>Manual key: <code>${presentation.manual_code}</code></div>
            <label class="a2ui-field">Six-digit code
                <input ref=${input} inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" disabled=${pending} />
            </label>
            ${error && html`<p class="a2ui-error" role="alert">${error}</p>`}
            <div class="a2ui-row">
                <button type="submit" class="a2ui-button a2ui-button-primary" disabled=${pending}>Confirm</button>
                <button type="button" class="a2ui-button" onClick=${dismiss}>Close</button>
            </div>
        </form>
    </dialog>`;
}
