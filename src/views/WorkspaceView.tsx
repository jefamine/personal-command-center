import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Check,
  FilePlus2,
  FileText,
  Library,
  Link2,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../components/AppLink";
import {
  noteDocumentId,
  type DocumentRecord
} from "../domain/documents/documentContract";
import { createDocumentRepository } from "../domain/documents/documentRepository";
import { useAppNavigation } from "../navigation/NavigationContext";
import { useDashboard } from "../state/DashboardContext";

interface WorkspaceViewProps {
  documentId?: string;
}

type WorkspaceFilter = "all" | "pinned" | "reflection" | "materials";

interface WorkspaceDocument extends DocumentRecord {
  isReflection: boolean;
}

const filters: Array<{ id: WorkspaceFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "pinned", label: "Закреплённые" },
  { id: "reflection", label: "Осмысление" },
  { id: "materials", label: "Материалы" }
];

function documentPreview(body: string): string {
  return body.replace(/\s+/gu, " ").trim() || "Пустой документ";
}

function formatDocumentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без даты";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Сегодня, ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function WorkspaceView({ documentId }: WorkspaceViewProps) {
  const {
    state,
    saving,
    addNote,
    updateNote,
    removeNote,
    updateObject,
    removeObject
  } = useDashboard();
  const { navigate } = useAppNavigation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"library" | "editor">(
    documentId ? "editor" : "library"
  );
  const [tagsDraft, setTagsDraft] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const focusAfterCreateRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const documentRepository = useMemo(() => createDocumentRepository({
    getState: () => stateRef.current,
    updateNote,
    updateNativeObject: updateObject
  }), [updateNote, updateObject]);
  const reflectionDocumentIds = useMemo(() => new Set(
    state.notes
      .filter((note) => Boolean(note.reflection) || note.origin === "reflection")
      .map((note) => noteDocumentId(note.id))
  ), [state.notes]);

  const documents = useMemo<WorkspaceDocument[]>(() => documentRepository
    .listDocuments()
    .map((document) => ({
      ...document,
      isReflection: reflectionDocumentIds.has(document.id) ||
        document.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление")
    }))
    .sort((left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      right.updatedAt.localeCompare(left.updatedAt)
    ), [documentRepository, reflectionDocumentIds, state]);

  const selected = documents.find((document) => document.id === documentId) ?? null;

  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return documents.filter((document) => {
      if (filter === "pinned" && !document.pinned) return false;
      if (filter === "reflection" && !document.isReflection) return false;
      if (filter === "materials" && document.kind !== "material") return false;
      if (!normalized) return true;
      return `${document.title} ${document.content} ${document.tags.join(" ")}`
        .toLocaleLowerCase("ru")
        .includes(normalized);
    });
  }, [documents, filter, query]);

  useEffect(() => {
    if (documentId) setMobilePanel("editor");
  }, [documentId]);

  useEffect(() => {
    setTagsDraft(selected?.tags.join(", ") ?? "");
    setInspectorOpen(false);
  }, [selected?.id]);

  useEffect(() => {
    const title = titleRef.current;
    if (title) {
      title.style.height = "0px";
      title.style.height = `${Math.max(54, title.scrollHeight)}px`;
    }
    const textarea = bodyRef.current;
    if (!textarea || !selected) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(420, textarea.scrollHeight)}px`;
    if (focusAfterCreateRef.current === selected.id) {
      focusAfterCreateRef.current = null;
      requestAnimationFrame(() => textarea.focus());
    }
  }, [selected?.content, selected?.id, selected?.title]);

  const openDocument = (document: WorkspaceDocument) => {
    setMobilePanel("editor");
    navigate(
      { kind: "tool", tool: "workspace", documentId: document.id },
      { preserveTrail: true, label: document.title || "Документ" }
    );
  };

  const createDocument = () => {
    const note = addNote({ title: "Без названия", body: "" });
    const id = noteDocumentId(note.id);
    focusAfterCreateRef.current = id;
    setMobilePanel("editor");
    navigate(
      { kind: "tool", tool: "workspace", documentId: id },
      { preserveTrail: true, label: "Новый документ" }
    );
  };

  const closeDocument = () => {
    setMobilePanel("library");
    navigate({ kind: "tool", tool: "workspace" }, { preserveTrail: true });
  };

  const updateTitle = (title: string) => {
    if (!selected || !selected.capabilities.supportsSimpleTextEditing) return;
    documentRepository.updateDocument(selected.id, { title });
  };

  const updateBody = (body: string) => {
    if (!selected || !selected.capabilities.supportsSimpleTextEditing) return;
    documentRepository.updateDocument(selected.id, { content: body });
  };

  const commitTags = () => {
    if (!selected || !selected.capabilities.canEditMetadata) return;
    const tags = [...new Set(tagsDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean))];
    documentRepository.updateDocument(selected.id, { tags });
  };

  const togglePinned = () => {
    if (!selected || !selected.capabilities.canEditMetadata) return;
    documentRepository.updateDocument(selected.id, { pinned: !selected.pinned });
  };

  const removeSelected = () => {
    if (!selected || selected.kind === "material") return;
    if (!window.confirm("Переместить документ в корзину? Его можно будет восстановить в настройках.")) return;
    if (selected.source.kind === "note") removeNote(selected.source.entityId);
    else if (selected.source.kind === "native") removeObject(selected.source.entityId);
    closeDocument();
  };

  return (
    <div className="page workspace-page workspace-studio-page">
      <section className="workspace-studio-intro">
        <div>
          <span className="eyebrow"><Library size={13} /> Единая база</span>
          <h1>Рабочее пространство</h1>
          <p>Пишите коротко или подробно: заметка, статья и личный текст остаются одним обычным документом.</p>
        </div>
        <button type="button" className="primary-button" onClick={createDocument}>
          <FilePlus2 size={18} /> Новый документ
        </button>
      </section>

      <section className={`workspace-studio ${selected ? "has-document" : ""}`}>
        <aside className={`workspace-library ${mobilePanel === "editor" ? "is-mobile-hidden" : ""}`}>
          <header>
            <div><strong>Документы</strong><small>{documents.length} в рабочем пространстве</small></div>
            <button type="button" onClick={createDocument} aria-label="Новый документ" title="Новый документ">
              <PlusIcon />
            </button>
          </header>

          <label className="workspace-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти в текстах"
              aria-label="Поиск в документах"
            />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={14} /></button> : null}
          </label>

          <div className="workspace-filter-strip" aria-label="Фильтр документов">
            {filters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? "is-active" : ""}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="workspace-document-list">
            {visibleDocuments.map((document) => (
              <button
                type="button"
                key={document.id}
                className={selected?.id === document.id ? "is-active" : ""}
                onClick={() => openDocument(document)}
              >
                <span className={`workspace-list-icon is-${document.kind}`}>
                  {document.kind === "material" ? <Link2 size={16} /> : <FileText size={16} />}
                </span>
                <span>
                  <strong>{document.title || "Без названия"}</strong>
                  <small>{documentPreview(document.content)}</small>
                  <time>{formatDocumentDate(document.updatedAt)}</time>
                </span>
                {document.pinned ? <Pin size={12} className="workspace-list-pin" /> : null}
              </button>
            ))}
            {!visibleDocuments.length ? (
              <div className="workspace-list-empty">
                <FileText size={23} />
                <strong>{documents.length ? "Ничего не найдено" : "Пока нет документов"}</strong>
                <p>{documents.length ? "Измените запрос или фильтр." : "Создайте документ и просто начните писать."}</p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={`workspace-editor-shell ${mobilePanel === "library" ? "is-mobile-hidden" : ""}`}>
          {selected ? (
            <>
              <header className="workspace-editor-toolbar">
                <div>
                  <button type="button" className="workspace-mobile-back" onClick={closeDocument} aria-label="Назад к документам">
                    <ArrowLeft size={18} />
                  </button>
                  <span className="workspace-document-kind">
                    {selected.kind === "material" ? "Материал" : "Документ"}
                  </span>
                  <span className={`workspace-save-state ${saving ? "is-saving" : ""}`}>
                    {saving ? <span className="workspace-saving-dot" /> : <Check size={14} />}
                    {saving ? "Сохраняю" : "Сохранено"}
                  </span>
                </div>
                <div>
                  {selected.kind !== "material" ? (
                    <button type="button" onClick={togglePinned} aria-label={selected.pinned ? "Открепить" : "Закрепить"} title={selected.pinned ? "Открепить" : "Закрепить"}>
                      {selected.pinned ? <PinOff size={17} /> : <Pin size={17} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={inspectorOpen ? "is-active" : ""}
                    onClick={() => setInspectorOpen((value) => !value)}
                    aria-label="Свойства документа"
                    title="Свойства документа"
                  >
                    <SlidersHorizontal size={17} />
                  </button>
                  <AppLink
                    route={{ kind: "object", objectId: selected.id }}
                    navigation={{ preserveTrail: true, label: selected.title || "Документ" }}
                    aria-label="Открыть связи и структуру"
                    title="Связи и структура"
                  >
                    <ArrowUpRight size={17} />
                  </AppLink>
                  {selected.kind !== "material" ? (
                    <button type="button" className="is-danger" onClick={removeSelected} aria-label="В корзину" title="В корзину">
                      <Trash2 size={17} />
                    </button>
                  ) : null}
                </div>
              </header>

              <div className={`workspace-writing-scroll ${inspectorOpen ? "has-inspector" : ""}`}>
                <article className="workspace-writing-surface">
                  <textarea
                    ref={titleRef}
                    className="workspace-document-title"
                    value={selected.title}
                    onChange={(event) => updateTitle(event.target.value)}
                    placeholder="Без названия"
                    aria-label="Название документа"
                    readOnly={!selected.capabilities.supportsSimpleTextEditing}
                    rows={1}
                  />
                  <div className="workspace-document-meta">
                    <time>{formatDocumentDate(selected.updatedAt)}</time>
                    {selected.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
                    {selected.isReflection && !selected.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление")
                      ? <span className="is-reflection"><Sparkles size={12} /> осмысление</span>
                      : null}
                  </div>
                  <textarea
                    ref={bodyRef}
                    className="workspace-document-body"
                    value={selected.content}
                    onChange={(event) => updateBody(event.target.value)}
                    placeholder="Начните писать…"
                    aria-label="Текст документа"
                    readOnly={!selected.capabilities.supportsSimpleTextEditing}
                    rows={1}
                    spellCheck
                  />
                  {!selected.capabilities.supportsSimpleTextEditing ? (
                    <p className="workspace-readonly-note">
                      {selected.kind === "material"
                        ? "Материал открыт для чтения. Связи и исходные данные доступны через кнопку вверху."
                        : "Документ содержит несколько структурных блоков. Их редактирование появится в следующем срезе блочного редактора."}
                    </p>
                  ) : null}
                </article>
              </div>

              {inspectorOpen ? (
                <aside className="workspace-inspector">
                  <header><div><strong>Свойства</strong><small>Не мешают самому тексту</small></div><button type="button" onClick={() => setInspectorOpen(false)} aria-label="Закрыть свойства"><X size={17} /></button></header>
                  <div className="workspace-inspector-fields">
                    <label>
                      <span>Теги</span>
                      <input
                        value={tagsDraft}
                        onChange={(event) => setTagsDraft(event.target.value)}
                        onBlur={commitTags}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitTags();
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder="идея, семья, осмысление"
                        disabled={!selected.capabilities.canEditMetadata}
                      />
                      <small>Тег «осмысление» добавляет документ в соответствующую подборку.</small>
                    </label>
                    {selected.capabilities.canEditProject ? (
                      <label>
                        <span>Проект</span>
                        <select
                          value={selected.projectId ?? ""}
                          onChange={(event) => documentRepository.updateDocument(selected.id, {
                            projectId: event.target.value || null
                          })}
                        >
                          <option value="">Без проекта</option>
                          {state.projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <dl>
                      <div><dt>Создан</dt><dd>{formatDocumentDate(selected.createdAt)}</dd></div>
                      <div><dt>Изменён</dt><dd>{formatDocumentDate(selected.updatedAt)}</dd></div>
                      <div><dt>Источник</dt><dd>{selected.kind === "material" ? "Материалы" : "Рабочее пространство"}</dd></div>
                    </dl>
                  </div>
                </aside>
              ) : null}
            </>
          ) : (
            <button type="button" className="workspace-blank-state" onClick={createDocument}>
              <span><FilePlus2 size={25} /></span>
              <strong>Чистое полотно</strong>
              <p>Создайте документ — курсор сразу окажется в тексте. Никакой отдельной формы сохранения.</p>
              <small><FilePlus2 size={14} /> Новый документ</small>
            </button>
          )}
        </section>
      </section>

      <p className="workspace-stage-note">
        <BookOpenText size={15} /> «Осмысление» теперь только подборка документов. Следующий срез добавит мультимодальные блоки и встраивания прямо в это полотно.
      </p>
    </div>
  );
}

function PlusIcon() {
  return <FilePlus2 size={17} />;
}
