import { ArrowUpRight, Check, FileText, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { legacyObjectReference } from "../domain/objects/legacyAdapter";
import { useDashboard } from "../state/DashboardContext";
import type { DashboardWidget } from "../types";

interface DocumentWidgetProps {
  widget: DashboardWidget;
  onOpenWorkspace: (documentId?: string) => void;
}

export function documentTitleFromBody(body: string): string {
  const firstLine = body
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[#>*\-\d.\s[\]]+/u, "").trim().replace(/\s+/gu, " "))
    .find(Boolean);
  if (!firstLine) return "Без названия";
  return firstLine.length > 72 ? `${firstLine.slice(0, 71).trimEnd()}…` : firstLine;
}

export function documentBodyAfterTitle(body: string): string {
  const lines = body.split(/\r?\n/u);
  const firstMeaningfulIndex = lines.findIndex((line) => Boolean(line.trim()));
  if (firstMeaningfulIndex < 0) return "";
  return lines
    .slice(firstMeaningfulIndex + 1)
    .join("\n")
    .replace(/^\s*\n/u, "")
    .trimEnd();
}

/**
 * A neutral capture surface. It creates one ordinary document on the first
 * character and never creates a separate “reflection entry”.
 */
export function DocumentWidget({ widget, onOpenWorkspace }: DocumentWidgetProps) {
  const { state, saving, addNote, updateNote } = useDashboard();
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generatedTitleRef = useRef("Без названия");
  const document = documentId
    ? state.notes.find((note) => note.id === documentId) ?? null
    : null;

  useEffect(() => {
    if (documentId && !document) {
      setDocumentId(null);
      setDraft("");
      generatedTitleRef.current = "Без названия";
    }
  }, [document, documentId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(150, textarea.scrollHeight)}px`;
  }, [draft]);

  const write = (value: string) => {
    setDraft(value);
    const generatedTitle = documentTitleFromBody(value);
    const generatedBody = documentBodyAfterTitle(value);
    if (!document) {
      const created = addNote({ title: generatedTitle, body: generatedBody });
      generatedTitleRef.current = generatedTitle;
      setDocumentId(created.id);
      return;
    }
    const titleIsAutomatic =
      document.title === generatedTitleRef.current ||
      document.title === "Без названия" ||
      !document.title.trim();
    updateNote(document.id, {
      body: titleIsAutomatic ? generatedBody : value,
      ...(titleIsAutomatic ? { title: generatedTitle } : {})
    });
    if (titleIsAutomatic) generatedTitleRef.current = generatedTitle;
  };

  const beginNew = () => {
    setDocumentId(null);
    setDraft("");
    generatedTitleRef.current = "Без названия";
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const open = () => {
    onOpenWorkspace(document
      ? legacyObjectReference("note", document.id)
      : undefined);
  };

  return (
    <section className="panel dashboard-widget document-widget">
      <header className="document-widget-header">
        <div>
          <span className="document-widget-mark"><FileText size={17} /></span>
          <span>
            <strong>{widget.title || "Текст"}</strong>
            <small>{document ? (saving ? "Сохраняю…" : "Сохранено локально") : "Новый документ"}</small>
          </span>
        </div>
        <div className="document-widget-actions">
          {document ? (
            <button type="button" onClick={beginNew} title="Начать новый документ">
              <Plus size={16} /><span>Новый</span>
            </button>
          ) : null}
          <button type="button" onClick={open} title="Открыть рабочее пространство">
            <ArrowUpRight size={16} /><span>Все документы</span>
          </button>
        </div>
      </header>

      <div className="document-widget-canvas" onClick={() => textareaRef.current?.focus()}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => write(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              open();
            }
          }}
          aria-label="Текст нового документа"
          placeholder="Начните писать…"
          spellCheck
        />
      </div>

      <footer className="document-widget-footer">
        <span><Check size={14} /> Один обычный документ · без отдельной записи</span>
        <small>Ctrl + Enter — открыть</small>
      </footer>
    </section>
  );
}
