import type { ReflectionEntry } from "../../types";

export interface PendingReflectionAcknowledgement {
  entryId: string;
  requestId: string;
  requestDigest: string;
  responseId: string;
  sourceUpdatedAt: string;
}

/** Keeps bridge acknowledgement valid after the user reviews an already stored response. */
export function hasStoredReflectionResponse(
  entry: ReflectionEntry,
  pending: PendingReflectionAcknowledgement
): boolean {
  return (
    entry.id === pending.entryId &&
    entry.analysis?.responseId === pending.responseId &&
    entry.analysis.requestId === pending.requestId &&
    entry.analysisRequestId === pending.requestId &&
    entry.analysisRequestDigest === pending.requestDigest &&
    entry.analysisSourceUpdatedAt === pending.sourceUpdatedAt
  );
}
