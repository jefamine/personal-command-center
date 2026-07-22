import { ArrowUpRight, FileStack, Link2 } from "lucide-react";
import type { DocumentId, DocumentRecord } from "../domain/documents/documentContract";
import type {
  DocumentWikiLink,
  DocumentWikiLinkIndex,
  DocumentWikiLinkStatus
} from "../domain/documents/documentWikiLinks";
import { documentEmbedTraversalState } from "../domain/documents/documentWikiLinks";

interface DocumentLinksPanelProps {
  document: DocumentRecord;
  documents: readonly DocumentRecord[];
  index: DocumentWikiLinkIndex;
  onOpenDocument: (id: DocumentId) => void;
}

const MAX_EMBED_DEPTH = 3;

function linkStatusText(status: DocumentWikiLinkStatus): string {
  if (status === "ambiguous") return "Название не уникально. Переименуйте один из документов.";
  if (status === "self") return "Ссылка ведёт на этот же документ.";
  return "Документ с таким названием пока не найден.";
}

function EmbedPreview({
  reference,
  documents,
  index,
  onOpenDocument,
  visited,
  depth
}: {
  reference: DocumentWikiLink;
  documents: readonly DocumentRecord[];
  index: DocumentWikiLinkIndex;
  onOpenDocument: (id: DocumentId) => void;
  visited: ReadonlySet<DocumentId>;
  depth: number;
}) {
  const targetId = reference.targetDocumentId;
  const target = targetId ? documents.find((entry) => entry.id === targetId) : null;
  if ((reference.status !== "resolved" && reference.status !== "self") || !targetId || !target) {
    return (
      <div className={`document-embed-card is-${reference.status}`}>
        <strong>![[{reference.label}]]</strong>
        <small>{linkStatusText(reference.status)}</small>
      </div>
    );
  }

  const traversal = documentEmbedTraversalState(targetId, visited, depth, MAX_EMBED_DEPTH);
  const nextVisited = new Set(visited);
  nextVisited.add(targetId);

  return (
    <article className="document-embed-card">
      <header>
        <div>
          <strong>{target.title || "Без названия"}</strong>
          <small>{target.kind === "material" ? "Материал · только чтение" : "Документ · только чтение"}</small>
        </div>
        <button type="button" onClick={() => onOpenDocument(targetId)}>
          <ArrowUpRight size={14} /> Открыть
        </button>
      </header>
      {traversal === "cycle" ? <p>Циклическое встраивание</p> : traversal === "depth-limit" ? (
        <p>Откройте документ, чтобы продолжить просмотр</p>
      ) : (
        <>
          <div className="document-embed-content">{target.content.slice(0, 1200) || "Пустой документ"}</div>
          {index.embedsFor(targetId).map((nested) => (
            <EmbedPreview
              key={`${nested.order}-${nested.label}`}
              reference={nested}
              documents={documents}
              index={index}
              onOpenDocument={onOpenDocument}
              visited={nextVisited}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </article>
  );
}

/** Computed links, backlinks and read-only live embeds for one document. */
export function DocumentLinksPanel({
  document,
  documents,
  index,
  onOpenDocument
}: DocumentLinksPanelProps) {
  const outgoing = index.linksFor(document.id);
  const embeds = index.embedsFor(document.id);
  const backlinks = index.backlinksFor(document.id);

  return (
    <div className="document-links-panel">
      {embeds.length ? (
        <section className="document-embeds-section">
          <header><FileStack size={15} /><strong>Встроенные документы</strong></header>
          <div className="document-embeds-list">
            {embeds.map((reference) => (
              <EmbedPreview
                key={`${reference.order}-${reference.label}`}
                reference={reference}
                documents={documents}
                index={index}
                onOpenDocument={onOpenDocument}
                visited={new Set([document.id])}
                depth={0}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <header><Link2 size={15} /><strong>Ссылки из документа</strong></header>
        {outgoing.length ? (
          <div className="document-links-list">
            {outgoing.map((link) => {
              const targetDocumentId = link.targetDocumentId;
              return link.status === "resolved" && targetDocumentId ? (
                <button type="button" key={`${link.order}-${link.label}`} onClick={() => onOpenDocument(targetDocumentId)}>
                  <span>[[{link.targetTitle ?? link.label}]]</span><ArrowUpRight size={14} />
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
              <button type="button" key={`${link.sourceDocumentId}-${link.kind}-${link.order}`} onClick={() => onOpenDocument(link.sourceDocumentId)}>
                <strong>{link.sourceTitle || "Без названия"}</strong>
                <small>{link.kind === "embed" ? "Встроено · " : ""}{link.sourcePreview}</small>
              </button>
            ))}
          </div>
        ) : <p className="document-links-empty">Пока ни один документ не ссылается сюда.</p>}
      </section>
    </div>
  );
}
