import { describe, expect, it } from "vitest";
import type { ReflectionAnalysis, ReflectionSuggestion } from "../../types";
import {
  decideReflectionSuggestionValue,
  deriveReflectionSuggestions,
  editReflectionSuggestionValue,
  normalizeReflectionSuggestions,
  reflectionSuggestionNoteSection
} from "./reflectionSuggestions";

const generatedAt = "2026-07-15T10:00:00.000Z";
const importedAt = "2026-07-15T10:01:00.000Z";

function analysis(overrides: Partial<ReflectionAnalysis> = {}): ReflectionAnalysis {
  return {
    responseId: "response-1",
    requestId: "request-1",
    understanding: "Это понимание не становится meaning автоматически.",
    observations: [],
    possibleExplanation: "  Возможный смысл остаётся точным.  ",
    alternatives: [],
    question: "Что здесь важнее?",
    proposedAction: "Записать один следующий шаг",
    source: "codex",
    generatedAt,
    ...overrides
  };
}

function suggestion(overrides: Partial<ReflectionSuggestion> = {}): ReflectionSuggestion {
  return {
    id: "response-1:meaning",
    kind: "meaning",
    sourceText: "Возможный смысл",
    text: "Возможный смысл",
    status: "pending",
    createdAt: generatedAt,
    updatedAt: importedAt,
    decidedAt: null,
    addedToNoteAt: null,
    createdTaskId: null,
    ...overrides
  };
}

describe("reflection suggestions", () => {
  it("derives deterministic meaning, question and next action without using understanding", () => {
    const suggestions = deriveReflectionSuggestions(analysis(), importedAt);
    expect(suggestions.map((entry) => entry.id)).toEqual([
      "response-1:meaning",
      "response-1:question",
      "response-1:next_action"
    ]);
    expect(suggestions[0]).toMatchObject({
      sourceText: "  Возможный смысл остаётся точным.  ",
      text: "  Возможный смысл остаётся точным.  ",
      createdAt: generatedAt,
      updatedAt: importedAt,
      status: "pending"
    });
    expect(suggestions.some((entry) => entry.text.includes("понимание"))).toBe(false);
  });

  it("omits blank optional source fields", () => {
    expect(deriveReflectionSuggestions(analysis({
      possibleExplanation: " ",
      question: "",
      proposedAction: "  "
    }), importedAt)).toEqual([]);
  });

  it("normalizes strictly as one atomic array", () => {
    const valid = [
      suggestion(),
      suggestion({
        id: "response-1:next_action",
        kind: "next_action",
        sourceText: "Сделать шаг",
        text: "Сделать шаг",
        status: "accepted",
        decidedAt: importedAt,
        createdTaskId: "task-1"
      })
    ];
    expect(normalizeReflectionSuggestions(valid, "response-1")).toEqual(valid);
    expect(normalizeReflectionSuggestions([
      ...valid,
      suggestion({ id: "response-1:meaning", text: "Повтор" })
    ], "response-1")).toBeNull();
    expect(normalizeReflectionSuggestions([
      suggestion({ status: "dismissed", decidedAt: null })
    ], "response-1")).toBeNull();
  });

  it("edits only pending text and keeps source immutable", () => {
    const original = suggestion();
    const edited = editReflectionSuggestionValue(original, "Уточнённый смысл", importedAt);
    expect(edited).toMatchObject({ sourceText: original.sourceText, text: "Уточнённый смысл" });
    expect(editReflectionSuggestionValue({ ...original, status: "accepted" }, "Другое", importedAt)).toBeNull();
    expect(editReflectionSuggestionValue(original, " ", importedAt)).toBeNull();
  });

  it("changes decisions while preserving already created external links", () => {
    const applied = suggestion({
      status: "accepted",
      decidedAt: generatedAt,
      addedToNoteAt: generatedAt
    });
    const dismissed = decideReflectionSuggestionValue(applied, "dismissed", importedAt)!;
    const reset = decideReflectionSuggestionValue(dismissed, "pending", "2026-07-15T10:02:00.000Z")!;
    expect(dismissed.addedToNoteAt).toBe(generatedAt);
    expect(reset).toMatchObject({ status: "pending", decidedAt: null, addedToNoteAt: generatedAt });
  });

  it("formats accepted meaning and question as escaped Markdown blockquotes", () => {
    const section = reflectionSuggestionNoteSection(suggestion({
      status: "accepted",
      decidedAt: importedAt,
      text: "# Не заголовок\n<script>alert(1)</script>"
    }));
    expect(section).toContain("## Возможный смысл из разбора");
    expect(section).toContain("> \\# Не заголовок");
    expect(section).toContain("&lt;script&gt;");
    expect(reflectionSuggestionNoteSection(suggestion())).toBeNull();
  });
});
