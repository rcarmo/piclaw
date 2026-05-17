import { h, type JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ModalDialog } from "../components/ModalDialog";

export interface PromptOptions { title: string; description?: string; placeholder?: string; defaultValue?: string; }
export interface ConfirmOptions { title: string; description?: string; confirmLabel?: string; destructive?: boolean; }
export interface AlertOptions { title: string; description?: string; }

type DialogRequest =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void; settled: boolean }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void; settled: boolean }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void; settled: boolean };

const queue: DialogRequest[] = [];
let active: DialogRequest | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function enqueue(d: DialogRequest) {
  if (!active) { active = d; notify(); } else queue.push(d);
}

function settle(d: DialogRequest, fn: () => void) {
  if (d.settled) return;
  d.settled = true;
  fn();
  active = queue.shift() ?? null;
  notify();
}

function showPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: "prompt", opts, resolve, settled: false }));
}

function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: "confirm", opts, resolve, settled: false }));
}

function showAlert(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => enqueue({ kind: "alert", opts, resolve, settled: false }));
}

function DialogHost(): JSX.Element {
  const [dialog, setDialog] = useState<DialogRequest | null>(active);
  useEffect(() => {
    const handler = () => setDialog(active);
    subs.add(handler);
    return () => { subs.delete(handler); };
  }, []);

  if (!dialog) return null;

  if (dialog.kind === "prompt") {
    return h(ModalDialog, {
      mode: "prompt",
      title: dialog.opts.title,
      description: dialog.opts.description,
      placeholder: dialog.opts.placeholder,
      defaultValue: dialog.opts.defaultValue,
      confirmLabel: "Save",
      onConfirm: (value) => settle(dialog, () => dialog.resolve(value?.trim() ? value : null)),
      onCancel: () => settle(dialog, () => dialog.resolve(null)),
    });
  }

  if (dialog.kind === "confirm") {
    return h(ModalDialog, {
      mode: "confirm",
      title: dialog.opts.title,
      description: dialog.opts.description,
      confirmLabel: dialog.opts.confirmLabel ?? "Confirm",
      destructive: dialog.opts.destructive,
      onConfirm: () => settle(dialog, () => dialog.resolve(true)),
      onCancel: () => settle(dialog, () => dialog.resolve(false)),
    });
  }

  return h(ModalDialog, {
    mode: "alert",
    title: dialog.opts.title,
    description: dialog.opts.description,
    confirmLabel: "OK",
    onConfirm: () => settle(dialog, () => dialog.resolve()),
    onCancel: () => settle(dialog, () => dialog.resolve()),
  });
}

export function useDialog(): {
  showPrompt: (opts: PromptOptions) => Promise<string | null>;
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  showAlert: (opts: AlertOptions) => Promise<void>;
  DialogHost: () => JSX.Element;
} {
  return { showPrompt, showConfirm, showAlert, DialogHost };
}
