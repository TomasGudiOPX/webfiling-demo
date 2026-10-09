import { useEffect, useState, type ReactNode } from "react";
import * as mammoth from "mammoth/mammoth.browser";
import { renderMarkdown } from "./markdown";
import type { PreviewDescriptor } from "../types";

type Props = {
  fileId: string;
  preview: PreviewDescriptor;
  details?: ReactNode;
  downloadUrl?: string;
  expandedOnMount?: boolean;
  onDismiss?: () => void;
};
const source = (fileId: string) =>
  `/api/files/${encodeURIComponent(fileId)}/preview`;

function RemoteMarkdown({ url, fallback }: { url: string; fallback?: string }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setContent("");
    setError(null);
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((value) => {
        if (active) setContent(value);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el Markdown protegido.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, fallback]);
  return (
    <div className="markdown-preview">
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
      {error && <small>{error}</small>}
    </div>
  );
}
function DocxText({ url, fallback }: { url: string; fallback?: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setText("");
    setError(null);
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((response) =>
        response.ok ? response.arrayBuffer() : Promise.reject(),
      )
      .then((arrayBuffer) => mammoth.extractRawText({ arrayBuffer }))
      .then((result) => {
        if (active) setText(result.value);
      })
      .catch(() => {
        if (!active) return;
        setError("No se pudo leer el DOCX protegido.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);
  return (
    <div className="docx-preview">
      <strong>
        {fallback && !text ? "Leyendo DOCX…" : "Contenido del DOCX"}
      </strong>
      {text ? (
        <pre>{text}</pre>
      ) : (
        <small>{error ?? "Leyendo documento…"}</small>
      )}
    </div>
  );
}
function PreviewContent({
  url,
  preview,
}: {
  url: string;
  preview: PreviewDescriptor;
}) {
  if (preview.kind === "pdf")
    return (
      <div className="pdf-preview-box">
        <embed
          className="pdf-embed"
          src={url}
          type="application/pdf"
          title={preview.title}
        />
        <small>
          Vista previa PDF ·{" "}
          <a href={url} target="_blank" rel="noreferrer">
            abrir en pestaña nueva
          </a>
        </small>
      </div>
    );
  if (preview.kind === "image")
    return (
      <figure className="image-preview">
        <img src={url} alt={preview.title} />
        <figcaption>{preview.title}</figcaption>
      </figure>
    );
  if (preview.kind === "markdown")
    return <RemoteMarkdown url={url} fallback={preview.content} />;
  if (preview.kind === "docx")
    return <DocxText url={url} fallback={preview.content} />;
  return (
    <div className="unavailable-preview">
      <strong>{preview.title}</strong>
      <small>
        {preview.reason ??
          "Este formato no tiene vista previa; puede descargar el archivo."}
      </small>
    </div>
  );
}

export function DocumentPreview({ fileId, preview, details, downloadUrl, expandedOnMount = false, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(expandedOnMount);
  const url = source(fileId);
  const canExpand = preview.kind !== "unavailable" || Boolean(details);
  const dismiss = () => {
    setExpanded(false);
    onDismiss?.();
  };

  useEffect(() => {
    if (expandedOnMount) setExpanded(true);
  }, [expandedOnMount]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expanded, onDismiss]);

  return (
    <>
      {(canExpand || downloadUrl) && (
        <div
          className="preview-actions"
          role="group"
          aria-label="Acciones del archivo"
        >
          {downloadUrl && (
            <a
              className="preview-download"
              href={downloadUrl}
              aria-label="Descargar archivo"
              title="Descargar archivo"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </a>
          )}
          {canExpand && (
            <button
              type="button"
              aria-label="Ampliar vista"
              title="Ampliar vista"
              onClick={() => setExpanded(true)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </button>
          )}
        </div>
      )}
      <PreviewContent key={url} url={url} preview={preview} />
      {expanded && (
        <div
          className="preview-backdrop"
          role="presentation"
          onMouseDown={dismiss}
        >
          <section
            className="preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Vista ampliada: ${preview.title}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{preview.title}</strong>
              <button
                type="button"
                autoFocus
                onClick={dismiss}
              >
                Cerrar
              </button>
            </header>
            <div className={`preview-dialog-content ${details ? "has-details" : ""}`}>
              {details && <div className="preview-dialog-details">{details}</div>}
              <div className="preview-dialog-document">
                <PreviewContent url={url} preview={preview} />
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
