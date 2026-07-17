import type { ViewId } from "../types";
import type { AppRoute, GtdSection, SystemTool } from "./types";

const gtdSections: GtdSection[] = ["inbox", "tasks", "projects", "calendar", "review"];
const systemTools: SystemTool[] = [
  "workspace",
  "sphere-manager",
  "reflections",
  "insights",
  "integrations",
  "settings"
];

export function legacyViewToRoute(view: ViewId): AppRoute {
  switch (view) {
    case "today": return { kind: "home" };
    case "gtd": return { kind: "gtd", section: "tasks" };
    case "inbox": return { kind: "gtd", section: "inbox" };
    case "tasks": return { kind: "gtd", section: "tasks" };
    case "projects": return { kind: "gtd", section: "projects" };
    case "calendar": return { kind: "gtd", section: "calendar" };
    case "review": return { kind: "gtd", section: "review" };
    case "workspace":
    case "notes": return { kind: "tool", tool: "workspace" };
    case "journal": return { kind: "tool", tool: "reflections" };
    case "life":
    case "sphere": return { kind: "tool", tool: "sphere-manager" };
    case "insights": return { kind: "tool", tool: "insights" };
    case "integrations": return { kind: "tool", tool: "integrations" };
    case "settings": return { kind: "tool", tool: "settings" };
  }
}

export function routeFromUrl(url: URL): AppRoute {
  const objectId = url.searchParams.get("object");
  if (objectId) return { kind: "object", objectId };

  const sphereId = url.searchParams.get("sphere");
  if (sphereId) return { kind: "sphere", sphereId };

  const tool = url.searchParams.get("tool");
  if (tool && systemTools.includes(tool as SystemTool)) {
    return { kind: "tool", tool: tool as SystemTool };
  }

  const space = url.searchParams.get("space");
  if (space === "gtd") {
    const section = url.searchParams.get("section");
    return {
      kind: "gtd",
      section: section && gtdSections.includes(section as GtdSection)
        ? section as GtdSection
        : "tasks"
    };
  }

  const legacyView = url.searchParams.get("view") as ViewId | null;
  if (legacyView) {
    const known: ViewId[] = [
      "today", "gtd", "workspace", "sphere", "life", "inbox", "tasks", "projects",
      "calendar", "journal", "notes", "integrations", "review", "insights", "settings"
    ];
    if (known.includes(legacyView)) return legacyViewToRoute(legacyView);
  }

  return { kind: "home" };
}

export function routeToUrl(route: AppRoute, current: URL): URL {
  const url = new URL(current.toString());
  ["view", "space", "section", "sphere", "tool", "object"].forEach((key) => url.searchParams.delete(key));
  if (route.kind === "gtd") {
    url.searchParams.set("space", "gtd");
    url.searchParams.set("section", route.section);
  } else if (route.kind === "sphere") {
    url.searchParams.set("sphere", route.sphereId);
  } else if (route.kind === "tool") {
    url.searchParams.set("tool", route.tool);
  } else if (route.kind === "object") {
    url.searchParams.set("object", route.objectId);
  }
  return url;
}

export function routeHref(route: AppRoute, current = new URL(window.location.href)): string {
  const url = routeToUrl(route, current);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function routeEquals(left: AppRoute, right: AppRoute): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "home") return true;
  if (left.kind === "gtd" && right.kind === "gtd") return left.section === right.section;
  if (left.kind === "sphere" && right.kind === "sphere") return left.sphereId === right.sphereId;
  if (left.kind === "tool" && right.kind === "tool") return left.tool === right.tool;
  if (left.kind === "object" && right.kind === "object") return left.objectId === right.objectId;
  return false;
}

export function routeLabel(route: AppRoute): string {
  if (route.kind === "home") return "Главная";
  if (route.kind === "sphere") return "Сфера";
  if (route.kind === "object") return "Объект";
  if (route.kind === "gtd") {
    return ({
      inbox: "Входящие",
      tasks: "Задачи",
      projects: "Проекты",
      calendar: "Календарь",
      review: "Обзор"
    } as const)[route.section];
  }
  return ({
    workspace: "Рабочее пространство",
    "sphere-manager": "Сферы и навигация",
    reflections: "Осмысление",
    insights: "Аналитика",
    integrations: "Интеграции",
    settings: "Настройки"
  } as const)[route.tool];
}
