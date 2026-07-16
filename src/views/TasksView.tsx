import { CheckSquare2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { TaskRow } from "../components/TaskRow";
import { useDashboard } from "../state/DashboardContext";
import type { TaskStatus } from "../types";

const filters: Array<{ id: "open" | TaskStatus; label: string }> = [
  { id: "open", label: "Открытые" },
  { id: "next", label: "Следующие" },
  { id: "planned", label: "Запланированные" },
  { id: "waiting", label: "Ожидание" },
  { id: "someday", label: "Когда-нибудь" },
  { id: "done", label: "Готово" }
];

interface TasksViewProps {
  onEditTask: (taskId: string) => void;
}

export function TasksView({ onEditTask }: TasksViewProps) {
  const { state, toggleTask, addTask } = useDashboard();
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("open");
  const [query, setQuery] = useState("");

  const tasks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return state.tasks.filter((task) => {
      const matchesStatus =
        filter === "open"
          ? !["done", "inbox", "someday"].includes(task.status)
          : task.status === filter;
      const matchesQuery = !normalized || `${task.title} ${task.notes}`.toLocaleLowerCase("ru").includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [filter, query, state.tasks]);

  return (
    <div className="page">
      <section className="page-heading">
        <div><span className="eyebrow">Действия и обязательства</span><h1>Задачи</h1><p>Работайте с ясными следующими действиями, а не с абстрактными намерениями.</p></div>
        <div className="heading-actions"><div className="heading-number"><strong>{state.tasks.filter((task) => task.status !== "done").length}</strong><span>открыто</span></div><button className="primary-button" onClick={() => { const task = addTask({ title: "Новая задача", status: "next" }); onEditTask(task.id); }}><Plus size={17} /> Новая задача</button></div>
      </section>

      <section className="panel tasks-panel">
        <div className="task-toolbar">
          <div className="filter-tabs">
            {filters.map((item) => (
              <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="inline-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label>
        </div>
        {tasks.length ? (
          <div className="task-list">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                project={state.projects.find((project) => project.id === task.projectId)}
                onToggle={() => toggleTask(task.id)}
                onEdit={() => onEditTask(task.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={CheckSquare2} title="Здесь пока пусто" text="Измените фильтр или добавьте новую задачу через строку сверху." />
        )}
      </section>
    </div>
  );
}
