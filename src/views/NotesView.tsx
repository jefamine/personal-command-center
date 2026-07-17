import {
  FilePlus2,
  FileText,
  Pin,
  PinOff,
  Search,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useDashboard } from "../state/DashboardContext";

interface NotesViewProps {
  initialNoteId?: string | null;
}

export function NotesView({ initialNoteId = null }: NotesViewProps) {
  const { state, addNote, updateNote, removeNote } = useDashboard();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialNoteId && state.notes.some((note) => note.id === initialNoteId)
      ? initialNoteId
      : state.notes[0]?.id ?? null
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "read">("edit");

  const notes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return [...state.notes]
      .filter((note) =>
        !normalized || `${note.title} ${note.body} ${note.tags.join(" ")}`.toLocaleLowerCase("ru").includes(normalized)
      )
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [query, state.notes]);
  const selected = state.notes.find((note) => note.id === selectedId) ?? null;

  const create = (template?: "meeting" | "research" | "project") => {
    const templates = {
      meeting: { title: "Новая встреча", body: "## Цель\n\n\n## Решения\n\n\n## Следующие действия\n\n" },
      research: { title: "Новое исследование", body: "## Вопрос\n\n\n## Краткий вывод\n\n\n## Источники\n\n" },
      project: { title: "Заметка проекта", body: "## Желаемый результат\n\n\n## Текущее состояние\n\n\n## Решения\n\n" }
    };
    const preset = template ? templates[template] : { title: "Новая заметка", body: "" };
    const note = addNote(preset);
    setSelectedId(note.id);
    setMode("edit");
  };

  const remove = () => {
    if (!selected || !window.confirm("Переместить этот документ в корзину? Его можно будет восстановить в настройках.")) return;
    removeNote(selected.id);
    const remaining = state.notes.find((note) => note.id !== selected.id);
    setSelectedId(remaining?.id ?? null);
  };

  return (
    <div className="page notes-page">
      <section className="page-heading notes-heading">
        <div><span className="eyebrow">Знания рядом с действиями</span><h1>Заметки</h1><p>Обычный Markdown, проекты и шаблоны. Записи из «Записать и осмыслить» появляются здесь автоматически и входят в экспорт Obsidian.</p></div>
        <button className="primary-button" onClick={() => create()}><FilePlus2 size={18} /> Новая заметка</button>
      </section>

      <div className="notes-workspace">
        <aside className="panel notes-sidebar">
          <label className="notes-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по заметкам" /></label>
          <div className="note-list">
            {notes.map((note) => {
              const project = state.projects.find((entry) => entry.id === note.projectId);
              return (
                <button key={note.id} className={`note-list-item ${selected?.id === note.id ? "active" : ""}`} onClick={() => setSelectedId(note.id)}>
                  <div><FileText size={16} />{note.pinned ? <Pin size={12} className="pin-mark" /> : null}</div>
                  <span><strong>{note.title}</strong><small>{note.origin === "reflection" ? "Дневник · готово для Obsidian" : project?.title ?? note.tags[0] ?? "Без проекта"}</small></span>
                </button>
              );
            })}
          </div>
          {notes.length ? <small className="notes-count">{notes.length} заметок</small> : null}
        </aside>

        <section className="panel note-editor-panel">
          {selected ? (
            <>
              <div className="note-editor-toolbar">
                <div className="editor-mode-tabs"><button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Редактор</button><button className={mode === "read" ? "active" : ""} onClick={() => setMode("read")}>Чтение</button></div>
                <div><button className="icon-button" onClick={() => updateNote(selected.id, { pinned: !selected.pinned })} title={selected.pinned ? "Открепить" : "Закрепить"}>{selected.pinned ? <PinOff size={17} /> : <Pin size={17} />}</button><button className="icon-button danger-button" onClick={remove} title="Удалить"><Trash2 size={17} /></button></div>
              </div>
              {mode === "edit" ? (
                <div className="note-editor-fields">
                  <input className="note-title-input" value={selected.title} onChange={(event) => updateNote(selected.id, { title: event.target.value })} placeholder="Название заметки" />
                  <div className="note-properties">
                    <label><span>Проект</span><select value={selected.projectId ?? ""} onChange={(event) => updateNote(selected.id, { projectId: event.target.value || null })}><option value="">Без проекта</option>{state.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
                    <label><span>Теги</span><input value={selected.tags.join(", ")} onChange={(event) => updateNote(selected.id, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} placeholder="идея, встреча" /></label>
                  </div>
                  <textarea className="markdown-editor" value={selected.body} onChange={(event) => updateNote(selected.id, { body: event.target.value })} placeholder="Пишите в Markdown…" />
                </div>
              ) : (
                <article className="markdown-preview"><span className="eyebrow">Предпросмотр</span><h2>{selected.title || "Без названия"}</h2><div>{selected.body || "Заметка пока пустая."}</div></article>
              )}
              <div className="note-save-line"><span>Сохраняется локально автоматически</span><time>Изменено {new Date(selected.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div>
            </>
          ) : (
            <div className="note-empty-workspace">
              <EmptyState icon={FileText} title="Создайте первую заметку" text="Начните с чистого листа или выберите удобный шаблон." />
              <div className="note-template-buttons"><button onClick={() => create("meeting")}>Встреча</button><button onClick={() => create("research")}>Исследование</button><button onClick={() => create("project")}>Проект</button></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
