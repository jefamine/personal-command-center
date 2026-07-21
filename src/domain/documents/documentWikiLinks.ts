import type { ObjectRelation, WikiRelationBinding } from "../objects/objectGraph";
import type { DocumentId, DocumentRecord } from "./documentContract";

export type DocumentWikiReferenceKind = "link" | "embed";

export interface DocumentWikiLinkToken {
  readonly kind: DocumentWikiReferenceKind;
  readonly label: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly occurrence: number;
  readonly contextFingerprint: string;
}

export type DocumentWikiLinkStatus = "resolved" | "ambiguous" | "unresolved" | "self" | "unbound";

export interface DocumentWikiLink {
  readonly status: DocumentWikiLinkStatus;
  readonly kind: DocumentWikiReferenceKind;
  readonly sourceDocumentId: DocumentId;
  readonly sourceTitle: string;
  readonly sourcePreview: string;
  readonly label: string;
  readonly order: number;
  readonly bound: boolean;
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

export type WikiBindingMatch =
  | { readonly status: "matched"; readonly token: DocumentWikiLinkToken }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly candidates: readonly DocumentWikiLinkToken[] };

/** Normalizes titles for title-based discovery without changing their display form. */
export function normalizeDocumentWikiTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
}

function normalizedContext(value: string): string {
  return value
    .replace(/!?\[\[[^\]]*\]\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ru");
}

/** A small deterministic context signature. It contains no document identity or copied body. */
export function documentReferenceFingerprint(content: string, start: number, end: number): string {
  const before = normalizedContext(content.slice(Math.max(0, start - 48), start));
  const after = normalizedContext(content.slice(end, Math.min(content.length, end + 48)));
  const context = `${before}\u0001${after}`;
  let hash = 2166136261;
  for (let index = 0; index < context.length; index += 1) {
    hash ^= context.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(36)}`;
}

/** Parses document-only [[Title]] and ![[Title]] references without changing source text. */
export function parseDocumentWikiReferences(content: string): readonly DocumentWikiLinkToken[] {
  const tokens: DocumentWikiLinkToken[] = [];
  const occurrences = new Map<string, number>();
  const pattern = /(!)?\[\[([^\]]*)\]\]/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const label = match[2].trim();
    if (!label) continue;
    const kind: DocumentWikiReferenceKind = match[1] ? "embed" : "link";
    const key = `${kind}\u0000${normalizeDocumentWikiTitle(label)}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    tokens.push({
      kind,
      label,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      occurrence,
      contextFingerprint: documentReferenceFingerprint(content, match.index, match.index + match[0].length)
    });
  }
  return tokens;
}

/** Backward-compatible link-only parser. Embeds are deliberately excluded. */
export function parseDocumentWikiLinks(content: string): readonly DocumentWikiLinkToken[] {
  return parseDocumentWikiReferences(content).filter((token) => token.kind === "link");
}

export function wikiBindingForToken(token: DocumentWikiLinkToken): WikiRelationBinding {
  return {
    labelAtBinding: token.label,
    occurrence: token.occurrence,
    lastKnownStart: token.start,
    lastKnownEnd: token.end,
    contextFingerprint: token.contextFingerprint
  };
}

/**
 * Matches conservatively: exact former location wins; otherwise context must
 * identify one candidate. Occurrence alone never silently rebinds a target.
 */
export function matchWikiBinding(
  binding: WikiRelationBinding,
  kind: DocumentWikiReferenceKind,
  tokens: readonly DocumentWikiLinkToken[],
  used: ReadonlySet<number> = new Set()
): WikiBindingMatch {
  const label = normalizeDocumentWikiTitle(binding.labelAtBinding);
  const candidates = tokens.filter((token, index) =>
    !used.has(index) && token.kind === kind && normalizeDocumentWikiTitle(token.label) === label
  );
  const exact = candidates.filter((token) =>
    token.start === binding.lastKnownStart && token.end === binding.lastKnownEnd &&
    token.contextFingerprint === binding.contextFingerprint
  );
  if (exact.length === 1) return { status: "matched", token: exact[0] };

  const contextual = candidates.filter((token) => token.contextFingerprint === binding.contextFingerprint);
  if (contextual.length === 1) return { status: "matched", token: contextual[0] };
  if (contextual.length > 1) return { status: "ambiguous", candidates: contextual };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "missing" };
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

function referenceKind(relation: ObjectRelation): DocumentWikiReferenceKind | null {
  if (relation.origin === "wiki-link") return "link";
  if (relation.origin === "wiki-embed") return "embed";
  return null;
}

/** Builds navigation from canonical text plus stable persisted target bindings. */
export function buildDocumentWikiLinkIndex(
  documents: readonly DocumentRecord[],
  relations: readonly ObjectRelation[] = []
): DocumentWikiLinkIndex {
  const byTitle = documentsByNormalizedTitle(documents);
  const byId = new Map(documents.map((document) => [document.id, document] as const));
  const outgoing: DocumentWikiLink[] = [];
  const backlinks: DocumentWikiBacklink[] = [];
  const backlinkPairs = new Set<string>();

  documents.forEach((source) => {
    const tokens = parseDocumentWikiReferences(source.content);
    const used = new Set<number>();
    const sourceRelations = relations.filter((relation) =>
      relation.fromId === source.id && relation.origin !== "manual"
    );

    sourceRelations.forEach((relation) => {
      const kind = referenceKind(relation);
      if (!kind) return;
      const match = matchWikiBinding(relation.binding!, kind, tokens, used);
      if (match.status !== "matched") return;
      const order = tokens.indexOf(match.token);
      used.add(order);
      const target = byId.get(relation.toId as DocumentId);
      const status: DocumentWikiLinkStatus = !target
        ? "unresolved"
        : target.id === source.id ? "self" : "resolved";
      outgoing.push({
        status,
        kind,
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        label: match.token.label,
        order,
        bound: true,
        targetDocumentId: relation.toId as DocumentId,
        targetTitle: target?.title
      });
      if (!target) return;
      const pair = `${source.id}\u0000${target.id}\u0000${kind}`;
      if (backlinkPairs.has(pair)) return;
      backlinkPairs.add(pair);
      backlinks.push({
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        targetDocumentId: target.id,
        kind,
        order
      });
    });

    tokens.forEach((token, order) => {
      if (used.has(order)) return;
      const matches = byTitle.get(normalizeDocumentWikiTitle(token.label)) ?? [];
      const base = {
        kind: token.kind,
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourcePreview: sourcePreview(source.content),
        label: token.label,
        order,
        bound: false
      } as const;
      if (matches.length === 0) outgoing.push({ ...base, status: "unresolved" });
      else if (matches.length > 1) outgoing.push({ ...base, status: "ambiguous" });
      else {
        const target = matches[0];
        outgoing.push({
          ...base,
          status: target.id === source.id ? "self" : "resolved",
          targetDocumentId: target.id,
          targetTitle: target.title
        });
        const pair = `${source.id}\u0000${target.id}\u0000${token.kind}`;
        if (target.id !== source.id && !backlinkPairs.has(pair)) {
          backlinkPairs.add(pair);
          backlinks.push({
            sourceDocumentId: source.id,
            sourceTitle: source.title,
            sourcePreview: sourcePreview(source.content),
            targetDocumentId: target.id,
            kind: token.kind,
            order
          });
        }
      }
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
