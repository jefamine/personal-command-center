import type { ReflectionDocument } from "../../types";

export interface PendingReflectionAcknowledgement {
  entryId: string;
  requestId: string;
  requestDigest: string;
  responseId: string;
  sourceUpdatedAt: string;
}

/** Keeps bridge acknowledgement valid after the user reviews an already stored response. */
export function hasStoredReflectionResponse(
  entry: ReflectionDocument,
  pending: PendingReflectionAcknowledgement
): boolean {
  return (
    entry.id === pending.entryId &&
    entry.reflection.analysis?.responseId === pending.responseId &&
    entry.reflection.analysis.requestId === pending.requestId &&
    entry.reflection.analysisRequestId === pending.requestId &&
    entry.reflection.analysisRequestDigest === pending.requestDigest &&
    entry.reflection.analysisSourceUpdatedAt === pending.sourceUpdatedAt
  );
}
