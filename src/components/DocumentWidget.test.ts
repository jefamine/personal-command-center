import { describe, expect, it } from "vitest";
import { documentBodyAfterTitle, documentTitleFromBody } from "./DocumentWidget";

describe("document capture title", () => {
  it("uses the first meaningful line without creating a special document type", () => {
    expect(documentTitleFromBody("\n#   Моя обычная мысль\n\nПродолжение"))
      .toBe("Моя обычная мысль");
    expect(documentTitleFromBody("   ")).toBe("Без названия");
  });

  it("keeps an automatically derived title compact", () => {
    const title = documentTitleFromBody("Очень длинная строка ".repeat(10));
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith("…")).toBe(true);
  });

  it("moves the first meaningful line into the title without duplicating it in the body", () => {
    expect(documentBodyAfterTitle("\nПроверка документа\n\nОсновной текст.\nЕщё строка."))
      .toBe("Основной текст.\nЕщё строка.");
    expect(documentBodyAfterTitle("Только заголовок")).toBe("");
  });
});
