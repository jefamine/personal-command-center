import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  ClipboardCheck,
  CloudOff,
  Compass,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Unplug
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseQuickCapture } from "../lib/quickCapture";
import { useDashboard } from "../state/DashboardContext";
import type { ViewId } from "../types";

interface TopBarProps {
  activeView: ViewId;
  inboxCount: number;
  onMenu: () => void;
  onSearch: () => void;
  onSelect: (view: ViewId) => void;
}

const primaryItems: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "today", label: "Сегодня", icon: LayoutDashboard },
  { id: "life", label: "Сферы жизни", icon: Compass },
  { id: "tasks", label: "Задачи", icon: CheckSquare2 },
  { id: "calendar", label: "Время", icon: CalendarDays },
  { id: "projects", label: "Проекты", icon: FolderKanban },
  { id: "journal", label: "Дневник", icon: BookOpenText }
];

const secondaryItems: Array<{ id: ViewId; label: string; description: string; icon: typeof LayoutDashboard }> = [
  { id: "inbox", label: "Входящие", description: "Неразобранное", icon: Inbox },
  { id: "notes", label: "Заметки", description: "Знания и Obsidian", icon: NotebookPen },
  { id: "review", label: "Обзор", description: "Еженедельная ясность", icon: ClipboardCheck },
  { id: "insights", label: "Аналитика", description: "Ритм и нагрузка", icon: BarChart3 },
  { id: "integrations", label: "Интеграции", description: "Google, Obsidian, Codex", icon: Unplug },
  { id: "settings", label: "Настройки", description: "Вид и поведение", icon: Settings }
];

export function TopBar({ activeView, inboxCount, onMenu, onSearch, onSelect }: TopBarProps) {
  const { addTask, saving, state } = useDashboard();
  const [title, setTitle] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
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

  const select = (view: ViewId) => {
    onSelect(view);
    setMoreOpen(false);
  };

  const secondaryActive = secondaryItems.some((item) => item.id === activeView);

  return (
    <header className="topbar-shell">
      <div className="topbar-navigation-row">
        <button className="icon-button menu-button" onClick={onMenu} aria-label="Открыть всё меню">
          <Menu size={21} />
        </button>

        <button type="button" className="topbar-brand" onClick={() => select("today")} aria-label="На главный экран">
          <span><Sparkles size={18} /></span>
          <strong>Центр</strong>
        </button>

        <nav className="top-primary-nav" aria-label="Основные разделы">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => select(item.id)}>
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="topbar-more" ref={moreRef}>
          <button type="button" className={`topbar-more-button ${secondaryActive ? "active" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
            Ещё <ChevronDown size={15} />
            {inboxCount ? <i>{inboxCount}</i> : null}
          </button>
          {moreOpen ? (
            <div className="topbar-more-menu" role="menu">
              {secondaryItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => select(item.id)} role="menuitem">
                    <span><Icon size={18} /></span>
                    <div><strong>{item.label}</strong><small>{item.description}</small></div>
                    {item.id === "inbox" && inboxCount ? <i>{inboxCount}</i> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button className="icon-button top-search-button" onClick={onSearch} aria-label="Поиск по задачам">
          <Search size={19} />
        </button>
      </div>

      <div className="topbar-capture-row">
        <form className="quick-capture" onSubmit={submit}>
          <Plus size={19} />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Быстро добавить задачу: завтра 30 мин @дом !!"
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
