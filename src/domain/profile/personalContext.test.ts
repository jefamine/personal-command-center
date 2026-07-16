import { describe, expect, it } from "vitest";
import {
  availablePersonalContextSections,
  buildReflectionContextProjection,
  createDefaultPersonalContext,
  normalizePersonalContext,
  sectionsFromProjection
} from "./personalContext";

describe("personal context", () => {
  it("по умолчанию пуст и не создаёт скрытый контекст", () => {
    const context = createDefaultPersonalContext();

    expect(availablePersonalContextSections(context)).toEqual([]);
    expect(buildReflectionContextProjection(context, ["goals", "systemProfile"])).toBeNull();
  });

  it("нормализует только известные самостоятельные сведения", () => {
    const context = normalizePersonalContext({
      goals: "Беречь время на глубокую работу",
      rhythms: 123,
      systemProfile: {
        mode: "systemic",
        selfDeclaredVectors: ["sound", "sound", "visual", "unknown"],
        manifestations: "Нужна тишина",
        combinationNotes: "",
        inferredConfidence: 0.99
      },
      updatedAt: "2026-07-15T08:00:00.000Z",
      hiddenInference: "не сохранять"
    });

    expect(context.rhythms).toBe("");
    expect(context.systemProfile.selfDeclaredVectors).toEqual(["sound", "visual"]);
    expect(context.systemProfile).not.toHaveProperty("inferredConfidence");
    expect(context).not.toHaveProperty("hiddenInference");
  });

  it("передаёт в разбор только явно выбранные разделы", () => {
    const context = normalizePersonalContext({
      goals: "Главный ориентир",
      rhythms: "Работать утром",
      preferences: "Один следующий шаг",
      boundaries: "Не перегружать",
      systemProfile: {
        mode: "systemic",
        selfDeclaredVectors: ["sound"],
        manifestations: "Смысловая концентрация",
        combinationNotes: ""
      },
      updatedAt: "2026-07-15T08:00:00.000Z"
    });

    const projection = buildReflectionContextProjection(context, ["preferences", "systemProfile"]);

    expect(projection?.sections.goals).toBeNull();
    expect(projection?.sections.rhythms).toBeNull();
    expect(projection?.sections.preferences).toBe("Один следующий шаг");
    expect(projection?.sections.boundaries).toBeNull();
    expect(projection?.sections.systemProfile?.selfDeclaredVectors).toEqual(["sound"]);
    expect(sectionsFromProjection(projection)).toEqual(["preferences", "systemProfile"]);
  });
});
