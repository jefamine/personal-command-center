import type { DocumentId, DocumentRecord } from "./documentContract";

export interface DocumentWikiLinkToken {
  readonly label: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

export type DocumentWikiLinkStatus = "resolved" | "ambiguous" | "unresolved" | "self";

export interface DocumentWikiLink {
  readonly status: DocumentWikiLinkStatus;
  readonly sourceDocumentId: DocumentId;
  readonly sourceTitle: string;
  readonly sourcePreview: string;
  readonly label: string;
  readonly order: number;
  readonly targetDocumentId?: DocumentId;
  readonly targetTitle?: string;
}

export interface DocumentWikiBacklink {
  readonly sourceDocumentId: DocumentId;
  readonly sourceTitle: string;
  readonly sourcePreview: string;
  readonly targetDocumentId: DocumentId;
  readonly order: number;
}

export interface DocumentWikiLinkIndex {
  readonly outgoing: readonly DocumentWikiLink[];
  readonly backlinks: readonly DocumentWikiBacklink[];
  outgoingFor(documentId: DocumentId): readonly DocumentWikiLink[];
  backlinksFor(documentId: DocumentId): readonly DocumentWikiBacklink[];
}

/** Normalizes titles for title-based wiki-link matching without changing their display form. */
export function normalizeDocumentWikiTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
}

/** Parses the first, document-only [[Title]] syntax without changing source text. */
export function parseDocumentWikiLinks(content: string): readonly DocumentWikiLinkToken[] {
  const tokens: DocumentWikiLinkToken[] = [];
  const pattern = /\[\[([^\]]*)\]\]/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > 0 && content[match.index - 1] === "!") continue;
    const label = match[1].trim();
    if (!label) continue;
    tokens.push({
      label,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return tokens;
}

function sourcePreview(content: string): string {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (!normalized) return "Пустой документ";
  return normalized.length > 160 ? `${normalized.slice(0, 159).trimEnd()}…` : normalized;
}

function documentsByNormalizedTitle(documents: readonly DocumentRecord[]) {
  const result = new Map<string, DocumentRecord[]>();
  documents.forEach((document) => {
    const key = normalizeDocumentWikiTitle(document.title);
    if (!key) return;
    const matches = result.get(key) ?? [];
    matches.push(document);
    result.set(key, matches);
  });
  return result;
}

/**
 * Computes first-slice document links and backlinks from canonical document
 * text. It intentionally does not persist graph relations or mutate records.
 */
export function buildDocumentWikiLinkIndex(
  documents: readonly DocumentRecord[]
): DocumentWikiLinkIndex {
  const byTitle = documentsByNormalizedTitle(documents);
  const outgoing: DocumentWikiLink[] = [];
  const backlinks: DocumentWikiBacklink[] = [];
  const backlinkPairs = new Set<string>();

  documents.forEach((source) => {
    parseDocumentWikiLinks(source.content).forEach((token, order) => {
      const matches = byTitle.get(normalizeDocumentWikiTitle(token.label)) ?? [];
      const base = {
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        label: token.label,
        order
      };

      if (matches.length === 0) {
        outgoing.push({ ...base, status: "unresolved" });
        return;
      }
      if (matches.length > 1) {
        outgoing.push({ ...base, status: "ambiguous" });
        return;
      }

      const target = matches[0];
      if (target.id === source.id) {
        outgoing.push({ ...base, status: "self", targetDocumentId: target.id, targetTitle: target.title });
        return;
      }

      outgoing.push({
        ...base,
        status: "resolved",
        targetDocumentId: target.id,
        targetTitle: target.title
      });
      const pair = `${source.id}\u0000${target.id}`;
      if (backlinkPairs.has(pair)) return;
      backlinkPairs.add(pair);
      backlinks.push({
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        targetDocumentId: target.id,
        order
      });
    });
  });

  return {
    outgoing,
    backlinks,
    outgoingFor: (documentId) => outgoing.filter((link) => link.sourceDocumentId === documentId),
    backlinksFor: (documentId) => backlinks.filter((link) => link.targetDocumentId === documentId)
  };
}
