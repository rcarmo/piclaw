import { useState } from "preact/hooks";
import { ImageLightbox } from "./ImageLightbox";

interface AttachmentChipProps {
  mediaId: number;
  filename: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

function isImageFilename(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

export function AttachmentChip({ mediaId, filename }: AttachmentChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const mediaUrl = `/media/${mediaId}`;
  const downloadUrl = `${mediaUrl}/download`;
  const isImage = isImageFilename(filename);

  const handlePreview = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isImage) {
      setShowPreview(true);
      return;
    }

    window.open(mediaUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="attachment-chip">
      <span className="attachment-chip__icon" aria-hidden="true">📎</span>
      <a
        className="attachment-chip__name"
        href={downloadUrl}
        download={filename}
        onClick={(e) => e.stopPropagation()}
      >
        {filename}
      </a>
      <button
        type="button"
        className="attachment-chip__preview"
        onClick={handlePreview}
        aria-label={`Preview ${filename}`}
      >
        <i className="codicon codicon-open-preview" />
      </button>
      {showPreview && isImage && (
        <ImageLightbox
          src={mediaUrl}
          alt={filename}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
