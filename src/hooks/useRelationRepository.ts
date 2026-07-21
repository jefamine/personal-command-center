import { useMemo } from "react";
import type { DocumentId } from "../domain/documents/documentContract";
import { listDocumentRecords } from "../domain/documents/documentRepository";
import {
  buildDocumentWikiLinkIndex,
  type DocumentWikiLinkToken
} from "../domain/documents/documentWikiLinks";
import { useDashboard } from "../state/DashboardContext";

/** React adapter over the relation application boundary; no component writes the graph directly. */
export function useRelationRepository() {
  const { state, reconcileDocumentRelations, bindDocumentReference } = useDashboard();
  const documents = useMemo(() => listDocumentRecords(state), [state]);
  const index = useMemo(
    () => buildDocumentWikiLinkIndex(documents, state.objectGraph.relations),
    [documents, state.objectGraph.relations]
  );
  return useMemo(() => ({
    index,
    reconcileDocument: reconcileDocumentRelations,
    bindDocumentReference: (sourceId: DocumentId, targetId: DocumentId, token: DocumentWikiLinkToken) =>
      bindDocumentReference(sourceId, targetId, token)
  }), [bindDocumentReference, index, reconcileDocumentRelations]);
}
