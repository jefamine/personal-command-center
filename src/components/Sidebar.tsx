import {
  BarChart3,
  BookOpenText,
  ChevronRight,
  Compass,
  LayoutDashboard,
  ListTodo,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { routeIsActive } from "../navigation/router";
import type { AppRoute } from "../navigation/types";
import type { LifeArea } from "../types";
import { AppLink } from "./AppLink";

interface SidebarProps {
  route: AppRoute;
  lifeAreas: LifeArea[];
  open: boolean;
  collapsed: boolean;
  peeking: boolean;
  modal?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleCollapse: () => void;
  onPeekStart: () => void;
  onPeekEnd: () => void;
  inboxCount: number;
}

const toolItems = [
  { route: { kind: "tool", tool: "workspace" }, label: "Рабочее пространство", icon: NotebookPen },
  { route: { kind: "tool", tool: "sphere-manager" }, label: "Сферы и навигация", icon: Compass },
  { route: { kind: "tool", tool: "reflections" }, label: "Осмысление", icon: BookOpenText },
  { route: { kind: "tool", tool: "insights" }, label: "Аналитика", icon: BarChart3 },
  { route: { kind: "tool", tool: "integrations" }, label: "Интеграции", icon: PlugZap }
] satisfies Array<{
  route: Extract<AppRoute, { kind: "tool" }>;
  label: string;
  icon: typeof LayoutDashboard;
}>;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

export function Sidebar({
  route,
  lifeAreas,
  open,
  collapsed,
  peeking,
  modal = false,
  returnFocusRef,
  onClose,
  onToggleCollapse,
  onPeekStart,
  onPeekEnd,
  inboxCount
}: SidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const visibleAreas = useMemo(
    () => lifeAreas.filter((area) => !area.archived).sort((left, right) => left.order - right.order),
    [lifeAreas]
  );
  const gtdRoute: AppRoute = route.kind === "gtd" ? route : { kind: "gtd", section: "tasks" };
  const settingsRoute: AppRoute = { kind: "tool", tool: "settings" };
  const interactive = modal ? open : open || !collapsed || peeking;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!modal || !open) return;

    const sidebar = sidebarRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !sidebar) return;
      const focusable = focusableElements(sidebar);
      if (!focusable.length) {
        event.preventDefault();
        sidebar.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sidebar.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sidebar.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const opener = returnFocusRef?.current;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [modal, open, returnFocusRef]);

  return (
    <>
      <div
        className={`sidebar-scrim ${open ? "is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {collapsed ? (
        <button
          type="button"
          className="sidebar-edge-trigger"
          onMouseEnter={onPeekStart}
          onFocus={onPeekStart}
          onClick={onToggleCollapse}
          aria-label="Показать и закрепить боковую панель"
          title="Показать меню"
        >
          <ChevronRight size={16} />
        </button>
      ) : null}
      <aside
        ref={sidebarRef}
        id="app-navigation-drawer"
        className={`sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""} ${peeking ? "is-peeking" : ""}`}
        onMouseEnter={onPeekStart}
        onMouseLeave={onPeekEnd}
        role={modal ? "dialog" : undefined}
        aria-modal={modal && open ? true : undefined}
        aria-hidden={!interactive ? true : undefined}
        aria-label="Полная навигация"
        inert={!interactive}
        tabIndex={modal && open ? -1 : undefined}
      >
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={20} strokeWidth={2.2} />
          </div>
          <div>
            <strong>Командный центр</strong>
            <span>Личная система</span>
          </div>
          <button ref={closeButtonRef} className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="Закрыть меню">
            <X size={20} />
          </button>
          <button
            className="icon-button sidebar-collapse"
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Закрепить боковую панель" : "Полностью скрыть боковую панель"}
            title={collapsed ? "Закрепить панель" : "Скрыть панель"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="main-nav" aria-label="Основная навигация">
          <span className="nav-caption">Главное</span>
          <AppLink
            className={`nav-item ${route.kind === "home" ? "active" : ""}`}
            route={{ kind: "home" }}
            onClick={onClose}
            title={collapsed ? "Главная" : undefined}
            aria-current={route.kind === "home" ? "page" : undefined}
          >
            <LayoutDashboard size={19} strokeWidth={1.9} />
            <span>Главная</span>
          </AppLink>
          <AppLink
            className={`nav-item ${route.kind === "gtd" ? "active" : ""}`}
            route={gtdRoute}
            onClick={onClose}
            title={collapsed ? "GTD" : undefined}
            aria-current={route.kind === "gtd" ? "page" : undefined}
          >
            <ListTodo size={19} strokeWidth={1.9} />
            <span>GTD</span>
            {inboxCount > 0 ? <span className="nav-badge" title={`${inboxCount} во Входящих`}>{inboxCount}</span> : null}
          </AppLink>

          {visibleAreas.length ? <span className="nav-caption">Сферы жизни</span> : null}
          {visibleAreas.map((area) => {
            const active = route.kind === "sphere" && route.sphereId === area.id;
            return (
              <AppLink
                key={area.id}
                className={`nav-item ${active ? "active" : ""}`}
                route={{ kind: "sphere", sphereId: area.id }}
                navigation={{ label: area.title }}
                onClick={onClose}
                title={collapsed ? area.title : undefined}
                aria-current={active ? "page" : undefined}
              >
                <Compass size={19} strokeWidth={1.9} style={{ color: active ? area.color : undefined }} />
                <span>{area.title}</span>
              </AppLink>
            );
          })}

          <span className="nav-caption">Инструменты</span>
          {toolItems.map((item) => {
            const Icon = item.icon;
            const active = routeIsActive(route, item.route);
            return (
              <AppLink
                key={item.route.tool}
                className={`nav-item ${active ? "active" : ""}`}
                route={item.route}
                onClick={onClose}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} strokeWidth={1.9} />
                <span>{item.label}</span>
              </AppLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="autonomy-card">
            <div className="status-dot" />
            <div>
              <strong>Автономный режим</strong>
              <span>Данные хранятся на устройстве</span>
            </div>
          </div>
          <AppLink
            className={`nav-item ${routeIsActive(route, settingsRoute) ? "active" : ""}`}
            route={settingsRoute}
            onClick={onClose}
            title={collapsed ? "Настройки" : undefined}
            aria-current={routeIsActive(route, settingsRoute) ? "page" : undefined}
          >
            <Settings size={19} strokeWidth={1.9} />
            <span>Настройки</span>
          </AppLink>
        </div>
      </aside>
    </>
  );
}
