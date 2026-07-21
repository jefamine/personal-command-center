import type { DocumentId, DocumentRecord } from "../documents/documentContract";
import {
  documentReferenceFingerprint,
  matchWikiBinding,
  parseDocumentWikiReferences,
  type DocumentWikiLinkToken,
  type DocumentWikiReferenceKind
} from "../documents/documentWikiLinks";
import type { ObjectRelation } from "../objects/objectGraph";

export interface DocumentRenameBindingPlan {
  readonly relationId: string;
  readonly token: DocumentWikiLinkToken;
}

export interface DocumentRenameSourcePlan {
  readonly sourceId: DocumentId;
  readonly content: string;
  readonly bindings: readonly DocumentRenameBindingPlan[];
}

export interface DocumentRenamePlan {
  readonly sources: readonly DocumentRenameSourcePlan[];
  readonly skippedSources: readonly { readonly id: string; readonly reason: string }[];
}

/** Plans exact bound-token edits. Applying the plan remains the repository's responsibility. */
export function planDocumentReferenceRename(
  targetId: DocumentId,
  nextTitle: string,
  relations: readonly ObjectRelation[],
  documents: readonly DocumentRecord[]
): DocumentRenamePlan {
  const sources: DocumentRenameSourcePlan[] = [];
  const skippedSources: Array<{ id: string; reason: string }> = [];
  const bySource = new Map<string, ObjectRelation[]>();
  relations.filter((relation) => relation.toId === targetId && relation.origin !== "manual")
    .forEach((relation) => bySource.set(relation.fromId, [
      ...(bySource.get(relation.fromId) ?? []), relation
    ]));

  bySource.forEach((sourceRelations, sourceId) => {
    const source = documents.find((document) => document.id === sourceId);
    if (!source) {
      skippedSources.push({ id: sourceId, reason: "source-not-found" });
      return;
    }
    if (!source.capabilities.canEditContent || !source.capabilities.supportsSimpleTextEditing) {
      skippedSources.push({ id: sourceId, reason: source.kind === "material" ? "read-only" : "structured" });
      return;
    }

    const tokens = parseDocumentWikiReferences(source.content);
    const used = new Set<number>();
    const replacements: Array<{
      relation: ObjectRelation;
      token: DocumentWikiLinkToken;
      replacement: string;
    }> = [];
    sourceRelations.forEach((relation) => {
      if (relation.origin === "manual") return;
      const kind: DocumentWikiReferenceKind = relation.origin === "wiki-link" ? "link" : "embed";
      const matched = matchWikiBinding(relation.binding, kind, tokens, used);
      if (matched.status !== "matched") {
        skippedSources.push({ id: sourceId, reason: `binding-${matched.status}` });
        return;
      }
      used.add(tokens.indexOf(matched.token));
      replacements.push({
        relation,
        token: matched.token,
        replacement: `${kind === "embed" ? "!" : ""}[[${nextTitle}]]`
      });
    });
    if (!replacements.length) return;

    let content = source.content;
    [...replacements].sort((left, right) => right.token.start - left.token.start).forEach((entry) => {
      content = `${content.slice(0, entry.token.start)}${entry.replacement}${content.slice(entry.token.end)}`;
    });
    const bindings = replacements.map((entry): DocumentRenameBindingPlan => {
      const shift = replacements
        .filter((candidate) => candidate.token.start < entry.token.start)
        .reduce((sum, candidate) => sum + candidate.replacement.length - candidate.token.raw.length, 0);
      const start = entry.token.start + shift;
      const end = start + entry.replacement.length;
      return {
        relationId: entry.relation.id,
        token: {
          kind: entry.token.kind,
          label: nextTitle,
          raw: entry.replacement,
          start,
          end,
          occurrence: entry.token.occurrence,
          contextFingerprint: documentReferenceFingerprint(content, start, end)
        }
      };
    });
    sources.push({ sourceId: source.id, content, bindings });
  });
  return { sources, skippedSources };
}
