import { describe, expect, it } from "vitest";
import type { ReflectionEntry } from "../../types";
import {
  hasStoredReflectionResponse,
  type PendingReflectionAcknowledgement
} from "./reflectionAcknowledgement";

const pending: PendingReflectionAcknowledgement = {
  entryId: "reflection-1",
  requestId: "request-1",
  requestDigest: "digest-1",
  responseId: "response-1",
  sourceUpdatedAt: "2026-07-15T10:00:00.000Z"
};

function entry(status: ReflectionEntry["status"]): ReflectionEntry {
  return {
    id: "reflection-1",
    noteId: "reflection-note-reflection-1",
    originalText: "Текст",
    status,
    analysis: {
      responseId: "response-1",
      requestId: "request-1",
      understanding: "Понимание",
      observations: [],
      possibleExplanation: "Смысл",
      alternatives: [],
      question: "Вопрос?",
      proposedAction: "Шаг",
      source: "codex",
      generatedAt: "2026-07-15T10:02:00.000Z"
    },
    correction: status === "corrected" ? "Поправка" : null,
    analysisRequestId: "request-1",
    analysisRequestDigest: "digest-1",
    analysisRequestedAt: "2026-07-15T10:01:00.000Z",
    analysisSourceUpdatedAt: "2026-07-15T10:00:00.000Z",
    analysisContextSections: [],
    analysisProfileUpdatedAt: null,
    analysisMemoryRefs: [],
    suggestions: [],
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:03:00.000Z",
    confirmedAt: status === "confirmed" || status === "corrected"
      ? "2026-07-15T10:03:00.000Z"
      : null
  };
}

describe("reflection response acknowledgement", () => {
  it("remains valid after confirm, correction or ignore review", () => {
    for (const status of ["analyzed", "confirmed", "corrected", "ignored"] as const) {
      expect(hasStoredReflectionResponse(entry(status), pending)).toBe(true);
    }
  });

  it("rejects a different response, request digest or source version", () => {
    expect(hasStoredReflectionResponse(entry("confirmed"), { ...pending, responseId: "other" })).toBe(false);
    expect(hasStoredReflectionResponse(entry("confirmed"), { ...pending, requestDigest: "other" })).toBe(false);
    expect(hasStoredReflectionResponse(entry("confirmed"), { ...pending, sourceUpdatedAt: "other" })).toBe(false);
  });
});
