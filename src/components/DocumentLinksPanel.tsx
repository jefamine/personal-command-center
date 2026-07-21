import { ArrowUpRight, Link2 } from "lucide-react";
import type { DocumentId, DocumentRecord } from "../domain/documents/documentContract";
import type { DocumentWikiLinkIndex } from "../domain/documents/documentWikiLinks";

interface DocumentLinksPanelProps {
  document: DocumentRecord;
  index: DocumentWikiLinkIndex;
  onOpenDocument: (id: DocumentId) => void;
}

function linkStatusText(status: "resolved" | "ambiguous" | "unresolved" | "self"): string {
  if (status === "resolved") return "Ссылка пока не может быть открыта.";
  if (status === "ambiguous") return "Название не уникально — переименуйте один из документов.";
  if (status === "self") return "Ссылка на этот же документ.";
  return "Документ с таким названием пока не найден.";
}

/** Read-only presentation of the computed [[Title]] links for one document. */
export function DocumentLinksPanel({ document, index, onOpenDocument }: DocumentLinksPanelProps) {
  const outgoing = index.outgoingFor(document.id);
  const backlinks = index.backlinksFor(document.id);

  return (
    <div className="document-links-panel">
      <section>
        <header><Link2 size={15} /><strong>Ссылки из документа</strong></header>
        {outgoing.length ? (
          <div className="document-links-list">
            {outgoing.map((link) => {
              const targetDocumentId = link.targetDocumentId;
              return link.status === "resolved" && targetDocumentId ? (
                <button type="button" key={`${link.order}-${link.label}`} onClick={() => onOpenDocument(targetDocumentId)}>
                  <span>[[{link.label}]]</span><ArrowUpRight size={14} />
                </button>
              ) : (
                <div className={`document-link-status is-${link.status}`} key={`${link.order}-${link.label}`}>
                  <strong>[[{link.label}]]</strong><small>{linkStatusText(link.status)}</small>
                </div>
              );
            })}
          </div>
        ) : <p className="document-links-empty">В тексте пока нет внутренних ссылок.</p>}
      </section>

      <section>
        <header><Link2 size={15} /><strong>Ссылаются сюда</strong></header>
        {backlinks.length ? (
          <div className="document-backlinks-list">
            {backlinks.map((link) => (
              <button type="button" key={`${link.sourceDocumentId}-${link.order}`} onClick={() => onOpenDocument(link.sourceDocumentId)}>
                <strong>{link.sourceTitle || "Без названия"}</strong>
                <small>{link.sourcePreview}</small>
              </button>
            ))}
          </div>
        ) : <p className="document-links-empty">Пока ни один документ не ссылается сюда.</p>}
      </section>
    </div>
  );
}
