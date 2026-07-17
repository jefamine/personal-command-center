import { Compass, LayoutDashboard, ListTodo, Menu, NotebookPen } from "lucide-react";
import type { AppRoute } from "../navigation/types";
import { AppLink } from "./AppLink";

interface MobileNavProps {
  route: AppRoute;
  inboxCount: number;
  onMenu: () => void;
}

export function MobileNav({ route, inboxCount, onMenu }: MobileNavProps) {
  const gtdRoute: AppRoute = route.kind === "gtd" ? route : { kind: "gtd", section: "tasks" };
  const workspaceRoute: AppRoute = { kind: "tool", tool: "workspace" };
  const spheresRoute: AppRoute = { kind: "tool", tool: "sphere-manager" };
  const spheresActive = route.kind === "sphere" || (route.kind === "tool" && route.tool === "sphere-manager");

  return (
    <nav className="mobile-nav" aria-label="Мобильная навигация">
      <AppLink
        className={`nav-item mobile-nav-link ${route.kind === "home" ? "active" : ""}`}
        route={{ kind: "home" }}
        aria-current={route.kind === "home" ? "page" : undefined}
      >
        <span><LayoutDashboard size={19} /></span>
        <small>Главная</small>
      </AppLink>
      <AppLink
        className={`nav-item mobile-nav-link ${route.kind === "gtd" ? "active" : ""}`}
        route={gtdRoute}
        aria-current={route.kind === "gtd" ? "page" : undefined}
      >
        <span>
          <ListTodo size={19} />
          {inboxCount > 0 ? <i title={`${inboxCount} во Входящих`}>{inboxCount}</i> : null}
        </span>
        <small>GTD</small>
      </AppLink>
      <AppLink
        className={`nav-item mobile-nav-link ${route.kind === "tool" && route.tool === "workspace" ? "active" : ""}`}
        route={workspaceRoute}
        aria-current={route.kind === "tool" && route.tool === "workspace" ? "page" : undefined}
      >
        <span><NotebookPen size={19} /></span>
        <small>Пространство</small>
      </AppLink>
      <AppLink
        className={`nav-item mobile-nav-link ${spheresActive ? "active" : ""}`}
        route={spheresRoute}
        aria-current={spheresActive ? "page" : undefined}
      >
        <span><Compass size={19} /></span>
        <small>Сферы</small>
      </AppLink>
      <button type="button" onClick={onMenu} aria-label="Открыть всё меню">
        <span><Menu size={19} /></span>
        <small>Меню</small>
      </button>
    </nav>
  );
}
