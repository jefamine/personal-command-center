import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  CircleAlert,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Clock3,
  ExternalLink,
  Inbox,
  LayoutGrid,
  Plus,
  Settings2,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Wind
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { DashboardCanvas } from "../components/DashboardCanvas";
import { DashboardCustomizer } from "../components/DashboardCustomizer";
import { CustomDashboardWidget } from "../components/CustomDashboardWidget";
import { DocumentWidget } from "../components/DocumentWidget";
import { EmptyState } from "../components/EmptyState";
import { TaskRow } from "../components/TaskRow";
import { WidgetEditor } from "../components/WidgetEditor";
import { formatTime, greetingForTime, localDateKey, todayLong } from "../lib/date";
import { buildDailyPlan, planLoadMinutes } from "../lib/planner";
import { loadWeather, weatherLabel, type WeatherSnapshot } from "../lib/weather";
import { sizeForColumns } from "../lib/widgetLayout";
import { useDashboard } from "../state/DashboardContext";
import { safeExternalUrl } from "../lib/url";
import type { DashboardWidget, ViewId } from "../types";

interface TodayViewProps {
  onOpenInbox: () => void;
  onOpenTasks: () => void;
  onEditTask: (taskId: string) => void;
  onNavigate: (view: ViewId) => void;
  onOpenWorkspace: (documentId?: string) => void;
}

function WeatherGlyph({ code, size = 28 }: { code: number; size?: number }) {
  if (code === 0) return <Sun size={size} />;
  if (code >= 95) return <CloudLightning size={size} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain size={size} />;
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return <CloudSnow size={size} />;
  return <Cloud size={size} />;
}

