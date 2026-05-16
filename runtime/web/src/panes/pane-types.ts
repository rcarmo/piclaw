/**
 * pane-types.ts — Core type definitions for the WebPaneExtension system.
 *
 * Defines the contract between the host app and pane extensions.
 * Panes are content-area UI components (editors, viewers, terminal)
 * managed by a PaneRegistry.
 */

/** Where a pane lives in the content area */
export type PanePlacement = "tabs" | "dock";

/** What a pane can do */
export type PaneCapability = "edit" | "readonly" | "terminal" | "preview";

/**
 * Context passed to a pane when mounting.
 * For file-based panes: path, content, mtime, size.
 * For non-file panes (terminal): path is undefined.
 */
export interface PaneContext {
    /** File path (undefined for non-file panes like terminal). */
    path?: string;
    /** File content as string. */
    content?: string;
    /** Last-modified timestamp (ISO string or epoch). */
    mtime?: string;
    /** File size in bytes. */
    size?: number;
    /** Whether the content is from an unsaved restore (editor should mark as dirty). */
    dirty?: boolean;
    /** Optional preview payload for read-only workspace/file previews. */
    preview?: Record<string, unknown>;
    /** Optional host-transfer payload consumed by panes that support detach/reattach handoff. */
    transferState?: Record<string, unknown>;
    /** Whether the pane should open in edit or read-only mode. */
    mode: "edit" | "view";
}

export interface PaneHostDetachContext {
    /** Logical pane path being detached. */
    path?: string;
    /** Current transfer target requested by the host. */
    target: "popout";
}

export interface PaneHostAttachContext {
    /** Logical pane path now attached to this host. */
    path?: string;
    /** Whether the receiving host is the main shell or a standalone pane shell. */
    hostMode: "main" | "popout";
    /** Optional transfer state payload consumed during attach. */
    transferState?: Record<string, unknown> | null;
}

/**
 * A mounted pane instance. The host communicates with the pane
 * through this interface after mount().
 */
export interface PaneInstance {
    /** Get current content (file panes). Terminal returns undefined. */
    getContent(): string | undefined;

    /** Whether the pane has unsaved changes. */
    isDirty(): boolean;

    /** Host → Pane: update content after external change (e.g., file reload). */
    setContent?(content: string, mtime: string): void;

    /** Host → Pane: give this pane keyboard focus. */
    focus(): void;

    /** Host → Pane: container was resized, re-layout if needed. */
    resize?(): void;

    /** Tear down the pane, remove DOM, detach listeners. */
    dispose(): void;

    /** Register callback for dirty state changes. */
    onDirtyChange?(cb: (dirty: boolean) => void): void;

    /** Register callback for save requests (e.g., Cmd+S). */
    onSaveRequest?(cb: (content: string) => void): void;

    /** Register callback for close requests. */
    onClose?(cb: () => void): void;

    /** Optional lifecycle hook before the host detaches this pane. */
    beforeDetachFromHost?(context: PaneHostDetachContext): Promise<void> | void;

    /** Optional lifecycle hook after the pane attaches to a host. */
    afterAttachToHost?(context: PaneHostAttachContext): Promise<void> | void;

    /** Optional live host-transfer hook to move this pane instance into a new host container. */
    moveHost?(container: HTMLElement, context: PaneHostAttachContext): Promise<boolean> | boolean;

    /**
     * Optional generic host-transfer export hook.
     * Lets a pane hand state to a newly mounted host without encoding that
     * state directly into the URL.
     */
    exportHostTransferState?(): Record<string, unknown> | null;

    /**
     * Optional pre-popout hook. Lets a pane prepare transferable session state
     * and return extra query parameters for the destination window.
     */
    preparePopoutTransfer?(): Promise<Record<string, string> | null> | Record<string, string> | null;
}

/**
 * Extension that provides a content pane.
 *
 * - placement: "tabs" — file editors/viewers, swapped on tab switch
 * - placement: "dock" — persistent bottom panel (terminal), toggled visible/hidden
 */
export interface WebPaneExtension {
    /** Unique identifier for this pane type. */
    id: string;

    /** Human-readable label (shown in tabs, menus). */
    label: string;

    /** Optional icon identifier or SVG string. */
    icon?: string;

    /** What this pane can do. */
    capabilities: PaneCapability[];

    /** Where this pane lives: "tabs" (content area) or "dock" (bottom panel). */
    placement: PanePlacement;

    /**
     * For "tabs" panes: can this pane handle the given context?
     * Return true/false, or a priority number (higher wins).
     * Not called for "dock" panes.
     */
    canHandle?(context: PaneContext): boolean | number;

    /**
     * Mount the pane into a container element.
     * Returns a PaneInstance for host ↔ pane communication.
     */
    mount(container: HTMLElement, context: PaneContext): PaneInstance;
}
