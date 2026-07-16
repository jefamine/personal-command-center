import { BookOpenText, CalendarDays, CheckSquare2, Compass, LayoutDashboard } from "lucide-react";
import type { ViewId } from "../types";

interface MobileNavProps {
  activeView: ViewId;
  inboxCount: number;
  onSelect: (view: ViewId) => void;
}

const items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "today", label: "Сегодня", icon: LayoutDashboard },
  { id: "tasks", label: "Задачи", icon: CheckSquare2 },
  { id: "calendar", label: "Время", icon: CalendarDays },
  { id: "life", label: "Жизнь", icon: Compass },
  { id: "journal", label: "Дневник", icon: BookOpenText }
];

export function MobileNav({ activeView, inboxCount, onSelect }: MobileNavProps) {
  return (
    <nav className="mobile-nav" aria-label="Мобильная навигация">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => onSelect(item.id)}>
            <span><Icon size={19} />{item.id === "inbox" && inboxCount ? <i>{inboxCount}</i> : null}</span>
            <small>{item.label}</small>
          </button>
        );
      })}
    </nav>
  );
}
