import {
  Activity,
  FileText,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  NotebookPen,
  RefreshCw
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CustomWidgetVariant, DashboardWidget } from "../types";

const variantMeta: Record<CustomWidgetVariant, { label: string; icon: typeof NotebookPen }> = {
  note: { label: "Текст", icon: NotebookPen },
  link: { label: "Ссылка", icon: Link2 },
  image: { label: "Изображение", icon: ImageIcon },
  metric: { label: "Показатель", icon: Activity },
  file: { label: "Файл", icon: FileText },
  api: { label: "API", icon: RefreshCw }
};

function safeUrl(value: string | undefined, protocols: string[] = ["http:", "https:", "file:"]) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim(), window.location.href);
    return protocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function readJsonPath(value: unknown, path: string) {
  if (!path.trim()) return value;
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function ApiValue({ widget }: { widget: DashboardWidget }) {
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const endpoint = safeUrl(widget.config.apiUrl, ["http:", "https:"]);

  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(endpoint, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((data) => setValue(readJsonPath(data, widget.config.apiPath ?? "")))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [endpoint, revision, widget.config.apiPath]);

  const display = useMemo(() => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }, [value]);

  if (!endpoint) return <div className="custom-widget-empty">Укажите публичный HTTPS-адрес в редакторе.</div>;
  return (
    <div className="custom-api-value">
      <div><strong>{loading ? "Загружаю…" : error ? "Нет данных" : display}</strong><button type="button" onClick={() => setRevision((value) => value + 1)} aria-label="Обновить данные">{loading ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCw size={16} />}</button></div>
      {error ? <small>{error}. Проверьте адрес и разрешение CORS.</small> : <small>{widget.config.apiPath ? `Поле: ${widget.config.apiPath}` : "Показан ответ API"}</small>}
    </div>
  );
}

export function CustomDashboardWidget({ widget, preview = false }: { widget: DashboardWidget; preview?: boolean }) {
  const variant = widget.config.variant ?? (widget.config.linkUrl ? "link" : "note");
  const meta = variantMeta[variant];
  const Icon = meta.icon;
  const link = safeUrl(widget.config.linkUrl);
  const image = safeUrl(widget.config.imageUrl, ["http:", "https:", "data:", "blob:"]);
  const file = safeUrl(widget.config.fileUrl);
  const description = widget.config.description || widget.config.body || "Добавьте описание в редакторе виджета.";

  return (
    <section className={`panel dashboard-widget custom-dashboard-widget custom-variant-${variant} ${preview ? "is-preview" : ""}`}>
      <header className="custom-widget-heading">
        <span className="custom-widget-mark"><Icon size={18} /></span>
        <span className="eyebrow">{meta.label}</span>
      </header>
      {variant === "image" && image ? <div className="custom-widget-image"><img src={image} alt={widget.config.imageAlt || widget.title} /></div> : null}
      <h2>{widget.title || "Без названия"}</h2>
      {variant === "metric" ? (
        <div className="custom-widget-metric"><strong>{widget.config.metricValue || "0"}</strong><span>{widget.config.metricUnit}</span><p>{description}</p></div>
      ) : variant === "api" ? (
        <><p>{description}</p><ApiValue widget={widget} /></>
      ) : (
        <p>{description}</p>
      )}
      {variant === "link" && link ? <a className="secondary-button" href={link} target="_blank" rel="noreferrer"><Link2 size={15} /> {widget.config.linkLabel || "Открыть"}</a> : null}
      {variant === "file" && file ? <a className="secondary-button" href={file} target="_blank" rel="noreferrer"><FileText size={15} /> {widget.config.fileName || "Открыть файл"}</a> : null}
      {variant === "image" && !image ? <div className="custom-widget-empty"><ImageIcon size={20} /> Добавьте адрес изображения.</div> : null}
    </section>
  );
}
