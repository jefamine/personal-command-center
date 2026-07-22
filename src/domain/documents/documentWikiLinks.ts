import type { DocumentId, DocumentRecord } from "./documentContract";

export type DocumentWikiReferenceKind = "link" | "embed";

export interface DocumentWikiLinkToken {
  readonly kind: DocumentWikiReferenceKind;
  readonly label: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

export type DocumentWikiLinkStatus = "resolved" | "ambiguous" | "unresolved" | "self";

export interface DocumentWikiLink {
  readonly status: DocumentWikiLinkStatus;
  readonly kind: DocumentWikiReferenceKind;
  readonly sourceDocumentId: DocumentId;
  readonly sourceTitle: string;
  readonly sourcePreview: string;
  readonly label: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly order: number;
  readonly targetDocumentId?: DocumentId;
  readonly targetTitle?: string;
}

export interface DocumentWikiBacklink {
  readonly sourceDocumentId: DocumentId;
  readonly sourceTitle: string;
  readonly sourcePreview: string;
  readonly targetDocumentId: DocumentId;
  readonly kind: DocumentWikiReferenceKind;
  readonly order: number;
}

export interface DocumentWikiLinkIndex {
  readonly outgoing: readonly DocumentWikiLink[];
  readonly backlinks: readonly DocumentWikiBacklink[];
  outgoingFor(documentId: DocumentId): readonly DocumentWikiLink[];
  linksFor(documentId: DocumentId): readonly DocumentWikiLink[];
  embedsFor(documentId: DocumentId): readonly DocumentWikiLink[];
  backlinksFor(documentId: DocumentId): readonly DocumentWikiBacklink[];
}

/** Normalizes titles for title-based discovery without changing their display form. */
export function normalizeDocumentWikiTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
}

/** Parses document-only [[Title]] and ![[Title]] references without changing source text. */
export function parseDocumentWikiReferences(content: string): readonly DocumentWikiLinkToken[] {
  const tokens: DocumentWikiLinkToken[] = [];
  const pattern = /(!)?\[\[([^\]]*)\]\]/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const label = match[2].trim();
    if (!label) continue;
    const kind: DocumentWikiReferenceKind = match[1] ? "embed" : "link";
    tokens.push({
      kind,
      label,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

/** Backward-compatible link-only parser. Embeds are deliberately excluded. */
export function parseDocumentWikiLinks(content: string): readonly DocumentWikiLinkToken[] {
  return parseDocumentWikiReferences(content).filter((token) => token.kind === "link");
}

export type DocumentEmbedTraversalState = "render" | "cycle" | "depth-limit";

export function documentEmbedTraversalState(
  targetId: DocumentId,
  visited: ReadonlySet<DocumentId>,
  depth: number,
  maxDepth = 3
): DocumentEmbedTraversalState {
  if (visited.has(targetId)) return "cycle";
  if (depth >= maxDepth) return "depth-limit";
  return "render";
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
    result.set(key, [...(result.get(key) ?? []), document]);
  });
  return result;
}

/** Builds a disposable reference index solely from current document records and canonical text. */
export function buildDocumentWikiLinkIndex(
  documents: readonly DocumentRecord[]
): DocumentWikiLinkIndex {
  const byTitle = documentsByNormalizedTitle(documents);
  const outgoing: DocumentWikiLink[] = [];
  const backlinks: DocumentWikiBacklink[] = [];
  const backlinkPairs = new Set<string>();

  documents.forEach((source) => {
    parseDocumentWikiReferences(source.content).forEach((token, order) => {
      const matches = byTitle.get(normalizeDocumentWikiTitle(token.label)) ?? [];
      const base = {
        kind: token.kind,
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        label: token.label,
        raw: token.raw,
        start: token.start,
        end: token.end,
        order
      } as const;

      if (matches.length === 0) {
        outgoing.push({ ...base, status: "unresolved" });
        return;
      }
      if (matches.length > 1) {
        outgoing.push({ ...base, status: "ambiguous" });
        return;
      }

      const target = matches[0];
      const status: DocumentWikiLinkStatus = target.id === source.id ? "self" : "resolved";
      outgoing.push({
        ...base,
        status,
        targetDocumentId: target.id,
        targetTitle: target.title
      });
      if (status !== "resolved") return;

      const pair = `${source.id}\u0000${target.id}\u0000${token.kind}`;
      if (backlinkPairs.has(pair)) return;
      backlinkPairs.add(pair);
      backlinks.push({
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        targetDocumentId: target.id,
        kind: token.kind,
        order
      });
    });
  });

  return {
    outgoing,
    backlinks,
    outgoingFor: (id) => outgoing.filter((reference) => reference.sourceDocumentId === id),
    linksFor: (id) => outgoing.filter((reference) => reference.sourceDocumentId === id && reference.kind === "link"),
    embedsFor: (id) => outgoing.filter((reference) => reference.sourceDocumentId === id && reference.kind === "embed"),
    backlinksFor: (id) => backlinks.filter((reference) => reference.targetDocumentId === id)
  };
}
