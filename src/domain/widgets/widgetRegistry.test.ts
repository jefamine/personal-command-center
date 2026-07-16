import { describe, expect, it } from "vitest";
import { createDefaultWidgets } from "../../data/widgets";
import { widgetDefinition, widgetRegistry } from "./widgetRegistry";

describe("widget registry", () => {
  it("содержит единственное определение каждого стандартного виджета", () => {
    expect(new Set(widgetRegistry.map((entry) => entry.type)).size).toBe(widgetRegistry.length);
    expect(widgetDefinition("custom")).toBeNull();
  });

  it("создаёт стартовую сетку из реестра без общих изменяемых config", () => {
    const first = createDefaultWidgets();
    const second = createDefaultWidgets();
    expect(first.map((widget) => widget.type)).toEqual(widgetRegistry.map((entry) => entry.type));
    expect(first.find((widget) => widget.type === "recommendations")?.enabled).toBe(false);
    expect(first[0].config).not.toBe(second[0].config);
  });
});
