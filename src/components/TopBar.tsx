import {
  BarChart3,
  BookOpenText,
  ChevronDown,
  CloudOff,
  Compass,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Menu,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Unplug
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { parseQuickCapture } from "../lib/quickCapture";
import { routeEquals } from "../navigation/router";
import type { AppRoute } from "../navigation/types";
import { useDashboard } from "../state/DashboardContext";
import type { LifeArea } from "../types";
import { AppLink } from "./AppLink";

interface TopBarProps {
  route: AppRoute;
  lifeAreas: LifeArea[];
  inboxCount: number;
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
}

const secondaryItems = [
  {
    route: { kind: "tool", tool: "workspace" },
    label: "Рабочее пространство",
    description: "Документы, материалы и связи",
    icon: NotebookPen
  },
  {
    route: { kind: "tool", tool: "sphere-manager" },
    label: "Сферы и верхняя панель",
    description: "Состав, порядок и быстрый доступ",
    icon: Compass
  },
  {
    route: { kind: "tool", tool: "reflections" },
    label: "Осмысление",
    description: "Записи, вопросы и наблюдения",
    icon: BookOpenText
  },
  {
    route: { kind: "tool", tool: "insights" },
    label: "Аналитика",
    description: "Ритм, нагрузка и закономерности",
    icon: BarChart3
  },
  {
    route: { kind: "tool", tool: "integrations" },
    label: "Интеграции",
    description: "Календари, Obsidian и внешние сервисы",
    icon: Unplug
  },
  {
    route: { kind: "tool", tool: "settings" },
    label: "Настройки",
    description: "Вид и поведение системы",
    icon: Settings
  }
] satisfies Array<{
  route: Extract<AppRoute, { kind: "tool" }>;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}>;

function isGtdRoute(route: AppRoute): boolean {
  return route.kind === "gtd";
}

function isSphereRoute(route: AppRoute, sphereId: string): boolean {
  return route.kind === "sphere" && route.sphereId === sphereId;
}

export function TopBar({ route, lifeAreas, inboxCount, menuOpen, onMenu, onSearch }: TopBarProps) {
  const { addTask, saving, state } = useDashboard();
  const [title, setTitle] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const visibleAreas = useMemo(
    () => lifeAreas
      .filter((area) => !area.archived && area.showInTopNavigation !== false)
      .sort((left, right) => left.order - right.order),
    [lifeAreas]
  );

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    addTask(parseQuickCapture(title, state.projects));
    setTitle("");
  };

  const secondaryActive = secondaryItems.some((item) => routeEquals(route, item.route));
  const gtdRoute: AppRoute = route.kind === "gtd" ? route : { kind: "gtd", section: "tasks" };

  return (
    <header className="topbar-shell">
      <div className="topbar-navigation-row">
        <button
          className="icon-button menu-button"
          type="button"
          onClick={onMenu}
          aria-label="Открыть всё меню"
          aria-controls="app-navigation-drawer"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
        >
          <Menu size={21} />
        </button>

        <AppLink className="topbar-brand" route={{ kind: "home" }} aria-label="На главный экран">
          <span><Sparkles size={18} /></span>
          <strong>Центр</strong>
        </AppLink>

        <nav className="top-primary-nav" aria-label="Основные пространства">
          <AppLink
            className={`topbar-more-button top-primary-link ${route.kind === "home" ? "active" : ""}`}
            route={{ kind: "home" }}
            aria-current={route.kind === "home" ? "page" : undefined}
          >
            <LayoutDashboard size={17} />
            <span>Главная</span>
          </AppLink>
          <AppLink
            className={`topbar-more-button top-primary-link ${isGtdRoute(route) ? "active" : ""}`}
            route={gtdRoute}
            aria-current={isGtdRoute(route) ? "page" : undefined}
          >
            <ListTodo size={17} />
            <span>GTD</span>
            {inboxCount > 0 ? <i title={`${inboxCount} во Входящих`}>{inboxCount}</i> : null}
          </AppLink>
          {visibleAreas.map((area) => {
            const active = isSphereRoute(route, area.id);
            return (
              <AppLink
                key={area.id}
                className={`topbar-more-button top-primary-link ${active ? "active" : ""}`}
                route={{ kind: "sphere", sphereId: area.id }}
                navigation={{ label: area.title }}
                aria-current={active ? "page" : undefined}
              >
                <Compass size={17} style={{ color: active ? area.color : undefined }} />
                <span>{area.title}</span>
              </AppLink>
            );
          })}
        </nav>

        <div className="topbar-more" ref={moreRef}>
          <button
            type="button"
            className={`topbar-more-button ${secondaryActive ? "active" : ""}`}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((value) => !value)}
          >
            Ещё <ChevronDown size={15} />
          </button>
          {moreOpen ? (
            <div className="topbar-more-menu" role="menu" aria-label="Системные инструменты">
              {secondaryItems.map((item) => {
                const Icon = item.icon;
                const active = routeEquals(route, item.route);
                return (
                  <AppLink
                    key={item.route.tool}
                    className={`nav-item topbar-secondary-link ${active ? "active" : ""}`}
                    route={item.route}
                    onClick={() => setMoreOpen(false)}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                  >
                    <span><Icon size={18} /></span>
                    <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  </AppLink>
                );
              })}
            </div>
          ) : null}
        </div>

        <button className="icon-button top-search-button" type="button" onClick={onSearch} aria-label="Поиск по системе">
          <Search size={19} />
        </button>
      </div>

      <div className="topbar-capture-row">
        <form className="quick-capture" onSubmit={submit}>
          <Plus size={19} />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Во Входящие GTD: завтра 30 мин @дом !!"
            aria-label="Быстро добавить задачу"
          />
          <kbd>Enter</kbd>
        </form>
        <div className="save-state" title="Данные сохраняются на этом устройстве">
          <CloudOff size={16} />
          <span>{saving ? "Сохраняю" : "Сохранено локально"}</span>
        </div>
      </div>
    </header>
  );
}
