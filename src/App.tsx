import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { TaskEditor } from "./components/TaskEditor";
import { TopBar } from "./components/TopBar";
import { CalendarView } from "./views/CalendarView";
import { InboxView } from "./views/InboxView";
import { IntegrationsView } from "./views/IntegrationsView";
import { InsightsView } from "./views/InsightsView";
import { JournalView } from "./views/JournalView";
import { LifeView } from "./views/LifeView";
import { NotesView } from "./views/NotesView";
import { ProjectsView } from "./views/ProjectsView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";
import { TasksView } from "./views/TasksView";
import { TodayView } from "./views/TodayView";
import { useDashboard } from "./state/DashboardContext";
import type { ViewId } from "./types";

const viewIds: ViewId[] = [
  "today",
  "life",
  "inbox",
  "tasks",
  "projects",
  "calendar",
  "journal",
  "notes",
  "integrations",
  "review",
  "insights",
  "settings"
];

function readableTextColor(hex: string) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "cfee45";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.52 ? "#101410" : "#ffffff";
}

function initialView(): ViewId {
  const requested = new URLSearchParams(window.location.search).get("view") as ViewId | null;
  return requested && viewIds.includes(requested) ? requested : "today";
}

export default function App() {
  const { state, ready } = useDashboard();
  const [view, setView] = useState<ViewId>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

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
    const url = new URL(window.location.href);
    if (view === "today") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
  }, [view]);

  if (!ready) {
    return <div className="app-loading"><div className="loading-mark" /><span>Собираю ваш день…</span></div>;
  }

  const content = (() => {
    switch (view) {
      case "today": return <TodayView onOpenInbox={() => setView("inbox")} onOpenTasks={() => setView("tasks")} onEditTask={setEditingTaskId} onNavigate={setView} />;
      case "life": return <LifeView onOpenProjects={() => setView("projects")} />;
      case "inbox": return <InboxView />;
      case "tasks": return <TasksView onEditTask={setEditingTaskId} />;
      case "projects": return <ProjectsView onEditTask={setEditingTaskId} onOpenLife={() => setView("life")} />;
      case "calendar": return <CalendarView />;
      case "journal": return <JournalView onOpenNote={(noteId) => { setSelectedNoteId(noteId); setView("notes"); }} />;
      case "notes": return <NotesView initialNoteId={selectedNoteId} />;
      case "integrations": return <IntegrationsView />;
      case "review": return <ReviewView onNavigate={setView} />;
      case "insights": return <InsightsView />;
      case "settings": return <SettingsView />;
    }
  })();

  return (
    <div className="app-shell">
      <Sidebar
        activeView={view}
        open={menuOpen}
        collapsed={false}
        peeking={false}
        onSelect={setView}
        onClose={() => setMenuOpen(false)}
        onToggleCollapse={() => setMenuOpen(false)}
        onPeekStart={() => undefined}
        onPeekEnd={() => undefined}
        inboxCount={state.tasks.filter((task) => task.status === "inbox").length}
      />
      <div className="app-main sidebar-collapsed">
        <TopBar
          activeView={view}
          inboxCount={state.tasks.filter((task) => task.status === "inbox").length}
          onMenu={() => setMenuOpen(true)}
          onSearch={() => setView("tasks")}
          onSelect={setView}
        />
        <main>{content}</main>
      </div>
      <TaskEditor taskId={editingTaskId} onClose={() => setEditingTaskId(null)} />
      <MobileNav activeView={view} inboxCount={state.tasks.filter((task) => task.status === "inbox").length} onSelect={setView} />
    </div>
  );
}