function WeatherWidget({ widget }: { widget: DashboardWidget }) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [error, setError] = useState("");
  const latitude = widget.config.latitude ?? 55.7558;
  const longitude = widget.config.longitude ?? 37.6176;

  useEffect(() => {
    let active = true;
    loadWeather(latitude, longitude)
      .then((snapshot) => { if (active) setWeather(snapshot); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Нет прогноза"); });
    return () => { active = false; };
  }, [latitude, longitude]);

  return (
    <section className="panel dashboard-widget weather-widget">
      <div className="widget-heading"><div><span className="eyebrow">Сегодня снаружи</span><h2>{widget.title}</h2></div><span className="widget-location">{widget.config.city ?? "Москва"}</span></div>
      {weather ? (
        <>
          <div className="weather-now"><div className="weather-glyph"><WeatherGlyph code={weather.code} size={34} /></div><div><strong>{Math.round(weather.temperature)}°</strong><span>{weatherLabel(weather.code)}</span></div><small>ощущается как {Math.round(weather.apparentTemperature)}°<br /><Wind size={12} /> {Math.round(weather.windSpeed)} км/ч</small></div>
          <div className="weather-days">{weather.days.map((day, index) => <div key={day.date}><span>{index === 0 ? "Сегодня" : new Intl.DateTimeFormat("ru", { weekday: "short" }).format(new Date(`${day.date}T12:00`))}</span><WeatherGlyph code={day.code} size={17} /><strong>{Math.round(day.max)}° <small>{Math.round(day.min)}°</small></strong><i>{day.rainChance}%</i></div>)}</div>
        </>
      ) : error ? <div className="widget-inline-empty"><CloudRain size={24} /><span>{error}</span><small>Последний прогноз появится снова при подключении к интернету.</small></div> : <div className="weather-loading"><i /><i /><i /></div>}
    </section>
  );
}

function ReadingWidget({ widget }: { widget: DashboardWidget }) {
  const { state, addReadingItem, removeReadingItem } = useDashboard();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const add = () => {
    if (!title.trim()) return;
    addReadingItem({ title, url, source: "Добавлено вами" });
    setTitle("");
    setUrl("");
    setAdding(false);
  };

  return (
    <section className="panel dashboard-widget reading-widget">
      <div className="widget-heading"><div><span className="eyebrow">Ссылки, статьи и тексты</span><h2>{widget.title}</h2></div><button className="small-button" onClick={() => setAdding(!adding)}><Plus size={14} /> Добавить</button></div>
      {adding ? <div className="reading-add-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /><button className="primary-button" onClick={add} disabled={!title.trim()}>Сохранить</button></div> : null}
      {state.readingItems.length ? <div className="reading-list">{state.readingItems.slice(0, 6).map((item) => {
        const externalUrl = safeExternalUrl(item.url);
        return <article key={item.id}><div className="reading-mark"><BookOpen size={17} /></div><div><span>{item.source}</span><strong>{item.title}</strong>{item.summary ? <p>{item.summary}</p> : null}{item.body ? <details><summary>Читать здесь</summary><div>{item.body}</div></details> : null}</div>{externalUrl ? <a href={externalUrl} target="_blank" rel="noreferrer" aria-label={`Открыть ${item.title}`}><ExternalLink size={16} /></a> : null}<button className="icon-button subtle" onClick={() => removeReadingItem(item.id)} aria-label={`Удалить ${item.title}`}><Trash2 size={14} /></button></article>;
      })}</div> : <div className="widget-inline-empty"><BookOpen size={24} /><span>Здесь появятся ваши материалы</span><small>Добавляйте ссылки сами или передавайте статьи через локальный мост Codex.</small></div>}
    </section>
  );
}

export function TodayView({ onOpenInbox, onOpenTasks, onEditTask, onNavigate, onOpenWorkspace }: TodayViewProps) {
  const { state, toggleTask, confirmPlan, updateWidgets } = useDashboard();
  const [customizing, setCustomizing] = useState(false);
  const [gridEditing, setGridEditing] = useState(false);
  const [widgetEditorOpen, setWidgetEditorOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const plan = useMemo(() => buildDailyPlan(state.tasks, state.settings, undefined, state.events), [state.tasks, state.settings, state.events]);
  const inbox = state.tasks.filter((task) => task.status === "inbox");
  const doneToday = state.tasks.filter((task) => task.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const overdue = state.tasks.filter((task) => task.status !== "done" && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10));
  const focus = plan[0];
  const load = planLoadMinutes(plan);
  const loadPercent = Math.min(100, Math.round((load / state.settings.dailyCapacityMinutes) * 100));
  const suggestions = plan.filter((item) => !item.confirmed);
  const widgets = [...state.widgets].filter((widget) => widget.enabled).sort((a, b) => a.order - b.order);

  const moveWidget = (sourceId: string, targetId: string) => {
    const ordered = [...state.widgets].sort((a, b) => a.order - b.order);
    const source = ordered.findIndex((widget) => widget.id === sourceId);
    const target = ordered.findIndex((widget) => widget.id === targetId);
    if (source < 0 || target < 0 || source === target) return;
    const [moved] = ordered.splice(source, 1);
    ordered.splice(target, 0, moved);
    updateWidgets(ordered);
  };

  const resizeWidget = (id: string, width: number, height: number) => {
    updateWidgets([...state.widgets].sort((a, b) => a.order - b.order).map((widget) => widget.id === id ? { ...widget, gridWidth: width, gridHeight: height, size: sizeForColumns(width) } : widget));
  };

  const hideWidget = (id: string) => {
    updateWidgets([...state.widgets].sort((a, b) => a.order - b.order).map((widget) => widget.id === id ? { ...widget, enabled: false } : widget));
  };

  const addQuickCard = () => {
    setEditingWidgetId(null);
    setWidgetEditorOpen(true);
  };

  const openWidgetEditor = (id: string) => {
    setEditingWidgetId(id);
    setWidgetEditorOpen(true);
  };

  const saveWidget = (saved: DashboardWidget) => {
    const ordered = [...state.widgets].sort((a, b) => a.order - b.order);
    const exists = ordered.some((widget) => widget.id === saved.id);
    updateWidgets(exists
      ? ordered.map((widget) => widget.id === saved.id ? { ...saved, id: widget.id, order: widget.order } : widget)
      : [...ordered, { ...saved, order: ordered.length }]
    );
  };

  const deleteWidget = (id: string) => updateWidgets(
    [...state.widgets].sort((a, b) => a.order - b.order).filter((widget) => widget.id !== id)
  );

  const recommendations = useMemo(() => {
    const result: Array<{ title: string; text: string; action: string; run: () => void; icon: ComponentType<{ size?: number }> }> = [];
    if (overdue.length) result.push({ title: "Сначала снимите риск", text: `${overdue.length} просроченных задач конкурируют за внимание. Выберите одну или осознанно перенесите срок.`, action: "Открыть риски", run: onOpenTasks, icon: CircleAlert });
    if (inbox.length) result.push({ title: "Освободите оперативную память", text: `Во входящих ${inbox.length}. Быстрый разбор вернёт ясность и улучшит следующий план.`, action: "Разобрать", run: onOpenInbox, icon: Inbox });
    if (loadPercent > 90) result.push({ title: "День перегружен", text: `Запланировано ${loadPercent}% доступной ёмкости. Оставьте хотя бы один резервный блок.`, action: "Открыть календарь", run: () => onNavigate("calendar"), icon: Clock3 });
    if (state.settings.currentEnergy === "low" && plan.some((item) => item.task.energy === "high")) result.push({ title: "Сверьте план с энергией", text: "Сейчас выбрана низкая энергия, но в плане есть требовательные задачи. Начните с короткого разгона.", action: "Посмотреть задачи", run: onOpenTasks, icon: Brain });
    if (!result.length) result.push({ title: "Система выглядит устойчиво", text: "Срочных рисков и перегрузки не видно. Защитите главный фокус от новых обязательств.", action: "Открыть план", run: () => onNavigate("calendar"), icon: CheckCircle2 });
    return result.slice(0, 3);
  }, [inbox.length, loadPercent, onNavigate, onOpenInbox, onOpenTasks, overdue.length, plan, state.settings.currentEnergy]);

  const renderWidget = (widget: DashboardWidget) => {
    if (widget.type === "overview") return (
      <section className="stat-grid clickable-stats">
        <button className="stat-card accent-stat" onClick={onOpenTasks}><Target size={21} /><div><span>В плане</span><strong>{plan.length}</strong></div><small>{Math.round(load / 60 * 10) / 10} ч фокуса</small></button>
        <button className="stat-card" onClick={onOpenInbox}><Inbox size={21} /><div><span>Входящие</span><strong>{inbox.length}</strong></div><small>{inbox.length ? "нужно разобрать" : "всё разобрано"}</small></button>
        <button className="stat-card" onClick={onOpenTasks}><CircleAlert size={21} /><div><span>Риски</span><strong>{overdue.length}</strong></div><small>{overdue.length ? "просроченные задачи" : "сроки под контролем"}</small></button>
        <button className="stat-card" onClick={onOpenTasks}><CheckCircle2 size={21} /><div><span>Готово</span><strong>{doneToday.length}</strong></div><small>за сегодня</small></button>
      </section>
    );
    if (widget.type === "focus") return focus ? (
      <section className="focus-card"><div className="focus-copy"><span className="eyebrow"><Sparkles size={14} /> Лучший следующий шаг</span><h2>{focus.task.title}</h2><p>{focus.reasons.join(" · ")}</p><div className="focus-meta"><span><Clock3 size={16} /> {focus.task.estimateMinutes} минут</span><span>{formatTime(focus.startMinutes)}–{formatTime(focus.endMinutes)}</span></div></div><div className="focus-actions"><button className="secondary-button focus-open-button" onClick={() => onEditTask(focus.task.id)}>Открыть задачу</button><button className="primary-button" onClick={() => toggleTask(focus.task.id)}>Готово <CheckCircle2 size={18} /></button></div></section>
    ) : <section className="panel dashboard-widget"><EmptyState icon={CheckCircle2} title="Фокус свободен" text="Добавьте следующую задачу — планировщик предложит лучший шаг." /></section>;
    if (widget.type === "plan") return (
      <section className="panel plan-panel widget-plan"><div className="panel-heading"><div><span className="eyebrow">Предлагаемый порядок</span><h2>{widget.title}</h2></div><div className="panel-heading-actions">{suggestions.length ? <button className="small-button primary-small" onClick={() => confirmPlan(plan, localDateKey())}>Закрепить план</button> : null}<button className="text-button" onClick={onOpenTasks}>Все задачи <ArrowRight size={15} /></button></div></div>{plan.length ? <div className="timeline">{plan.map((item) => { const project = state.projects.find((entry) => entry.id === item.task.projectId); return <div className="timeline-item" key={item.task.id}><time>{formatTime(item.startMinutes)}</time><div className="timeline-line"><i /></div><div className="timeline-task"><TaskRow task={item.task} project={project} onToggle={() => toggleTask(item.task.id)} onEdit={() => onEditTask(item.task.id)} /><p className="reason-line">Почему сейчас: {item.reasons.join(", ")}.</p></div></div>; })}</div> : <EmptyState icon={CheckCircle2} title="План свободен" text="Разберите входящие или добавьте следующую задачу." />}</section>
    );
    if (widget.type === "inbox") return (
      <section className="panel inbox-preview widget-inbox"><div className="panel-heading"><div><span className="eyebrow">Сначала ясность</span><h2>{widget.title}</h2></div><button className="text-button" onClick={onOpenInbox}>Разобрать <ArrowRight size={15} /></button></div>{inbox.length ? <div className="compact-task-list">{inbox.slice(0, 5).map((task) => <TaskRow task={task} compact key={task.id} onToggle={() => toggleTask(task.id)} onEdit={() => onEditTask(task.id)} />)}</div> : <EmptyState icon={Inbox} title="Голова свободна" text="Новых входящих пока нет." />}<div className="capacity-note"><span>Резерв дня</span><strong>{Math.max(0, state.settings.dailyCapacityMinutes - load)} минут</strong><div className="progress-track"><i style={{ width: `${loadPercent}%` }} /></div><p>Планировщик оставляет время для пауз и срочных дел.</p></div></section>
    );
    if (widget.type === "weather") return <WeatherWidget widget={widget} />;
    if (widget.type === "reading") return <ReadingWidget widget={widget} />;
    if (widget.type === "document" || widget.type === "reflection") {
      return <DocumentWidget widget={widget} onOpenWorkspace={onOpenWorkspace} />;
    }
    if (widget.type === "recommendations") return (
      <section className="panel dashboard-widget recommendations-widget"><div className="widget-heading"><div><span className="eyebrow">Контекстная помощь</span><h2>{widget.title}</h2></div><Brain size={21} /></div><div className="recommendation-list">{recommendations.map((item) => { const Icon = item.icon; return <article key={item.title}><div><Icon size={18} /></div><span><strong>{item.title}</strong><p>{item.text}</p></span><button className="small-button" onClick={item.run}>{item.action} <ArrowRight size={13} /></button></article>; })}</div><small className="recommendation-note">Сейчас рекомендации рассчитываются локально. Журнал действий уже собирает основу для будущей персонализации.</small></section>
    );
    return <CustomDashboardWidget widget={widget} />;
  };

  return (
    <div className="page today-page modular-today-page">
      <section className="page-heading today-heading"><div><span className="eyebrow">{todayLong()}</span><h1>{greetingForTime()}{state.settings.userName ? `, ${state.settings.userName}` : ""}.</h1><p>Соберём день вокруг важного — задач, информации и вашего реального контекста.</p></div><div className="today-heading-actions"><button className={`secondary-button customize-dashboard-button ${gridEditing ? "is-active" : ""}`} onClick={() => setGridEditing((value) => !value)}><Settings2 size={17} /> {gridEditing ? "Готово" : "Настроить экран"}</button><div className="day-load"><div className="load-ring" style={{ "--load": `${loadPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{loadPercent}%</strong><span>нагрузка</span></div></div></div></div></section>
      {gridEditing ? <section className="dashboard-edit-toolbar"><div><LayoutGrid size={19} /><span><strong>Редактор сетки</strong><small>Перетащите карточку за верхнюю плашку. Потяните за правый нижний угол, чтобы изменить размер.</small></span></div><div><button className="primary-button" onClick={addQuickCard}><Plus size={16} /> Новая карточка</button><button className="secondary-button" onClick={() => setCustomizing(true)}><Settings2 size={16} /> Параметры виджетов</button></div></section> : null}
      {widgets.length ? <DashboardCanvas widgets={widgets} editing={gridEditing} renderWidget={renderWidget} onMove={moveWidget} onResize={resizeWidget} onHide={hideWidget} onEdit={openWidgetEditor} /> : <section className="panel empty-dashboard"><LayoutGrid size={29} /><h2>Главный экран пуст</h2><p>Верните готовые блоки или создайте собственную карточку.</p><button className="primary-button" onClick={() => setCustomizing(true)}>Настроить экран</button></section>}
      <DashboardCustomizer open={customizing} onClose={() => setCustomizing(false)} onEditWidget={openWidgetEditor} onCreateWidget={addQuickCard} />
      <WidgetEditor
        open={widgetEditorOpen}
        widget={editingWidgetId ? state.widgets.find((widget) => widget.id === editingWidgetId) ?? null : null}
        order={state.widgets.length}
        onClose={() => setWidgetEditorOpen(false)}
        onSave={saveWidget}
        onDelete={deleteWidget}
      />
    </div>
  );
}
