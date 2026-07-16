import { describe, expect, it } from "vitest";
import type { AssistantMemoryItem } from "../../types";
import {
  MAX_REFLECTION_MEMORY_ITEM_LENGTH,
  buildReflectionMemoryProjection,
  memoryReferencesFromProjection,
  normalizeReflectionMemoryProjection
} from "./reflectionMemory";

function memoryItem(overrides: Partial<AssistantMemoryItem> = {}): AssistantMemoryItem {
  return {
    id: "memory-1",
    text: "Мне помогает один ясный следующий шаг.",
    sourceType: "manual",
    sourceId: null,
    sourceUpdatedAt: null,
    status: "active",
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    ...overrides
  };
}

describe("reflection memory projection", () => {
  it("returns null by default and includes only explicitly selected active items", () => {
    const first = memoryItem();
    const second = memoryItem({ id: "memory-2", text: "Точный текст  \n", updatedAt: "2026-07-15T09:00:00.000Z" });

    expect(buildReflectionMemoryProjection([first, second])).toBeNull();
    expect(buildReflectionMemoryProjection([first, second], [])).toBeNull();
    expect(buildReflectionMemoryProjection([first, second], [second.id])).toEqual({
      schemaVersion: 1,
      items: [{ id: second.id, text: second.text, updatedAt: second.updatedAt }]
    });
  });

  it("rejects missing, paused and duplicate selections", () => {
    const active = memoryItem();
    const paused = memoryItem({ id: "memory-paused", status: "paused" });

    expect(() => buildReflectionMemoryProjection([active], ["missing"])).toThrow();
    expect(() => buildReflectionMemoryProjection([active, paused], [paused.id])).toThrow();
    expect(() => buildReflectionMemoryProjection([active], [active.id, active.id])).toThrow();

    const seven = Array.from({ length: 7 }, (_, index) => memoryItem({ id: `memory-${index}` }));
    expect(() => buildReflectionMemoryProjection(seven, seven.map((item) => item.id))).toThrow();
  });

  it("rejects per-item and total limits without truncating exact text", () => {
    const tooLong = memoryItem({ text: "я".repeat(MAX_REFLECTION_MEMORY_ITEM_LENGTH + 1) });
    expect(() => buildReflectionMemoryProjection([tooLong], [tooLong.id])).toThrow();

    const items = Array.from({ length: 5 }, (_, index) => memoryItem({
      id: `memory-${index}`,
      text: String(index).repeat(2_500)
    }));
    expect(() => buildReflectionMemoryProjection(items, items.map((item) => item.id))).toThrow();
  });

  it("normalizes all-or-nothing and derives references without retaining text", () => {
    const projection = buildReflectionMemoryProjection([memoryItem()], ["memory-1"]);
    const references = memoryReferencesFromProjection(projection);
    expect(references).toEqual([
      { id: "memory-1", updatedAt: "2026-07-15T08:00:00.000Z" }
    ]);
    projection!.items[0].id = "changed-after-queue";
    expect(references[0].id).toBe("memory-1");
    expect(normalizeReflectionMemoryProjection({
      schemaVersion: 1,
      items: [
        { id: "memory-1", text: "Первая", updatedAt: "2026-07-15T08:00:00.000Z" },
        { id: "memory-1", text: "Повтор", updatedAt: "2026-07-15T09:00:00.000Z" }
      ]
    })).toBeNull();
  });

  it("matches the bridge id and full ISO timestamp contract", () => {
    expect(normalizeReflectionMemoryProjection({
      schemaVersion: 1,
      items: [{ id: "memory/unsafe", text: "Текст", updatedAt: "2026-07-15T10:00:00.000Z" }]
    })).toBeNull();
    expect(normalizeReflectionMemoryProjection({
      schemaVersion: 1,
      items: [{ id: "memory-safe", text: "Текст", updatedAt: "2026-07-15" }]
    })).toBeNull();
  });
});
