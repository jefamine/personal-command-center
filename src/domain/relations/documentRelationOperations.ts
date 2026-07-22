import type { DocumentId, DocumentRecord } from "../documents/documentContract";
import type {
  DocumentReferenceUpdateSummary,
  DocumentUpdateResult
} from "../documents/documentRepository";
import {
  buildDocumentWikiLinkIndex,
  normalizeDocumentWikiTitle,
  parseDocumentWikiReferences
} from "../documents/documentWikiLinks";

export interface DocumentRenameSourcePlan {
  readonly sourceId: DocumentId;
  readonly content: string;
}

export interface DocumentRenamePlan {
  readonly sources: readonly DocumentRenameSourcePlan[];
  readonly skippedSources: readonly { readonly id: string; readonly reason: string }[];
}

/** Applies every source edit through the canonical document update command. */
export function applyDocumentReferenceRenamePlan(
  plan: DocumentRenamePlan,
  updateDocument: (id: DocumentId, content: string) => DocumentUpdateResult
): DocumentReferenceUpdateSummary {
  const updatedSources: string[] = [];
  const rejectedSources: Array<{ id: string; reason: string }> = [];
  plan.sources.forEach((source) => {
    const result = updateDocument(source.sourceId, source.content);
    if (result.status === "accepted") updatedSources.push(source.sourceId);
    else rejectedSources.push({ id: source.sourceId, reason: result.status });
  });
  return {
    updatedSources,
    skippedSources: plan.skippedSources,
    rejectedSources
  };
}

/**
 * Plans text-only rename propagation from the pre-rename document snapshot.
 * Only references uniquely resolved to targetId are eligible for replacement.
 */
export function planDocumentReferenceRename(
  targetId: DocumentId,
  nextTitle: string,
  documents: readonly DocumentRecord[]
): DocumentRenamePlan {
  const target = documents.find((document) => document.id === targetId);
  if (!target) {
    return { sources: [], skippedSources: [{ id: targetId, reason: "target-not-found" }] };
  }

  const oldTitle = normalizeDocumentWikiTitle(target.title);
  const sameTitleCount = documents.filter((document) =>
    normalizeDocumentWikiTitle(document.title) === oldTitle
  ).length;
  const index = buildDocumentWikiLinkIndex(documents);
  const sources: DocumentRenameSourcePlan[] = [];
  const skippedSources: Array<{ id: string; reason: string }> = [];

  documents.forEach((source) => {
    const matchingTokens = parseDocumentWikiReferences(source.content).filter((token) =>
      normalizeDocumentWikiTitle(token.label) === oldTitle
    );
    if (!matchingTokens.length) return;

    const references = index.outgoingFor(source.id).filter((reference) =>
      reference.status === "resolved" && reference.targetDocumentId === targetId
    );
    if (!references.length) {
      skippedSources.push({
        id: source.id,
        reason: sameTitleCount > 1 ? "ambiguous-title" : "not-resolved"
      });
      return;
    }
    if (!source.capabilities.canEditContent || !source.capabilities.supportsSimpleTextEditing) {
      skippedSources.push({
        id: source.id,
        reason: source.kind === "material" ? "read-only" : "structured"
      });
      return;
    }

    let content = source.content;
    [...references].sort((left, right) => right.start - left.start).forEach((reference) => {
      const replacement = `${reference.kind === "embed" ? "!" : ""}[[${nextTitle}]]`;
      content = `${content.slice(0, reference.start)}${replacement}${content.slice(reference.end)}`;
    });
    if (content !== source.content) sources.push({ sourceId: source.id, content });
  });

  return { sources, skippedSources };
}
