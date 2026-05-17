interface ExtensionFrameProps {
  extensionPageUrl: string | null;
  extensionPageName: string | null;
  extensionPageHtml: string | null;
  onBack: () => void;
}

export function ExtensionFrame({ extensionPageUrl, extensionPageName, extensionPageHtml, onBack }: ExtensionFrameProps) {
  return (
    <div className="extension-frame">
      <div className="extension-frame__header">
        <button
          type="button"
          className="extension-frame__back-btn"
          onClick={onBack}
        >
          <i className="codicon codicon-arrow-left" />
          {" "}Back to Chat
        </button>
        <span className="extension-frame__title">{extensionPageName}</span>
      </div>
      {extensionPageHtml === '__pdf__' ? (
        <object
          data={extensionPageUrl!}
          type="application/pdf"
          className="extension-frame__pdf-object"
          aria-label={extensionPageName ?? 'PDF'}
        >
          <div className="extension-frame__pdf-fallback">
            <p>PDF cannot be displayed.</p>
            <a href={extensionPageUrl!} target="_blank" rel="noopener noreferrer" className="extension-frame__pdf-link">Open PDF in new tab</a>
          </div>
        </object>
      ) : extensionPageHtml ? (
        <div
          className="workspace__preview-markdown extension-frame__markdown"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown sanitized by markdown-pipeline
          dangerouslySetInnerHTML={{ __html: extensionPageHtml }}
        />
      ) : (
        <>
          {/* Security: allow-same-origin required for extension API access. allow-scripts required for interactivity. Popups restricted. See #168. */}
          <iframe
            className="extension-frame__iframe"
            src={extensionPageUrl!}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            title={extensionPageName ?? "Extension Page"}
          />
        </>
      )}
    </div>
  );
}
