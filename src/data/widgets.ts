import type { DashboardWidget } from "../types";
import { widgetRegistry } from "../domain/widgets/widgetRegistry";

export function createDefaultWidgets(): DashboardWidget[] {
  return widgetRegistry.map((definition, order) => ({
    id: definition.defaultId,
    type: definition.type,
    title: definition.title,
    enabled: definition.enabledByDefault,
    size: definition.defaultSize,
    gridWidth: definition.defaultWidth,
    gridHeight: definition.defaultHeight,
    order,
    config: { ...definition.defaultConfig }
  }));
}
