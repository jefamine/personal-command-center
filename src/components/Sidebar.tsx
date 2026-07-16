import {
  CalendarDays,
  BookOpenText,
  ChartNoAxesColumnIncreasing,
  CheckSquare2,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import type { ViewId } from "../types";

interface SidebarProps {
  activeView: ViewId;
  open: boolean;
  collapsed: boolean;
  peeking: boolean;
  onSelect: (view: ViewId) => void;
  onClose: () => void;
  onToggleCollapse: () => void;
  onPeekStart: () => void;
  onPeekEnd: () => void;
  inboxCount: number;
}

const mainItems: Array<{
  id: ViewId;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "today", label: "Сегодня", icon: LayoutDashboard },
  { id: "life", label: "Сферы жизни", icon: Compass },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "tasks", label: "Задачи", icon: CheckSquare2 },
  { id: "projects", label: "Проекты", icon: FolderKanban },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "journal", label: "Дневник", icon: BookOpenText },
  { id: "notes", label: "Заметки", icon: NotebookPen },
  { id: "integrations", label: "Интеграции", icon: PlugZap },
  { id: "review", label: "Обзор", icon: ClipboardCheck },
  { id: "insights", label: "Аналитика", icon: ChartNoAxesColumnIncreasing }
];

export function Sidebar({
  activeView,
  open,
  collapsed,
  peeking,
  onSelect,
  onClose,
  onToggleCollapse,
  onPeekStart,
  onPeekEnd,
  inboxCount
}: SidebarProps) {
  const select = (view: ViewId) => {
    onSelect(view);
    onClose();
  };

  return (
    <>
      <div className={`sidebar-scrim ${open ? "is-open" : ""}`} onClick={onClose} />
      {collapsed ? <button type="button" className="sidebar-edge-trigger" onMouseEnter={onPeekStart} onFocus={onPeekStart} onClick={onToggleCollapse} aria-label="Показать и закрепить боковую панель" title="Показать меню"><ChevronRight size={16} /></button> : null}
      <aside className={`sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""} ${peeking ? "is-peeking" : ""}`} onMouseEnter={onPeekStart} onMouseLeave={onPeekEnd}>
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={20} strokeWidth={2.2} />
          </div>
          <div>
            <strong>Командный центр</strong>
            <span>Личная система</span>
          </div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Закрыть меню">
            <X size={20} />
          </button>
          <button className="icon-button sidebar-collapse" onClick={onToggleCollapse} aria-label={collapsed ? "Закрепить боковую панель" : "Полностью скрыть боковую панель"} title={collapsed ? "Закрепить панель" : "Скрыть панель"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="main-nav" aria-label="Основная навигация">
          <span className="nav-caption">Рабочее пространство</span>
          {mainItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? "active" : ""}`}
                onClick={() => select(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={19} strokeWidth={1.9} />
                <span>{item.label}</span>
                {item.id === "inbox" && inboxCount > 0 ? (
                  <span className="nav-badge">{inboxCount}</span>
                ) : null}
              </button>
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
          <button
            className={`nav-item ${activeView === "settings" ? "active" : ""}`}
            onClick={() => select("settings")}
            title={collapsed ? "Настройки" : undefined}
          >
            <Settings size={19} strokeWidth={1.9} />
            <span>Настройки</span>
          </button>
        </div>
      </aside>
    </>
  );
}
