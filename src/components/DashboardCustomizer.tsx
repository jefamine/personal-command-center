import {
  ArrowDown,
  ArrowUp,
  Activity,
  BookOpen,
  Braces,
  Brain,
  CloudSun,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Link2,
  ListTodo,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { searchCity } from "../lib/weather";
import { columnsForSize, normalizeWidgetLayout } from "../lib/widgetLayout";
import { widgetRegistry, type StandardWidgetType } from "../domain/widgets/widgetRegistry";
import { useDashboard } from "../state/DashboardContext";
import type { DashboardWidget, DashboardWidgetSize } from "../types";

interface DashboardCustomizerProps {
  open: boolean;
  onClose: () => void;
  onEditWidget: (id: string) => void;
  onCreateWidget: () => void;
}

const widgetIcons: Record<StandardWidgetType, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  focus: Target,
  reflection: NotebookPen,
  recommendations: Brain,
  weather: CloudSun,
  plan: ListTodo,
  inbox: Inbox,
  reading: BookOpen
};

const catalog = widgetRegistry.map((definition) => ({
  ...definition,
  size: definition.defaultSize,
  icon: widgetIcons[definition.type]
}));

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return <button type="button" className={`integration-switch ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>;
}

const customTypes = [
  { label: "Текст", icon: NotebookPen },
  { label: "Ссылка", icon: Link2 },
  { label: "Изображение", icon: ImageIcon },
  { label: "Показатель", icon: Activity },
  { label: "Файл", icon: FileText },
  { label: "API", icon: Braces }
];

export function DashboardCustomizer({ open, onClose, onEditWidget, onCreateWidget }: DashboardCustomizerProps) {
  const { state, updateWidgets } = useDashboard();
  const widgets = useMemo(() => [...state.widgets].sort((a, b) => a.order - b.order), [state.widgets]);
  const [city, setCity] = useState(state.widgets.find((widget) => widget.type === "weather")?.config.city ?? "Москва");
  const [cityMessage, setCityMessage] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;

  const update = (id: string, changes: Partial<DashboardWidget>) => {
    updateWidgets(widgets.map((widget) => widget.id === id ? { ...widget, ...changes, id: widget.id } : widget));
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = widgets.findIndex((widget) => widget.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    updateWidgets(next);
  };

  const addFromCatalog = (type: StandardWidgetType) => {
    const item = catalog.find((entry) => entry.type === type);
    if (!item) return;
    const widget: DashboardWidget = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      title: item.title,
      enabled: true,
      size: item.size,
      gridWidth: item.defaultWidth,
      gridHeight: item.defaultHeight,
      order: widgets.length,
      config: { ...item.defaultConfig }
    };
    updateWidgets([...widgets, normalizeWidgetLayout(widget)]);
  };

  const findCity = async () => {
    if (!city.trim()) return;
    setSearching(true);
    setCityMessage("");
    try {
      const match = await searchCity(city);
      if (!match) {
        setCityMessage("Город не найден.");
        return;
      }
      const weather = widgets.find((widget) => widget.type === "weather");
      if (weather) update(weather.id, { config: { ...weather.config, city: match.name, latitude: match.latitude, longitude: match.longitude } });
      setCity(match.name);
      setCityMessage(`${match.name}${match.country ? `, ${match.country}` : ""}`);
    } catch (error) {
      setCityMessage(error instanceof Error ? error.message : "Не удалось найти город.");
    } finally {
      setSearching(false);
    }
  };

  const missing = catalog.filter((entry) => !widgets.some((widget) => widget.type === entry.type));

  return (
    <div className="widget-manager-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="widget-manager" role="dialog" aria-modal="true" aria-labelledby="widget-manager-title">
        <header className="widget-manager-header">
          <div><span className="eyebrow"><Sparkles size={12} /> Личное пространство</span><h2 id="widget-manager-title">Настроить главный экран</h2><p>Включайте блоки, меняйте ширину и порядок. Всё сохраняется автоматически.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={21} /></button>
        </header>

        <div className="widget-manager-body">
          <div className="widget-manager-list">
            {widgets.map((widget, index) => {
              const item = catalog.find((entry) => entry.type === widget.type);
              const Icon = item?.icon ?? Sparkles;
              return (
                <article className="widget-manager-row" key={widget.id}>
                  <GripVertical className="drag-hint" size={17} />
                  <div className="widget-manager-icon"><Icon size={18} /></div>
                  <div className="widget-manager-name"><input value={widget.title} onChange={(event) => update(widget.id, { title: event.target.value })} /><span>{item?.description ?? "Пользовательская карточка"}</span></div>
                  <select value={widget.size} aria-label={`Размер: ${widget.title}`} onChange={(event) => { const size = event.target.value as DashboardWidgetSize; update(widget.id, { size, gridWidth: columnsForSize(size) }); }}><option value="full">На всю ширину</option><option value="two-thirds">Две трети</option><option value="half">Половина</option>{widget.type !== "reflection" ? <option value="third">Треть</option> : null}</select>
                  <div className="widget-order-buttons"><button disabled={index === 0} onClick={() => move(widget.id, -1)} aria-label={`Поднять ${widget.title}`}><ArrowUp size={15} /></button><button disabled={index === widgets.length - 1} onClick={() => move(widget.id, 1)} aria-label={`Опустить ${widget.title}`}><ArrowDown size={15} /></button></div>
                  <Toggle checked={widget.enabled} label={`Показывать ${widget.title}`} onChange={() => update(widget.id, { enabled: !widget.enabled })} />
                  <button className="icon-button subtle" onClick={() => onEditWidget(widget.id)} aria-label={`Редактировать ${widget.title}`} title="Открыть редактор"><Pencil size={16} /></button>
                  {widget.type === "custom" ? <button className="icon-button subtle" onClick={() => updateWidgets(widgets.filter((entry) => entry.id !== widget.id))} aria-label={`Удалить ${widget.title}`}><Trash2 size={16} /></button> : <span className="manager-spacer" />}
                </article>
              );
            })}
          </div>

          {missing.length ? <section className="missing-widgets"><div><strong>Добавить стандартный блок</strong><span>Отключённые блоки остаются в списке; удалённые можно вернуть здесь.</span></div><div>{missing.map((item) => { const Icon = item.icon; return <button key={item.type} className="small-button" onClick={() => addFromCatalog(item.type)}><Icon size={14} /> {item.title}</button>; })}</div></section> : null}

          <section className="weather-location-editor">
            <div><CloudSun size={19} /><span><strong>Город для прогноза</strong><small>Погода загружается автономно и кэшируется на устройстве.</small></span></div>
            <div className="weather-city-search"><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Москва" onKeyDown={(event) => { if (event.key === "Enter") void findCity(); }} /><button className="secondary-button" onClick={() => void findCity()} disabled={searching}><Search size={15} /> Найти</button></div>
            {cityMessage ? <small className="city-message">{cityMessage}</small> : null}
          </section>

          <section className="custom-widget-gallery-cta">
            <div><Plus size={20} /><span><strong>Создать свой виджет</strong><small>Выберите тип, заполните поля и сразу увидите результат.</small></span></div>
            <div className="custom-widget-type-chips">{customTypes.map((item) => { const Icon = item.icon; return <span key={item.label}><Icon size={15} /> {item.label}</span>; })}</div>
            <button className="primary-button" onClick={onCreateWidget}><Plus size={15} /> Открыть конструктор</button>
          </section>
        </div>
      </section>
    </div>
  );
}
