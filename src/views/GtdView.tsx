import { Layers3 } from "lucide-react";
import { GtdNavigation } from "../components/GtdNavigation";
import { useAppNavigation } from "../navigation/NavigationContext";
import { legacyViewToRoute } from "../navigation/router";
import type { GtdSection } from "../navigation/types";
import { useDashboard } from "../state/DashboardContext";
import type { ViewId } from "../types";
import { CalendarView } from "./CalendarView";
import { InboxView } from "./InboxView";
import { ProjectsView } from "./ProjectsView";
import { ReviewView } from "./ReviewView";
import { TasksView } from "./TasksView";

interface GtdViewProps {
  section: GtdSection;
  onEditTask: (taskId: string) => void;
}

export function GtdView({ section, onEditTask }: GtdViewProps) {
  const { state } = useDashboard();
  const { navigate } = useAppNavigation();
  const inboxCount = state.tasks.filter((task) => task.status === "inbox").length;
  const navigateLegacy = (view: ViewId) => navigate(legacyViewToRoute(view));

  return (
    <div className="gtd-space">
      <section className="gtd-space-heading">
        <div>
          <span className="eyebrow"><Layers3 size={14} /> Сфера организации жизни</span>
          <h1>GTD</h1>
          <p>Собирайте, проясняйте и выполняйте. Метод остаётся готовой основой, а его списки можно настраивать.</p>
        </div>
        <span className="gtd-space-status"><strong>{inboxCount}</strong> во входящих</span>
      </section>
      <GtdNavigation active={section} inboxCount={inboxCount} />
      <div className="gtd-section-content">
        {section === "inbox" ? <InboxView /> : null}
        {section === "tasks" ? <TasksView onEditTask={onEditTask} /> : null}
        {section === "projects" ? <ProjectsView onEditTask={onEditTask} onOpenLife={() => navigate({ kind: "tool", tool: "sphere-manager" })} /> : null}
        {section === "calendar" ? <CalendarView /> : null}
        {section === "review" ? <ReviewView onNavigate={navigateLegacy} /> : null}
      </div>
    </div>
  );
}

