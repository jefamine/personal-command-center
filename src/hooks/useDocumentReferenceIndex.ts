import { useMemo } from "react";
import { listDocumentRecords } from "../domain/documents/documentRepository";
import { buildDocumentWikiLinkIndex } from "../domain/documents/documentWikiLinks";
import { useDashboard } from "../state/DashboardContext";

/** Read-only React adapter over the completely rebuildable document reference index. */
export function useDocumentReferenceIndex() {
  const { state } = useDashboard();
  return useMemo(
    () => buildDocumentWikiLinkIndex(listDocumentRecords(state)),
    [state]
  );
}
