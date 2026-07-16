import {
  Activity,
  Braces,
  FileText,
  Image as ImageIcon,
  Link2,
  NotebookPen,
  Save,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { columnsForSize } from "../lib/widgetLayout";
import type { CustomWidgetVariant, DashboardWidget, DashboardWidgetSize } from "../types";
import { CustomDashboardWidget } from "./CustomDashboardWidget";

interface WidgetEditorProps {
  open: boolean;
  widget: DashboardWidget | null;
  order: number;
  onClose: () => void;
  onSave: (widget: DashboardWidget) => void;
  onDelete?: (id: string) => void;
}

const variants: Array<{ id: CustomWidgetVariant; title: string; description: string; icon: typeof NotebookPen }> = [
  { id: "note", title: "Текст", description: "Мысль, памятка, цитата", icon: NotebookPen },
  { id: "link", title: "Ссылка", description: "Материал или сервис", icon: Link2 },
  { id: "image", title: "Изображение", description: "Обложка или референс", icon: ImageIcon },
  { id: "metric", title: "Показатель", description: "Число и единица", icon: Activity },
  { id: "file", title: "Файл", description: "Быстрый доступ", icon: FileText },
  { id: "api", title: "API", description: "Публичные JSON-данные", icon: Braces }
];

function createWidget(order: number): DashboardWidget {
  return {
    id: `custom-${crypto.randomUUID()}`,
    type: "custom",
    title: "Новая карточка",
    enabled: true,
    size: "half",
    gridWidth: 6,
    gridHeight: 5,
    order,
    config: { variant: "note", description: "Начните с короткой и ясной формулировки." }
  };
}

export function WidgetEditor({ open, widget, order, onClose, onSave, onDelete }: WidgetEditorProps) {
  const [draft, setDraft] = useState<DashboardWidget>(() => widget ? structuredClone(widget) : createWidget(order));

  useEffect(() => {
    if (!open) return;
    setDraft(widget ? structuredClone(widget) : createWidget(order));
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, onClose, order, widget]);

  if (!open) return null;

  const updateConfig = (changes: Partial<DashboardWidget["config"]>) => {
    setDraft((current) => ({ ...current, config: { ...current.config, ...changes } }));
  };

  const changeSize = (size: DashboardWidgetSize) => {
    setDraft((current) => ({ ...current, size, gridWidth: columnsForSize(size) }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim() });
    onClose();
  };

  const variant = draft.config.variant ?? (draft.config.linkUrl ? "link" : "note");
  const isCustom = draft.type === "custom";

  return (
    <div className="widget-editor-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="widget-editor" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="widget-editor-title">
        <header className="widget-editor-header">
          <div><span className="eyebrow">Конструктор карточки</span><h2 id="widget-editor-title">{widget ? "Редактировать виджет" : "Новый виджет"}</h2><p>Изменения видны в предпросмотре до сохранения.</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={21} /></button>
        </header>

        <div className="widget-editor-layout">
          <div className="widget-editor-fields">
            {isCustom ? (
              <fieldset className="widget-type-picker">
                <legend>Тип карточки</legend>
                <div>{variants.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={variant === item.id ? "active" : ""} onClick={() => updateConfig({ variant: item.id })}><Icon size={18} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>; })}</div>
              </fieldset>
            ) : <div className="widget-standard-note"><strong>Системный виджет</strong><span>Его данные и поведение связаны с соответствующим разделом. Можно изменить название и размер.</span></div>}

            <label className="widget-editor-title-field"><span>Название</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} autoFocus /></label>
            <label><span>Размер</span><select value={draft.size} onChange={(event) => changeSize(event.target.value as DashboardWidgetSize)}><option value="full">На всю ширину</option><option value="two-thirds">Две трети</option><option value="half">Половина</option>{draft.type !== "reflection" ? <option value="third">Треть</option> : null}</select></label>

            {isCustom ? (
              <>
                <label><span>Описание</span><textarea rows={4} value={draft.config.description ?? draft.config.body ?? ""} onChange={(event) => updateConfig({ description: event.target.value, body: event.target.value })} placeholder="Что важно видеть в этой карточке" /></label>
                {variant === "link" ? <><label><span>Адрес ссылки</span><input value={draft.config.linkUrl ?? ""} onChange={(event) => updateConfig({ linkUrl: event.target.value })} placeholder="https://…" /></label><label><span>Текст кнопки</span><input value={draft.config.linkLabel ?? ""} onChange={(event) => updateConfig({ linkLabel: event.target.value })} placeholder="Открыть" /></label></> : null}
                {variant === "image" ? <><label><span>Адрес изображения</span><input value={draft.config.imageUrl ?? ""} onChange={(event) => updateConfig({ imageUrl: event.target.value })} placeholder="https://…/image.jpg" /></label><label><span>Описание изображения</span><input value={draft.config.imageAlt ?? ""} onChange={(event) => updateConfig({ imageAlt: event.target.value })} placeholder="Что изображено" /></label></> : null}
                {variant === "metric" ? <div className="widget-editor-split"><label><span>Значение</span><input value={draft.config.metricValue ?? ""} onChange={(event) => updateConfig({ metricValue: event.target.value })} placeholder="72" /></label><label><span>Единица</span><input value={draft.config.metricUnit ?? ""} onChange={(event) => updateConfig({ metricUnit: event.target.value })} placeholder="%" /></label></div> : null}
                {variant === "file" ? <><label><span>Ссылка или путь к файлу</span><input value={draft.config.fileUrl ?? ""} onChange={(event) => updateConfig({ fileUrl: event.target.value })} placeholder="https://… или file:///…" /></label><label><span>Подпись файла</span><input value={draft.config.fileName ?? ""} onChange={(event) => updateConfig({ fileName: event.target.value })} placeholder="Открыть документ" /></label></> : null}
                {variant === "api" ? <><label><span>Публичный HTTPS API</span><input value={draft.config.apiUrl ?? ""} onChange={(event) => updateConfig({ apiUrl: event.target.value })} placeholder="https://api.example.com/data" /></label><label><span>Поле в JSON</span><input value={draft.config.apiPath ?? ""} onChange={(event) => updateConfig({ apiPath: event.target.value })} placeholder="current.temperature" /></label><p className="widget-api-note">Поддерживается GET без паролей и токенов. Секретные ключи в виджетах хранить нельзя.</p></> : null}
              </>
            ) : null}
          </div>

          <aside className="widget-editor-preview">
            <span>Живой предпросмотр</span>
            {isCustom ? <CustomDashboardWidget widget={draft} preview /> : <div className="panel widget-standard-preview"><span className="eyebrow">Системный блок</span><h2>{draft.title}</h2><p>Содержимое появится из данных дашборда.</p></div>}
          </aside>
        </div>

        <footer className="widget-editor-footer">
          {widget && widget.type === "custom" && onDelete ? <button type="button" className="widget-delete-button" onClick={() => { if (window.confirm("Удалить этот виджет?")) { onDelete(widget.id); onClose(); } }}><Trash2 size={16} /> Удалить</button> : <span />}
          <div><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={!draft.title.trim()}><Save size={16} /> Сохранить виджет</button></div>
        </footer>
      </form>
    </div>
  );
}
