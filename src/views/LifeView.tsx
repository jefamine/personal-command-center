import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Compass,
  FolderKanban,
  Layers3,
  Plus,
  Target,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EmptyState } from "../components/EmptyState";
import { projectLifeAreaTitle } from "../domain/life/lifeAreas";
import { useDashboard } from "../state/DashboardContext";

interface LifeViewProps {
  onOpenProjects: () => void;
}

const colorOptions = ["#7c5cff", "#2f80ed", "#2eb67d", "#e28a38", "#d96aa7", "#7a8b3a"];

export function LifeView({ onOpenProjects }: LifeViewProps) {
  const {
    state,
    addLifeArea,
    updateLifeArea,
    moveLifeArea,
    removeLifeArea,
    assignProjectToLifeArea
  } = useDashboard();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newColor, setNewColor] = useState(colorOptions[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState(colorOptions[0]);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");

  const selected = state.lifeAreas.find((area) => area.id === selectedId) ?? null;
  const visibleAreas = useMemo(
    () => [...state.lifeAreas]
      .filter((area) => showArchived || !area.archived)
      .sort((left, right) => left.order - right.order),
    [showArchived, state.lifeAreas]
  );
  const activeAreas = useMemo(
    () => [...state.lifeAreas]
      .filter((area) => !area.archived)
      .sort((left, right) => left.order - right.order),
    [state.lifeAreas]
  );
  const selectedActiveIndex = selected ? activeAreas.findIndex((area) => area.id === selected.id) : -1;
  const unassignedProjects = state.projects.filter((project) => !project.areaId);
  const activeProjects = state.projects.filter((project) => project.status === "active");
  const openTasks = state.tasks.filter((task) => task.status !== "done");

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDescription(selected.description);
    setEditColor(selected.color);
    setConfirmDelete(false);
    setMessage("");
  }, [selected]);

  const createArea = (event: FormEvent) => {
    event.preventDefault();
    const area = addLifeArea({ title: newTitle, description: newDescription, color: newColor });
    if (!area) {
      setMessage("Введите уникальное название сферы.");
      return;
    }
    setNewTitle("");
    setNewDescription("");
    setNewColor(colorOptions[(state.lifeAreas.length + 1) % colorOptions.length]);
    setCreating(false);
    setSelectedId(area.id);
  };

  const saveArea = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (!updateLifeArea(selected.id, {
      title: editTitle,
      description: editDescription,
      color: editColor
    })) {
      setMessage("Название не должно быть пустым или повторять другую сферу.");
      return;
    }
    setMessage("Сфера сохранена.");
  };

  const deleteSelected = () => {
    if (!selected || !removeLifeArea(selected.id)) return;
    setSelectedId(null);
    setConfirmDelete(false);
  };

  return (
    <div className="page life-page">
      <section className="page-heading life-heading">
        <div>
          <span className="eyebrow"><Compass size={14} /> Контекст, в котором разворачивается жизнь</span>
          <h1>Сферы жизни</h1>
          <p>Это карта проектов и внимания, а не оценка «баланса». Сфера помогает видеть контекст, но не требует размечать каждую задачу или желание.</p>
        </div>
        <div className="life-heading-actions">
          <button className="secondary-button" onClick={onOpenProjects}><FolderKanban size={17} /> Проекты</button>
          <button className="primary-button" onClick={() => { setCreating(true); setMessage(""); }}><Plus size={18} /> Новая сфера</button>
        </div>
      </section>

      <section className="life-summary" aria-label="Краткий обзор сфер">
        <article><span><Layers3 size={18} /></span><div><strong>{state.lifeAreas.filter((area) => !area.archived).length}</strong><small>активных сфер</small></div></article>
        <article><span><Target size={18} /></span><div><strong>{activeProjects.length}</strong><small>активных проектов</small></div></article>
        <article><span><Check size={18} /></span><div><strong>{openTasks.length}</strong><small>открытых действий</small></div></article>
        <article className={unassignedProjects.length ? "needs-attention" : ""}><span><Compass size={18} /></span><div><strong>{unassignedProjects.length}</strong><small>проектов без сферы</small></div></article>
      </section>

      {creating ? (
        <form className="panel life-area-create" onSubmit={createArea}>
          <div className="life-area-create-copy"><span className="eyebrow">Новый контекст</span><h2>Добавить сферу жизни</h2><p>Например: работа, отношения, обучение, творчество. Добавляйте только то, что помогает ориентироваться.</p></div>
          <label><span>Название</span><input autoFocus maxLength={80} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Например, Творчество" /></label>
          <label><span>Короткое пояснение</span><textarea rows={3} maxLength={600} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Что здесь для вас важно? Можно оставить пустым." /></label>
          <div className="life-color-field"><span>Цвет</span><div>{colorOptions.map((color) => <button type="button" key={color} className={newColor === color ? "selected" : ""} style={{ "--area-color": color } as React.CSSProperties} onClick={() => setNewColor(color)} aria-label={`Выбрать цвет ${color}`}><i /></button>)}</div></div>
          <div className="life-form-actions"><button className="primary-button" type="submit" disabled={!newTitle.trim()}><Plus size={16} /> Добавить</button><button className="secondary-button" type="button" onClick={() => setCreating(false)}>Отмена</button></div>
          {message ? <p className="life-form-message" role="status">{message}</p> : null}
        </form>
      ) : null}

      <div className="life-section-heading">
        <div><span className="eyebrow">Карта контекстов</span><h2>{showArchived ? "Все сферы" : "Активные сферы"}</h2></div>
        {state.lifeAreas.some((area) => area.archived) ? <button className="text-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Скрыть архив" : "Показать архив"}</button> : null}
      </div>

      {visibleAreas.length ? (
        <section className="life-area-grid">
          {visibleAreas.map((area) => {
            const projects = state.projects.filter((project) => project.areaId === area.id);
            const active = projects.filter((project) => project.status === "active");
            const projectIds = new Set(projects.map((project) => project.id));
            const tasks = openTasks.filter((task) => task.projectId && projectIds.has(task.projectId));
            const minutes = tasks.reduce((sum, task) => sum + task.estimateMinutes, 0);
            const withoutAction = active.filter((project) => !tasks.some((task) => task.projectId === project.id)).length;
            return (
              <article className={`life-area-card ${area.archived ? "is-archived" : ""}`} key={area.id} style={{ "--area-color": area.color } as React.CSSProperties}>
                <div className="life-area-accent" />
                <header><span className="life-area-mark"><Compass size={19} /></span><div><small>{area.archived ? "В архиве" : "Сфера жизни"}</small><h2>{area.title}</h2></div><button className="small-button" onClick={() => setSelectedId(area.id)} aria-label={`Настроить сферу ${area.title}`}>Настроить</button></header>
                <p>{area.description || "Добавьте пояснение, чтобы зафиксировать смысл этой сферы для себя."}</p>
                <div className="life-area-metrics"><span><strong>{active.length}</strong><small>активных проектов</small></span><span><strong>{tasks.length}</strong><small>открытых действий</small></span><span><strong>{minutes}</strong><small>минут в задачах</small></span></div>
                {active.length ? <div className="life-area-projects">{active.slice(0, 3).map((project) => <button key={project.id} onClick={onOpenProjects}><i style={{ background: project.color }} /><span>{project.title}</span><ArrowRight size={14} /></button>)}</div> : <div className="life-area-empty">Здесь пока нет активных проектов.</div>}
                {withoutAction ? <small className="life-area-observation">{withoutAction} {withoutAction === 1 ? "проект без открытого действия" : "проекта без открытых действий"}</small> : null}
              </article>
            );
          })}
        </section>
      ) : (
        <section className="panel life-empty"><EmptyState icon={Compass} title="Карта пока пуста" text="Создайте одну сферу, если она поможет связать проекты общим контекстом. Можно продолжать пользоваться системой и без неё." /><button className="primary-button" onClick={() => setCreating(true)}><Plus size={17} /> Создать первую сферу</button></section>
      )}

      {unassignedProjects.length ? (
        <section className="panel unassigned-projects">
          <div><span className="unassigned-projects-mark"><Compass size={19} /></span><span><strong>Проекты без сферы</strong><small>Это нормально. Связь можно добавить сейчас или оставить проект самостоятельным.</small></span></div>
          <div>{unassignedProjects.slice(0, 6).map((project) => <button key={project.id} onClick={onOpenProjects}><i style={{ background: project.color }} />{project.title}<ArrowRight size={14} /></button>)}</div>
        </section>
      ) : null}

      {selected ? (
        <section className="life-area-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
          <div className="life-area-editor" role="dialog" aria-modal="true" aria-labelledby="life-area-editor-title">
            <header><div><span className="eyebrow">Управление сферой</span><h2 id="life-area-editor-title">{selected.title}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Закрыть"><X size={20} /></button></header>
            <form className="life-area-editor-form" onSubmit={saveArea}>
              <label><span>Название</span><input maxLength={80} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
              <label><span>Что объединяет эта сфера</span><textarea rows={4} maxLength={600} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="Необязательное пояснение" /></label>
              <div className="life-color-field"><span>Цвет</span><div>{colorOptions.map((color) => <button type="button" key={color} className={editColor === color ? "selected" : ""} style={{ "--area-color": color } as React.CSSProperties} onClick={() => setEditColor(color)} aria-label={`Выбрать цвет ${color}`}><i /></button>)}</div></div>
              <section className="life-navigation-settings" aria-label="Положение сферы в навигации">
                <div>
                  <strong>Навигационная панель</strong>
                  <small>Сфера всегда остаётся в полном выезжающем меню. Здесь настраивается верхняя строка и порядок.</small>
                </div>
                <label className="life-navigation-toggle">
                  <input
                    type="checkbox"
                    checked={selected.showInTopNavigation !== false}
                    onChange={(event) => updateLifeArea(selected.id, { showInTopNavigation: event.target.checked })}
                  />
                  <span><strong>Показывать сверху</strong><small>Быстрый доступ рядом с Главной и GTD</small></span>
                </label>
                <div className="life-navigation-order">
                  <span>Положение среди сфер</span>
                  <div>
                    <button type="button" className="secondary-button" disabled={selected.archived || selectedActiveIndex <= 0} onClick={() => moveLifeArea(selected.id, "up")}><ArrowUp size={16} /> Левее</button>
                    <button type="button" className="secondary-button" disabled={selected.archived || selectedActiveIndex < 0 || selectedActiveIndex >= activeAreas.length - 1} onClick={() => moveLifeArea(selected.id, "down")}>Правее <ArrowDown size={16} /></button>
                  </div>
                </div>
              </section>
              <button className="primary-button" type="submit"><Check size={16} /> Сохранить</button>
              {message ? <p className="life-form-message" role="status">{message}</p> : null}
            </form>

            <section className="life-project-assignment">
              <div><strong>Проекты этой сферы</strong><small>Проект может относиться только к одной сфере. Переключение переносит его сюда, но не меняет задачи и план.</small></div>
              {state.projects.length ? <div>{state.projects.map((project) => {
                const checked = project.areaId === selected.id;
                return <label key={project.id}><input type="checkbox" checked={checked} onChange={(event) => assignProjectToLifeArea(project.id, event.target.checked ? selected.id : null)} /><i style={{ background: project.color }} /><span><strong>{project.title}</strong><small>{checked ? "В этой сфере" : projectLifeAreaTitle(project, state.lifeAreas)}</small></span></label>;
              })}</div> : <button className="secondary-button" onClick={onOpenProjects}><Plus size={16} /> Создать проект</button>}
            </section>

            <footer className="life-area-editor-footer">
              <button className="secondary-button" onClick={() => updateLifeArea(selected.id, { archived: !selected.archived })}>{selected.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{selected.archived ? "Вернуть из архива" : "Перенести в архив"}</button>
              {!confirmDelete ? <button className="text-button danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Удалить сферу</button> : <div className="life-delete-confirm"><span>Проекты останутся, но станут «без сферы».</span><button className="danger-button" onClick={deleteSelected}>Удалить</button><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Отмена</button></div>}
            </footer>
          </div>
        </section>
      ) : null}
    </div>
  );
}
