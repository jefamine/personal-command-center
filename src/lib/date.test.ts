import { describe, expect, it } from "vitest";
import { addMonths, nextWeekday } from "./date";

describe("recurrence dates", () => {
  it("переносит пятницу на следующий понедельник", () => {
    expect(nextWeekday("2026-07-17")).toBe("2026-07-20");
  });

  it("корректно переносит последний день длинного месяца", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});
