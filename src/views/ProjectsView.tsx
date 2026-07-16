import { ArrowRight, Compass, FolderKanban, Plus, Target, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState } from "../components/EmptyState";
import { TaskRow } from "../components/TaskRow";
import { useDashboard } from "../state/DashboardContext";
import type { ProjectStatus } from "../types";

interface ProjectsViewProps {
  onEditTask: (taskId: string) => void;
  onOpenLife: () => void;
}

export function ProjectsView({ onEditTask, onOpenLife }: ProjectsViewProps) {
  const { state, addProject, updateProject, assignProjectToLifeArea, addTask, toggleTask } = useDashboard();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const selected = state.projects.find((project) => project.id === selectedId) ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const project = addProject(title);
    setTitle("");
    setCreating(false);
    setSelectedId(project.id);
  };

  const addProjectTask = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !newTaskTitle.trim()) return;
    addTask({ title: newTaskTitle, projectId: selected.id, status: "next" });
    setNewTaskTitle("");
  };

  return (
    <div className="page projects-page">
      <section className="page-heading">
        <div><span className="eyebrow">Результаты, требующие нескольких действий</span><h1>Проекты</h1><p>У каждого активного проекта — желаемый результат, контекст и следующий конкретный шаг.</p></div>
        <div className="page-heading-actions"><button className="secondary-button" onClick={onOpenLife}><Compass size={17} /> Сферы жизни</button><button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Новый проект</button></div>
      </section>

      {creating ? (
        <form className="new-project-form panel" onSubmit={submit}>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название проекта" />
          <button className="primary-button" type="submit">Создать</button>
          <button className="secondary-button" type="button" onClick={() => setCreating(false)}>Отмена</button>
        </form>
      ) : null}

      {state.projects.length ? (
        <div className="project-grid">
          {state.projects.map((project) => {
            const tasks = state.tasks.filter((task) => task.projectId === project.id && task.status !== "done");
            const done = state.tasks.filter((task) => task.projectId === project.id && task.status === "done").length;
            const total = tasks.length + done;
            const progress = total ? Math.round((done / total) * 100) : 0;
            return (
              <article className={`project-card ${selectedId === project.id ? "selected" : ""}`} key={project.id} onClick={() => setSelectedId(project.id)} tabIndex={0}>
                <div className="project-accent" style={{ background: project.color }} />
                <div className="project-card-top"><span>{state.lifeAreas.find((area) => area.id === project.areaId)?.title ?? "Без сферы"}</span><span className="status-pill">{project.status === "active" ? "Активен" : project.status === "paused" ? "Пауза" : "Завершён"}</span></div>
                <h2>{project.title}</h2>
                <p>{project.description || "Добавьте описание желаемого результата."}</p>
                <div className="project-progress"><div><span>Прогресс</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%`, background: project.color }} /></div></div>
                <div className="project-footer"><span>{tasks.length} открытых задач</span><button className="icon-button" onClick={(event) => { event.stopPropagation(); setSelectedId(project.id); }}><ArrowRight size={18} /></button></div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel"><EmptyState icon={FolderKanban} title="Проектов пока нет" text="Создайте первый проект и определите его желаемый результат." /></section>
      )}

      {selected ? (() => {
        const tasks = state.tasks.filter((task) => task.projectId === selected.id && task.status !== "done");
        const done = state.tasks.filter((task) => task.projectId === selected.id && task.status === "done").length;
        return (
          <section className="panel project-detail">
            <div className="project-detail-header">
              <div className="project-detail-mark" style={{ background: selected.color }}><Target size={23} /></div>
              <div><span className="eyebrow">Рабочая область проекта</span><input className="project-title-editor" value={selected.title} onChange={(event) => updateProject(selected.id, { title: event.target.value })} /></div>
              <button className="icon-button" onClick={() => setSelectedId(null)}><X size={20} /></button>
            </div>
            <div className="project-detail-grid">
              <div className="project-main-fields">
                <label><span>Желаемый результат</span><textarea rows={4} value={selected.description} onChange={(event) => updateProject(selected.id, { description: event.target.value })} placeholder="Что должно стать правдой после завершения проекта?" /></label>
                <div className="project-property-row">
                  <label><span>Сфера жизни</span><select value={selected.areaId ?? ""} onChange={(event) => assignProjectToLifeArea(selected.id, event.target.value || null)}><option value="">Без сферы</option>{state.lifeAreas.filter((area) => !area.archived || area.id === selected.areaId).sort((left, right) => left.order - right.order).map((area) => <option key={area.id} value={area.id}>{area.title}{area.archived ? " · архив" : ""}</option>)}</select></label>
                  <label><span>Статус</span><select value={selected.status} onChange={(event) => updateProject(selected.id, { status: event.target.value as ProjectStatus })}><option value="active">Активен</option><option value="paused">На паузе</option><option value="completed">Завершён</option></select></label>
                  <label><span>Следующий обзор</span><input type="date" value={selected.nextReviewAt ?? ""} onChange={(event) => updateProject(selected.id, { nextReviewAt: event.target.value || null })} /></label>
                </div>
              </div>
              <aside className="project-health"><div><strong>{tasks.length}</strong><span>открыто</span></div><div><strong>{done}</strong><span>готово</span></div><div><strong>{tasks.reduce((sum, task) => sum + task.estimateMinutes, 0)}</strong><span>минут осталось</span></div></aside>
            </div>
            <div className="project-task-section">
              <div className="panel-heading"><div><span className="eyebrow">Конкретные действия</span><h2>Задачи проекта</h2></div></div>
              <form className="project-task-capture" onSubmit={addProjectTask}><Plus size={17} /><input value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} placeholder="Добавить следующее действие…" /><button type="submit">Добавить</button></form>
              {tasks.length ? <div className="task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} project={selected} onToggle={() => toggleTask(task.id)} onEdit={() => onEditTask(task.id)} />)}</div> : <EmptyState icon={Target} title="Нет открытых действий" text="Добавьте следующий физический шаг или завершите проект." />}
            </div>
          </section>
        );
      })() : null}
    </div>
  );
}
