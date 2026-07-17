import { CalendarDays, CheckSquare2, ClipboardCheck, FolderKanban, Inbox } from "lucide-react";
import { AppLink } from "./AppLink";
import type { GtdSection } from "../navigation/types";

interface GtdNavigationProps {
  active: GtdSection;
  inboxCount: number;
}

const items: Array<{ id: GtdSection; label: string; icon: typeof Inbox }> = [
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "tasks", label: "Задачи", icon: CheckSquare2 },
  { id: "projects", label: "Проекты", icon: FolderKanban },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "review", label: "Обзор", icon: ClipboardCheck }
];

export function GtdNavigation({ active, inboxCount }: GtdNavigationProps) {
  return (
    <nav className="gtd-navigation" aria-label="Разделы GTD">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <AppLink
            key={item.id}
            route={{ kind: "gtd", section: item.id }}
            className={active === item.id ? "active" : ""}
            aria-current={active === item.id ? "page" : undefined}
          >
            <Icon size={17} />
            <span>{item.label}</span>
            {item.id === "inbox" && inboxCount ? <i>{inboxCount}</i> : null}
          </AppLink>
        );
      })}
    </nav>
  );
}

