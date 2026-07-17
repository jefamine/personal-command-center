import { lazy, Suspense, useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { MobileNav } from "./components/MobileNav";
import { NavigationTrail } from "./components/NavigationTrail";
import { Sidebar } from "./components/Sidebar";
import { TaskEditor } from "./components/TaskEditor";
import { TopBar } from "./components/TopBar";
import { legacyObjectReference } from "./domain/objects/legacyAdapter";
import { useAppNavigation } from "./navigation/NavigationContext";
import { legacyViewToRoute } from "./navigation/router";
import { useDashboard } from "./state/DashboardContext";
import type { ViewId } from "./types";
import { GtdView } from "./views/GtdView";
import { TodayView } from "./views/TodayView";

const InsightsView = lazy(() => import("./views/InsightsView").then((module) => ({ default: module.InsightsView })));
const IntegrationsView = lazy(() => import("./views/IntegrationsView").then((module) => ({ default: module.IntegrationsView })));
const JournalView = lazy(() => import("./views/JournalView").then((module) => ({ default: module.JournalView })));
const LifeView = lazy(() => import("./views/LifeView").then((module) => ({ default: module.LifeView })));
const ObjectView = lazy(() => import("./views/ObjectView").then((module) => ({ default: module.ObjectView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((module) => ({ default: module.SettingsView })));
const SphereView = lazy(() => import("./views/SphereView").then((module) => ({ default: module.SphereView })));
const WorkspaceView = lazy(() => import("./views/WorkspaceView").then((module) => ({ default: module.WorkspaceView })));

function readableTextColor(hex: string) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "cfee45";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.52 ? "#101410" : "#ffffff";
}

export default function App() {
  const { state, ready, storageError, updateSettings } = useDashboard();
  const { route, navigate } = useAppNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarPeeking, setSidebarPeeking] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);

  const openMenu = useCallback((event?: SyntheticEvent<HTMLElement>) => {
    const trigger = event?.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (trigger) menuTriggerRef.current = trigger;
    setSidebarPeeking(false);
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setSidebarPeeking(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setMenuOpen(false);
    setSidebarPeeking(false);
    updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed });
  }, [state.settings.sidebarCollapsed, updateSettings]);

  const handleTopMenu = useCallback(() => {
    if (window.matchMedia("(min-width: 1181px)").matches) {
      toggleSidebar();
      return;
    }
    openMenu();
  }, [openMenu, toggleSidebar]);

  const startSidebarPeek = useCallback(() => {
    if (state.settings.sidebarCollapsed && !menuOpen) setSidebarPeeking(true);
  }, [menuOpen, state.settings.sidebarCollapsed]);

  const endSidebarPeek = useCallback(() => {
    if (!menuOpen) setSidebarPeeking(false);
  }, [menuOpen]);

  useEffect(() => {
    const root = document.documentElement;
    const { theme, accentColor, secondaryColor, surfaceTone, visualStyle, density, cornerStyle } = state.settings;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.dataset.surface = surfaceTone;
    root.dataset.visual = visualStyle;
    root.dataset.density = density;
    root.dataset.corners = cornerStyle;
    root.dataset.fontScale = state.settings.fontScale;
    root.style.setProperty("--accent", accentColor);
    root.style.setProperty("--accent-contrast", readableTextColor(accentColor));
    root.style.setProperty("--violet", secondaryColor);
  }, [state.settings]);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  if (!ready) {
    return <div className="app-loading"><div className="loading-mark" /><span>Собираю ваш день…</span></div>;
  }

  if (storageError) {
    return (
      <div className="app-storage-error" role="alert">
        <div>
          <span>Локальные данные не изменены</span>
          <h1>Не удалось безопасно открыть хранилище</h1>
          <p>{storageError}</p>
          <p>Автосохранение остановлено, поэтому исходная база не будет перезаписана. Восстановите данные из резервной копии или обновите приложение.</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>Попробовать снова</button>
        </div>
      </div>
    );
  }

  const navigateLegacy = (view: ViewId) => navigate(legacyViewToRoute(view));
  const inboxCount = state.tasks.filter((task) => task.status === "inbox").length;

  const content = (() => {
    if (route.kind === "home") {
      return (
        <TodayView
          onOpenInbox={() => navigate({ kind: "gtd", section: "inbox" })}
          onOpenTasks={() => navigate({ kind: "gtd", section: "tasks" })}
          onEditTask={setEditingTaskId}
          onNavigate={navigateLegacy}
          onOpenWorkspace={(documentId) => navigate(
            { kind: "tool", tool: "workspace", ...(documentId ? { documentId } : {}) },
            { preserveTrail: true, label: documentId ? "Документ" : "Рабочее пространство" }
          )}
        />
      );
    }
    if (route.kind === "gtd") return <GtdView section={route.section} onEditTask={setEditingTaskId} />;
    if (route.kind === "sphere") return <SphereView sphereId={route.sphereId} />;
    if (route.kind === "object") return <ObjectView objectId={route.objectId} onEditTask={setEditingTaskId} />;

    switch (route.tool) {
      case "workspace":
        return <WorkspaceView documentId={route.documentId} />;
      case "sphere-manager":
        return <LifeView onOpenProjects={() => navigate({ kind: "gtd", section: "projects" })} />;
      case "reflections":
        return (
          <JournalView
            onOpenNote={(noteId) => navigate(
              { kind: "tool", tool: "workspace", documentId: legacyObjectReference("note", noteId) },
              { preserveTrail: true }
            )}
            onOpenWorkspace={() => navigate(
              { kind: "tool", tool: "workspace" },
              { preserveTrail: true }
            )}
          />
        );
      case "insights":
        return <InsightsView />;
      case "integrations":
        return <IntegrationsView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  return (
    <div className="app-shell">
      <Sidebar
        route={route}
        lifeAreas={state.lifeAreas}
        open={menuOpen}
        collapsed={state.settings.sidebarCollapsed}
        peeking={sidebarPeeking}
        modal={menuOpen}
        returnFocusRef={menuTriggerRef}
        onClose={closeMenu}
        onToggleCollapse={toggleSidebar}
        onPeekStart={startSidebarPeek}
        onPeekEnd={endSidebarPeek}
        inboxCount={inboxCount}
      />
      <div className={`app-main ${state.settings.sidebarCollapsed ? "sidebar-collapsed" : ""}`} inert={menuOpen}>
        <TopBar
          route={route}
          lifeAreas={state.lifeAreas}
          inboxCount={inboxCount}
          menuOpen={menuOpen}
          onMenu={handleTopMenu}
          onSearch={() => navigate({ kind: "gtd", section: "tasks" })}
        />
        <NavigationTrail />
        <main ref={mainRef} tabIndex={-1}>
          <Suspense fallback={<div className="view-loading" role="status">Открываю пространство…</div>}>
            {content}
          </Suspense>
        </main>
      </div>
      <div className="app-background-overlays" inert={menuOpen}>
        <TaskEditor taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />
        <MobileNav route={route} inboxCount={inboxCount} onMenu={openMenu} />
      </div>
    </div>
  );
}
