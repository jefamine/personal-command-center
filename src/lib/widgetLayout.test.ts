import { describe, expect, it } from "vitest";
import { normalizeWidgetLayout, sizeForColumns, widgetGridHeight, widgetGridWidth, widgetMinGridWidth } from "./widgetLayout";
import type { DashboardWidget } from "../types";

const widget: DashboardWidget = {
  id: "weather",
  type: "weather",
  title: "Погода",
  enabled: true,
  size: "third",
  order: 0,
  config: {}
};

describe("dashboard widget grid", () => {
  it("добавляет безопасные размеры старому виджету", () => {
    const normalized = normalizeWidgetLayout(widget);
    expect(normalized.gridWidth).toBe(4);
    expect(normalized.gridHeight).toBe(5);
  });

  it("даёт блоку осмысления место рядом с погодой", () => {
    const reflection = normalizeWidgetLayout({
      ...widget,
      id: "reflection",
      type: "reflection",
      title: "Записать и осмыслить",
      size: "two-thirds"
    });
    expect(reflection.gridWidth).toBe(8);
    expect(reflection.gridHeight).toBe(5);
  });

  it("ограничивает ручное растягивание сеткой", () => {
    expect(widgetGridWidth({ ...widget, gridWidth: 30 })).toBe(12);
    expect(widgetGridWidth({ ...widget, gridWidth: 1 })).toBe(3);
    expect(widgetGridWidth({ ...widget, id: "reflection", type: "reflection", gridWidth: 3 })).toBe(6);
    expect(widgetMinGridWidth({ type: "reflection" })).toBe(6);
    expect(widgetGridHeight({ ...widget, gridHeight: 40 })).toBe(14);
    expect(sizeForColumns(8)).toBe("two-thirds");
  });
});
