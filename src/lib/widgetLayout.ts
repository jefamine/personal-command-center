import type { DashboardWidget, DashboardWidgetSize } from "../types";
import { widgetDefinition } from "../domain/widgets/widgetRegistry";

export function columnsForSize(size: DashboardWidgetSize): number {
  if (size === "full") return 12;
  if (size === "two-thirds") return 8;
  if (size === "half") return 6;
  return 4;
}

export function sizeForColumns(columns: number): DashboardWidgetSize {
  if (columns >= 10) return "full";
  if (columns >= 7) return "two-thirds";
  if (columns >= 5) return "half";
  return "third";
}

export function widgetMinGridWidth(widget: Pick<DashboardWidget, "type">): number {
  return widgetDefinition(widget.type)?.minWidth ?? 3;
}

export function widgetGridWidth(widget: DashboardWidget): number {
  return Math.min(12, Math.max(widgetMinGridWidth(widget), widget.gridWidth ?? columnsForSize(widget.size)));
}

export function widgetGridHeight(widget: DashboardWidget): number {
  return Math.min(14, Math.max(2, widget.gridHeight ?? widgetDefinition(widget.type)?.defaultHeight ?? 5));
}

export function normalizeWidgetLayout(widget: DashboardWidget): DashboardWidget {
  const gridWidth = widgetGridWidth(widget);
  return {
    ...widget,
    gridWidth,
    gridHeight: widgetGridHeight(widget),
    size: sizeForColumns(gridWidth)
  };
}
