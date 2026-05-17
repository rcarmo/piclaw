/**
 * FileIcon.tsx — File/folder icon component.
 *
 * For files: renders a Seti icon font glyph via seti-icons.css.
 * For folders: renders a VS Code codicon (folder / folder-opened).
 *
 * Usage:
 *   <FileIcon filename="main.ts" />
 *   <FileIcon filename="src" isFolder={true} open={true} />
 */

import { getFileIconClass } from "../utils/file-icons";

interface FileIconProps {
  filename: string;
  isFolder?: boolean;
  open?: boolean;
  className?: string;
}

export function FileIcon({ filename, isFolder = false, open = false, className = "" }: FileIconProps) {
  if (isFolder) {
    const codiconName = open ? "folder-opened" : "folder";
    const classes = ["codicon", `codicon-${codiconName}`, className].filter(Boolean).join(" ");
    return <span className={classes} aria-hidden="true" />;
  }

  const iconClass = getFileIconClass(filename);
  const classes = [iconClass, className].filter(Boolean).join(" ");
  return <span className={classes} aria-hidden="true" />;
}
