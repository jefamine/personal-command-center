import { CalendarDays, Clock3, Repeat2, Save, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useDashboard } from "../state/DashboardContext";
import type { EnergyLevel, RecurrenceRule, Task, TaskStatus } from "../types";

interface TaskEditorProps {
  taskId: string | null;
  onClose: () => void;
}

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: "inbox", label: "Входящие" },
  { value: "next", label: "Следующее действие" },
  { value: "planned", label: "Запланировано" },
  { value: "waiting", label: "Ожидание" },
  { value: "someday", label: "Когда-нибудь" },
  { value: "done", label: "Готово" }
];

const energyOptions: Array<{ value: EnergyLevel; label: string }> = [
  { value: "low", label: "Низкая" },
  { value: "medium", label: "Средняя" },
  { value: "high", label: "Высокая" }
];

const recurrenceOptions: Array<{ value: RecurrenceRule; label: string }> = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekdays", label: "По будням" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "monthly", label: "Каждый месяц" }
];

export function TaskEditor({ taskId, onClose }: TaskEditorProps) {
  const { state, updateTask, removeTask } = useDashboard();
  const task = state.tasks.find((entry) => entry.id === taskId) ?? null;
  const [form, setForm] = useState<Task | null>(task);

  useEffect(() => setForm(task), [task]);
  useEffect(() => {
    if (!taskId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, taskId]);

  if (!taskId || !task || !form) return null;

  const patch = <K extends keyof Task>(key: K, value: Task[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    updateTask(task.id, {
      title: form.title.trim(),
      notes: form.notes,
      status: form.status,
      projectId: form.projectId,
      priority: form.priority,
      estimateMinutes: Math.max(5, form.estimateMinutes),
      energy: form.energy,
      context: form.context.trim() || "Везде",
      dueDate: form.dueDate || null,
      scheduledDate: form.scheduledDate || null,
      recurrence: form.recurrence,
      completedAt:
        form.status === "done"
          ? form.completedAt ?? new Date().toISOString()
          : null
    });
    onClose();
  };

  const remove = () => {
    if (!window.confirm("Переместить эту задачу в корзину? Связанные фокус-блоки тоже можно будет восстановить.")) return;
    removeTask(task.id);
    onClose();
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <form
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Редактор задачи"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="editor-header">
          <div>
            <span className="eyebrow">Параметры действия</span>
            <h2>Редактировать задачу</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="editor-body">
          <label className="editor-title-field">
            <span>Название</span>
            <input autoFocus value={form.title} onChange={(event) => patch("title", event.target.value)} />
          </label>

          <div className="editor-grid">
            <label>
              <span>Статус</span>
              <select value={form.status} onChange={(event) => patch("status", event.target.value as TaskStatus)}>
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Проект</span>
              <select value={form.projectId ?? ""} onChange={(event) => patch("projectId", event.target.value || null)}>
                <option value="">Без проекта</option>
                {state.projects.filter((project) => project.status === "active").map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </label>
            <label>
              <span><Clock3 size={13} /> Длительность, минут</span>
              <input type="number" min="5" max="720" step="5" value={form.estimateMinutes} onChange={(event) => patch("estimateMinutes", Number(event.target.value))} />
            </label>
            <label>
              <span>Энергия</span>
              <select value={form.energy} onChange={(event) => patch("energy", event.target.value as EnergyLevel)}>
                {energyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span><CalendarDays size={13} /> Срок</span>
              <input type="date" value={form.dueDate ?? ""} onChange={(event) => patch("dueDate", event.target.value || null)} />
            </label>
            <label>
              <span><CalendarDays size={13} /> Предпочтительный день</span>
              <input type="date" value={form.scheduledDate ?? ""} onChange={(event) => patch("scheduledDate", event.target.value || null)} />
            </label>
            <label>
              <span>Контекст</span>
              <input value={form.context} onChange={(event) => patch("context", event.target.value)} placeholder="Компьютер, звонки, дом…" />
            </label>
            <label>
              <span><Repeat2 size={13} /> Повторение</span>
              <select value={form.recurrence} onChange={(event) => patch("recurrence", event.target.value as RecurrenceRule)}>
                {recurrenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <fieldset className="priority-field">
              <legend>Приоритет</legend>
              <div className="priority-options">
                {([1, 2, 3, 4] as const).map((priority) => (
                  <button
                    type="button"
                    key={priority}
                    className={form.priority === priority ? "active" : ""}
                    onClick={() => patch("priority", priority)}
                  >
                    {priority}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <label className="editor-notes">
            <span>Заметки и критерий готовности</span>
            <textarea rows={4} value={form.notes} onChange={(event) => patch("notes", event.target.value)} placeholder="Что именно должно получиться?" />
          </label>
        </div>

        <div className="editor-footer">
          <button className="delete-task-button" type="button" onClick={remove}><Trash2 size={17} /> Удалить</button>
          <div>
            <button className="secondary-button" type="button" onClick={onClose}>Отмена</button>
            <button className="primary-button" type="submit"><Save size={17} /> Сохранить</button>
          </div>
        </div>
      </form>
    </div>
  );
}
