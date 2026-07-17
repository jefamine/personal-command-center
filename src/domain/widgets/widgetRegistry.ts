import type {
  DashboardWidgetConfig,
  DashboardWidgetSize,
  DashboardWidgetType
} from "../../types";

export type StandardWidgetType = Exclude<DashboardWidgetType, "custom" | "reflection">;

export interface WidgetDefinition {
  type: StandardWidgetType;
  defaultId: string;
  title: string;
  description: string;
  defaultSize: DashboardWidgetSize;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  enabledByDefault: boolean;
  defaultConfig: DashboardWidgetConfig;
}

export const widgetRegistry: readonly WidgetDefinition[] = [
  { type: "overview", defaultId: "overview", title: "Обзор дня", description: "Нагрузка, входящие, риски и прогресс", defaultSize: "full", defaultWidth: 12, defaultHeight: 2, minWidth: 3, enabledByDefault: true, defaultConfig: {} },
  { type: "focus", defaultId: "focus", title: "Главный фокус", description: "Лучший следующий шаг", defaultSize: "full", defaultWidth: 12, defaultHeight: 3, minWidth: 3, enabledByDefault: true, defaultConfig: {} },
  { type: "document", defaultId: "document", title: "Текст", description: "Обычный документ с бесшовным автосохранением", defaultSize: "two-thirds", defaultWidth: 8, defaultHeight: 5, minWidth: 5, enabledByDefault: true, defaultConfig: {} },
  { type: "weather", defaultId: "weather", title: "Погода", description: "Прогноз на сегодня и два следующих дня", defaultSize: "third", defaultWidth: 4, defaultHeight: 5, minWidth: 3, enabledByDefault: true, defaultConfig: { city: "Москва", latitude: 55.7558, longitude: 37.6176 } },
  { type: "plan", defaultId: "plan", title: "План дня", description: "Оптимизированная последовательность задач", defaultSize: "two-thirds", defaultWidth: 8, defaultHeight: 8, minWidth: 3, enabledByDefault: true, defaultConfig: {} },
  { type: "inbox", defaultId: "inbox", title: "Входящие", description: "Новые необработанные задачи", defaultSize: "third", defaultWidth: 4, defaultHeight: 8, minWidth: 3, enabledByDefault: true, defaultConfig: {} },
  { type: "reading", defaultId: "reading", title: "Материалы для вас", description: "Статьи, ссылки и подборки Codex", defaultSize: "half", defaultWidth: 6, defaultHeight: 5, minWidth: 3, enabledByDefault: true, defaultConfig: {} },
  { type: "recommendations", defaultId: "recommendations", title: "Рекомендации", description: "Локальные подсказки по текущей ситуации", defaultSize: "two-thirds", defaultWidth: 8, defaultHeight: 5, minWidth: 3, enabledByDefault: false, defaultConfig: {} }
] as const;

export function widgetDefinition(type: DashboardWidgetType): WidgetDefinition | null {
  if (type === "reflection") return widgetRegistry.find((entry) => entry.type === "document") ?? null;
  return type === "custom" ? null : widgetRegistry.find((entry) => entry.type === type) ?? null;
}
