import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { copyToClipboard } from "../utils/clipboard";

interface CopyButtonProps {
  text: string;
  className?: string;
  copiedClassName?: string;
  title?: string;
  children?: ComponentChildren;
  flashEvent?: boolean;
}

/** Reusable copy-to-clipboard button with brief feedback. */
export function CopyButton({ text, className, copiedClassName, title = "Copy", children, flashEvent = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(text);
    if (flashEvent) {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", {
        detail: { message: ok ? "Copied to clipboard" : "Copy failed", type: ok ? "success" : "error" },
      }));
    } else if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const cls = copied && copiedClassName ? `${className ?? ""} ${copiedClassName}`.trim() : className;

  return (
    <button type="button" className={cls} aria-label={copied ? "Copied!" : title} title={copied ? "Copied!" : title} onClick={handleClick}>
      {copied ? "✓" : (children ?? "Copy")}
    </button>
  );
}
