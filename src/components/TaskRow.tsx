import { CalendarClock, Circle, CircleCheck, Clock3, MoreHorizontal, Repeat2 } from "lucide-react";
import { formatDateHuman } from "../lib/date";
import type { Project, Task } from "../types";

interface TaskRowProps {
  task: Task;
  project?: Project;
  compact?: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  trailing?: React.ReactNode;
}

const priorityLabels: Record<Task["priority"], string> = {
  1: "Низкий",
  2: "Обычный",
  3: "Важный",
  4: "Критичный"
};

export function TaskRow({ task, project, compact = false, onToggle, onEdit, trailing }: TaskRowProps) {
  const done = task.status === "done";
  return (
    <div className={`task-row ${done ? "is-done" : ""} ${compact ? "is-compact" : ""}`}>
      <button className="task-check" onClick={onToggle} aria-label={done ? "Вернуть задачу" : "Завершить задачу"}>
        {done ? <CircleCheck size={22} /> : <Circle size={22} />}
      </button>
      <div className="task-content">
        <div className="task-title-line">
          <strong>{task.title}</strong>
          {task.priority >= 3 ? (
            <span className={`priority-dot p${task.priority}`} title={priorityLabels[task.priority]} />
          ) : null}
        </div>
        {!compact ? (
          <div className="task-meta">
            {project ? (
              <span>
                <i style={{ background: project.color }} />
                {project.title}
              </span>
            ) : null}
            <span>
              <Clock3 size={14} /> {task.estimateMinutes} мин
            </span>
            {task.dueDate ? (
              <span className={task.dueDate < new Date().toISOString().slice(0, 10) ? "danger-text" : ""}>
                <CalendarClock size={14} /> {formatDateHuman(task.dueDate)}
              </span>
            ) : null}
            <span className="context-chip">{task.context}</span>
            {task.recurrence !== "none" ? <span><Repeat2 size={13} /> повторяется</span> : null}
          </div>
        ) : null}
      </div>
      {trailing ?? (
        <button className="icon-button subtle" onClick={onEdit} aria-label="Редактировать задачу">
          <MoreHorizontal size={18} />
        </button>
      )}
    </div>
  );
}
