import { describe, expect, it } from "vitest";
import type { ViewId } from "../types";
import { legacyViewToRoute, routeEquals, routeFromUrl, routeIsActive, routeToUrl } from "./router";
import type { AppRoute } from "./types";

describe("маршруты ПСОЖ", () => {
  it("перенаправляет старые экраны GTD внутрь сферы GTD", () => {
    expect(legacyViewToRoute("inbox")).toEqual({ kind: "gtd", section: "inbox" });
    expect(legacyViewToRoute("calendar")).toEqual({ kind: "gtd", section: "calendar" });
    expect(legacyViewToRoute("notes")).toEqual({ kind: "tool", tool: "workspace" });
  });

  it("поддерживает все старые ViewId", () => {
    const views: ViewId[] = [
      "today", "gtd", "workspace", "sphere", "life", "inbox", "tasks", "projects",
      "calendar", "journal", "notes", "integrations", "review", "insights", "settings"
    ];
    expect(views.map(legacyViewToRoute)).toHaveLength(views.length);
  });

  it("сохраняет маршрут после преобразования URL туда и обратно", () => {
    const routes: AppRoute[] = [
      { kind: "home" },
      { kind: "gtd", section: "inbox" },
      { kind: "sphere", sphereId: "семья/1" },
      { kind: "tool", tool: "workspace" },
      { kind: "tool", tool: "workspace", documentId: "legacy:v12:note:мысль/1" },
      { kind: "object", objectId: "legacy:v12:task:42" }
    ];
    const base = new URL("https://local.test/app?unrelated=kept#section");
    routes.forEach((route) => {
      const restored = routeFromUrl(routeToUrl(route, base));
      expect(routeEquals(restored, route)).toBe(true);
      expect(routeToUrl(route, base).searchParams.get("unrelated")).toBe("kept");
    });
  });

  it("читает старую ссылку view=inbox", () => {
    expect(routeFromUrl(new URL("https://local.test/?view=inbox")))
      .toEqual({ kind: "gtd", section: "inbox" });
  });

  it("оставляет рабочее пространство активным при открытом документе", () => {
    const current: AppRoute = {
      kind: "tool",
      tool: "workspace",
      documentId: "legacy:v12:note:one"
    };
    const navigationTarget: AppRoute = { kind: "tool", tool: "workspace" };

    expect(routeIsActive(current, navigationTarget)).toBe(true);
    expect(routeEquals(current, navigationTarget)).toBe(false);
  });
});
