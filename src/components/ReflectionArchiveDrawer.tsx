import {
  Brain,
  Check,
  ChevronDown,
  FileText,
  Link2Off,
  NotebookPen,
  Pause,
  PencilLine,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useDashboard } from "../state/DashboardContext";
import { reflectionDocuments } from "../domain/reflections/reflectionNote";
import type {
  AssistantMemoryItem,
  AssistantMemoryStatus,
  ReflectionDocument,
  ReflectionSuggestion,
  ReflectionStatus
} from "../types";

interface ReflectionArchiveDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenReflection: (id: string) => void;
  protectedEntryId?: string | null;
}

type ArchiveTab = "reflections" | "memory";
type ReflectionFilter = "all" | ReflectionStatus;
type MemoryFilter = "all" | AssistantMemoryStatus;

const REFLECTION_FILTERS: Array<{ value: ReflectionFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "captured", label: "Без разбора" },
  { value: "queued", label: "Ждут" },
  { value: "analyzed", label: "Проверить" },
  { value: "confirmed", label: "Подтверждены" },
  { value: "corrected", label: "С поправкой" },
  { value: "ignored", label: "Не учитывать" }
];

const MEMORY_FILTERS: Array<{ value: MemoryFilter; label: string }> = [
  { value: "all", label: "Вся память" },
  { value: "active", label: "Активна" },
  { value: "paused", label: "На паузе" }
];

const REFLECTION_STATUS_COPY: Record<ReflectionStatus, string> = {
  captured: "Без разбора",
  queued: "Ждёт разбора",
  analyzed: "Нужно проверить",
  confirmed: "Подтверждено",
  corrected: "Учтено с поправкой",
  ignored: "Не учитывается"
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Дата неизвестна" : dateFormatter.format(parsed);
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function reflectionSearchText(entry: ReflectionDocument) {
  return [
    entry.body,
    entry.reflection.correction,
    entry.reflection.analysis?.understanding,
    entry.reflection.analysis?.possibleExplanation,
    entry.reflection.analysis?.question,
    entry.reflection.analysis?.proposedAction,
    ...entry.reflection.suggestions.flatMap((suggestion) => [suggestion.sourceText, suggestion.text]),
    ...(entry.reflection.analysis?.observations ?? []),
    ...(entry.reflection.analysis?.alternatives ?? [])
  ].filter(Boolean).join(" ");
}

const ARCHIVE_SUGGESTION_LABELS: Record<ReflectionSuggestion["kind"], string> = {
  meaning: "Возможный смысл",
  question: "Вопрос для размышления",
  next_action: "Возможный следующий шаг"
};

const ARCHIVE_SUGGESTION_STATUS: Record<ReflectionSuggestion["status"], string> = {
  pending: "Не решено",
  accepted: "Принято",
  dismissed: "Отклонено"
};

function memorySource(
  item: AssistantMemoryItem,
  reflections: ReflectionDocument[]
): { label: string; reflection: ReflectionDocument | null; missing: boolean; stale: boolean } {
  if (item.sourceType === "manual") {
    return { label: "Добавлено вручную", reflection: null, missing: false, stale: false };
  }
  const reflection = item.sourceId
    ? reflections.find((entry) => entry.id === item.sourceId) ?? null
    : null;
  if (!reflection) {
    return { label: "Исходная запись удалена", reflection: null, missing: true, stale: false };
  }
  const stale = Boolean(item.sourceUpdatedAt && item.sourceUpdatedAt !== reflection.updatedAt);
  return {
    label: `Из записи · ${formatDate(reflection.createdAt)}${stale ? " · источник изменён" : ""}`,
    reflection,
    missing: false,
    stale
  };
}

function ArchivedUsedMemory({
  entry,
  memory
}: {
  entry: ReflectionDocument;
  memory: AssistantMemoryItem[];
}) {
  const references = entry.reflection.analysisMemoryRefs;
  if (!references.length) return null;
  const queued = entry.reflection.status === "queued";

  return (
    <details className="reflection-used-memory is-archive">
      <summary>
        <Brain size={16} />
        <span>{queued ? "В запрос включена память" : "В разбор передана память"} · {references.length}</span>
        <ChevronDown size={15} className="reflection-used-memory-chevron" />
      </summary>
      <ol>
        {references.map((reference) => {
          const item = memory.find((candidate) => candidate.id === reference.id) ?? null;
          if (!item) {
            return <li key={reference.id} className="is-unavailable"><span>Удалена после отправки — текст больше не хранится в памяти.</span></li>;
          }
          if (item.updatedAt !== reference.updatedAt) {
            return <li key={reference.id} className="is-unavailable"><span>Изменена после отправки — текущий текст не выдаётся за использованный.</span></li>;
          }
          return (
            <li key={reference.id}>
              <p>{item.text}</p>
              {item.status === "paused" ? <small>Сейчас на паузе</small> : null}
            </li>
          );
        })}
      </ol>
      <p className="reflection-used-memory-note">
        {queued ? "Выбор относится только к этому запросу." : "Выбор относился только к этому разбору."}
      </p>
    </details>
  );
}

function ArchivedSuggestions({
  entry,
  tasks
}: {
  entry: ReflectionDocument;
  tasks: Array<{ id: string; status: string }>;
}) {
  const suggestions = entry.reflection.suggestions;
  if (!suggestions.length) return null;
  const accepted = suggestions.filter((suggestion) => suggestion.status === "accepted").length;
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const dismissed = suggestions.filter((suggestion) => suggestion.status === "dismissed").length;
  const countCopy = [
    accepted ? `${accepted} принято` : "",
    pending ? `${pending} не решено` : "",
    dismissed ? `${dismissed} отклонено` : ""
  ].filter(Boolean).join(" · ");

  return (
    <details className="reflection-archive-suggestions">
      <summary>
        <Sparkles size={16} />
        <span>Предложения · {suggestions.length}</span>
        <small>{countCopy}</small>
        <ChevronDown size={15} />
      </summary>
      <div className="reflection-archive-suggestions-list">
        {suggestions.map((suggestion) => {
          const linkedTask = suggestion.createdTaskId
            ? tasks.find((task) => task.id === suggestion.createdTaskId) ?? null
            : null;
          let artifactCopy = "";
          if (suggestion.kind === "next_action" && suggestion.createdTaskId) {
            artifactCopy = linkedTask
              ? linkedTask.status === "inbox" ? "Во входящих" : "Связанная задача существует"
              : "Связанная задача удалена";
          } else if (suggestion.kind !== "next_action" && suggestion.addedToNoteAt) {
            artifactCopy = "В документе";
          }
          return (
            <article key={suggestion.id} className={`reflection-archive-suggestion is-${suggestion.status}`}>
              <div>
                <strong>{ARCHIVE_SUGGESTION_LABELS[suggestion.kind]}</strong>
                <span className={`reflection-suggestion-status is-${suggestion.status}`}>{ARCHIVE_SUGGESTION_STATUS[suggestion.status]}</span>
              </div>
              <p>{suggestion.text}</p>
              {artifactCopy ? <small>{artifactCopy}</small> : null}
            </article>
          );
        })}
        <p className="reflection-archive-suggestions-note">Откройте запись, чтобы изменить решения.</p>
      </div>
    </details>
  );
}

export function ReflectionArchiveDrawer({
  open,
  onClose,
  onOpenReflection,
  protectedEntryId = null
}: ReflectionArchiveDrawerProps) {
  const {
    state,
    rememberReflection,
    addAssistantMemory,
    updateAssistantMemory,
    removeAssistantMemory,
    removeReflection
  } = useDashboard();
  const reflections = useMemo(() => reflectionDocuments(state.notes), [state.notes]);
  const assistantMemory = state.assistantMemory ?? [];
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<ArchiveTab>("reflections");
  const [query, setQuery] = useState("");
  const [reflectionFilter, setReflectionFilter] = useState<ReflectionFilter>("all");
  const [memoryFilter, setMemoryFilter] = useState<MemoryFilter>("all");
  const [rememberingId, setRememberingId] = useState<string | null>(null);
  const [rememberDraft, setRememberDraft] = useState("");
  const [manualMemory, setManualMemory] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const [expandedReflectionIds, setExpandedReflectionIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!(document.activeElement instanceof Node) || !drawerRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  const search = normalizeSearch(query);
  const sortedReflections = useMemo(
    () => [...reflections].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [reflections]
  );
  const filteredReflections = useMemo(
    () => sortedReflections.filter((entry) => {
      if (reflectionFilter !== "all" && entry.reflection.status !== reflectionFilter) return false;
      return !search || normalizeSearch(reflectionSearchText(entry)).includes(search);
    }),
    [reflectionFilter, search, sortedReflections]
  );
  const filteredMemory = useMemo(
    () => [...assistantMemory]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .filter((item) => {
        if (memoryFilter !== "all" && item.status !== memoryFilter) return false;
        const source = memorySource(item, reflections);
        return !search || normalizeSearch(`${item.text} ${source.label}`).includes(search);
      }),
    [assistantMemory, memoryFilter, reflections, search]
  );
  const reflectionCounts = useMemo(() => {
    const counts = new Map<ReflectionFilter, number>([["all", reflections.length]]);
    for (const entry of reflections) {
      counts.set(entry.reflection.status, (counts.get(entry.reflection.status) ?? 0) + 1);
    }
    return counts;
  }, [reflections]);
  const memoryCounts = useMemo(() => ({
    all: assistantMemory.length,
    active: assistantMemory.filter((item) => item.status === "active").length,
    paused: assistantMemory.filter((item) => item.status === "paused").length
  }), [assistantMemory]);

  if (!open) return null;

  const openReflection = (id: string) => {
    onOpenReflection(id);
    onClose();
  };

  const beginRemembering = (entry: ReflectionDocument) => {
    const existing = assistantMemory.find(
      (item) => item.sourceType === "document" && item.sourceId === entry.id
    );
    setRememberingId(entry.id);
    setRememberDraft((
      existing?.text ||
      entry.reflection.correction ||
      entry.reflection.analysis?.understanding ||
      ""
    ).trim());
    setNotice("");
  };

  const saveReflectionMemory = (entry: ReflectionDocument) => {
    const text = rememberDraft.trim();
    if (!text) return;
    rememberReflection(entry.id, text);
    setRememberingId(null);
    setRememberDraft("");
    setNotice("Формулировка добавлена в память. Её можно поставить на паузу или удалить.");
  };

  const addManualMemory = () => {
    const text = manualMemory.trim();
    if (!text) return;
    addAssistantMemory(text);
    setManualMemory("");
    setNotice("Добавлено в память вручную.");
  };

  const saveMemoryEdit = (id: string) => {
    const text = editingMemoryText.trim();
    if (!text) return;
    updateAssistantMemory(id, { text });
    setEditingMemoryId(null);
    setEditingMemoryText("");
    setNotice("Формулировка обновлена.");
  };

  const deleteReflection = (entry: ReflectionDocument) => {
    if (entry.id === protectedEntryId) {
      setNotice("Сначала завершается безопасное сохранение разбора. Удаление станет доступно после очистки локальной очереди.");
      return;
    }
    if (entry.reflection.status === "queued") {
      setNotice("Сначала откройте запись и отмените ожидающий разбор — так локальная очередь не останется занятой.");
      return;
    }
    const confirmed = window.confirm(
      "Удалить этот документ и его разбор?\n\nЭлементы памяти останутся — их можно удалить отдельно. Документ можно будет восстановить из корзины."
    );
    if (!confirmed) return;
    removeReflection(entry.id);
    if (rememberingId === entry.id) {
      setRememberingId(null);
      setRememberDraft("");
    }
    setNotice("Документ перемещён в корзину. Память не изменена.");
  };

  const deleteMemory = (item: AssistantMemoryItem) => {
    if (!window.confirm(
      "Удалить эту формулировку из памяти помощника?\n\nЕсли она уже отправлена в незавершённом запросе, одноразовая копия может оставаться в локальной очереди до завершения или отмены. В истории скрытая копия не хранится: там появится отметка об удалении. Исходный документ останется."
    )) return;
    removeAssistantMemory(item.id);
    if (editingMemoryId === item.id) {
      setEditingMemoryId(null);
      setEditingMemoryText("");
    }
    setNotice("Удалено из памяти.");
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab: ArchiveTab = tab === "reflections" ? "memory" : "reflections";
    setTab(nextTab);
    window.setTimeout(() => document.getElementById(`reflection-archive-tab-${nextTab}`)?.focus(), 0);
  };

  return (
    <div className="reflection-archive-layer">
      <div className="reflection-archive-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="reflection-archive-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reflection-archive-title"
      >
        <header className="reflection-archive-header">
          <div className="reflection-archive-heading">
            <span className="reflection-archive-heading-icon"><NotebookPen size={21} /></span>
            <div>
              <span>Личное пространство</span>
              <h2 id="reflection-archive-title">Осмысление и память</h2>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="reflection-archive-close" onClick={onClose} aria-label="Закрыть историю">
            <X size={21} />
          </button>
        </header>

        <div className="reflection-archive-tabs" role="tablist" aria-label="Осмысление и память">
          <button
            id="reflection-archive-tab-reflections"
            type="button"
            role="tab"
            aria-selected={tab === "reflections"}
            aria-controls="reflection-archive-panel-reflections"
            tabIndex={tab === "reflections" ? 0 : -1}
            className={tab === "reflections" ? "is-active" : ""}
            onClick={() => { setTab("reflections"); setNotice(""); }}
            onKeyDown={handleTabKeyDown}
          >
            <NotebookPen size={17} /> Документы <span>{reflections.length}</span>
          </button>
          <button
            id="reflection-archive-tab-memory"
            type="button"
            role="tab"
            aria-selected={tab === "memory"}
            aria-controls="reflection-archive-panel-memory"
            tabIndex={tab === "memory" ? 0 : -1}
            className={tab === "memory" ? "is-active" : ""}
            onClick={() => { setTab("memory"); setNotice(""); }}
            onKeyDown={handleTabKeyDown}
          >
            <Brain size={17} /> Память <span>{assistantMemory.length}</span>
          </button>
        </div>

        <div className="reflection-archive-toolbar">
          <div className="reflection-archive-search" role="search">
            <Search size={18} />
            <input
              type="search"
              aria-label={tab === "reflections" ? "Поиск в документах и разборах" : "Поиск в памяти"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "reflections" ? "Найти в документах и разборах" : "Найти в памяти"}
            />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={16} /></button> : null}
          </div>

          {tab === "reflections" ? (
            <div className="reflection-archive-filters" aria-label="Статус документа">
              {REFLECTION_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={reflectionFilter === filter.value}
                  className={reflectionFilter === filter.value ? "is-active" : ""}
                  onClick={() => setReflectionFilter(filter.value)}
                >
                  {filter.label} <span>{reflectionCounts.get(filter.value) ?? 0}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="reflection-archive-filters" aria-label="Состояние памяти">
              {MEMORY_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={memoryFilter === filter.value}
                  className={memoryFilter === filter.value ? "is-active" : ""}
                  onClick={() => setMemoryFilter(filter.value)}
                >
                  {filter.label} <span>{memoryCounts[filter.value]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="reflection-archive-scroll">
          {notice ? <div className="reflection-archive-notice" role="status" aria-live="polite"><Check size={16} /> {notice}</div> : null}

          {tab === "reflections" ? (
            <section
              id="reflection-archive-panel-reflections"
              role="tabpanel"
              aria-labelledby="reflection-archive-tab-reflections"
              className="reflection-archive-panel"
            >
              <div className="reflection-archive-panel-intro">
                <div><strong>{filteredReflections.length}</strong><span>{query || reflectionFilter !== "all" ? "найдено" : "всего документов"}</span></div>
                <p>Это документы рабочего пространства с тегом «осмысление», а не отдельные копии заметок.</p>
              </div>

              {filteredReflections.length ? (
                <div className="reflection-archive-list">
                  {filteredReflections.map((entry) => {
                    const linkedMemory = assistantMemory.find((item) =>
                      item.sourceType === "document" && item.sourceId === entry.id
                    ) ?? null;
                    const canRemember = (
                      entry.reflection.status === "confirmed" ||
                      entry.reflection.status === "corrected"
                    ) && Boolean(entry.reflection.analysis);
                    const remembering = rememberingId === entry.id;
                    const longOriginal = entry.body.length > 240 || entry.body.split(/\r?\n/).length > 4;
                    const originalExpanded = expandedReflectionIds.includes(entry.id);
                    return (
                      <article key={entry.id} className="reflection-archive-card">
                        <div className="reflection-archive-card-meta">
                          <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                          <span className={`reflection-archive-status is-${entry.reflection.status}`}>{REFLECTION_STATUS_COPY[entry.reflection.status]}</span>
                        </div>
                        <p className={`reflection-archive-original ${longOriginal && !originalExpanded ? "is-clamped" : ""}`}>{entry.body}</p>
                        {longOriginal ? (
                          <button
                            type="button"
                            className="reflection-archive-expand"
                            aria-expanded={originalExpanded}
                            onClick={() => setExpandedReflectionIds((current) => current.includes(entry.id)
                              ? current.filter((id) => id !== entry.id)
                              : [...current, entry.id]
                            )}
                          >
                            {originalExpanded ? "Свернуть" : "Показать полностью"}
                            <ChevronDown size={15} className={originalExpanded ? "is-open" : ""} />
                          </button>
                        ) : null}

                        {entry.reflection.analysis?.understanding ? (
                          <div className="reflection-archive-understanding">
                            <span><Sparkles size={14} /> Я понял</span>
                            <p>{entry.reflection.analysis.understanding}</p>
                          </div>
                        ) : null}
                        {entry.reflection.correction ? (
                          <div className="reflection-archive-correction">
                            <span><PencilLine size={14} /> Ваша поправка</span>
                            <p>{entry.reflection.correction}</p>
                          </div>
                        ) : null}
                        <ArchivedUsedMemory entry={entry} memory={assistantMemory} />
                        <ArchivedSuggestions entry={entry} tasks={state.tasks} />

                        {remembering ? (
                          <div className="reflection-archive-remember-editor">
                            <div><Brain size={18} /><span><strong>Что именно запомнить?</strong><small>Сохранится только эта формулировка. Вы можете переписать её перед добавлением.</small></span></div>
                            <textarea
                              value={rememberDraft}
                              onChange={(event) => setRememberDraft(event.target.value)}
                              rows={3}
                              autoFocus
                              aria-label="Точная формулировка для памяти"
                            />
                            <div>
                              <button type="button" className="primary-button" onClick={() => saveReflectionMemory(entry)} disabled={!rememberDraft.trim()}><Brain size={16} /> Сохранить в память</button>
                              <button type="button" className="secondary-button" onClick={() => { setRememberingId(null); setRememberDraft(""); }}>Отмена</button>
                            </div>
                          </div>
                        ) : null}

                        <div className="reflection-archive-card-actions">
                          <button type="button" className="secondary-button" onClick={() => openReflection(entry.id)}><FileText size={16} /> Открыть</button>
                          {canRemember ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => beginRemembering(entry)}
                              disabled={remembering}
                            >
                              {linkedMemory ? <Check size={16} /> : <Brain size={16} />}
                              {linkedMemory ? "Изменить память" : "Запомнить"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="reflection-archive-delete"
                            onClick={() => deleteReflection(entry)}
                            disabled={entry.reflection.status === "queued" || entry.id === protectedEntryId}
                            title={entry.id === protectedEntryId
                              ? "Сначала завершается безопасное сохранение разбора"
                              : entry.reflection.status === "queued"
                                ? "Сначала откройте запись и отмените ожидающий разбор"
                                : undefined}
                          >
                            <Trash2 size={16} /> {entry.id === protectedEntryId
                              ? "Сохраняю разбор"
                              : entry.reflection.status === "queued"
                                ? "Сначала отменить разбор"
                                : "Удалить"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="reflection-archive-empty">
                  <NotebookPen size={25} />
                  <strong>{reflections.length ? "Ничего не найдено" : "Здесь появятся ваши документы"}</strong>
                  <p>{reflections.length ? "Попробуйте изменить запрос или фильтр." : "Добавьте обычному документу тег «осмысление», когда захотите разобрать его глубже."}</p>
                </div>
              )}
            </section>
          ) : (
            <section
              id="reflection-archive-panel-memory"
              role="tabpanel"
              aria-labelledby="reflection-archive-tab-memory"
              className="reflection-archive-panel"
            >
              <div className="reflection-memory-intro">
                <div className="reflection-memory-intro-icon"><Brain size={21} /></div>
                <div><strong>Память полностью под вашим контролем</strong><p>Формулировки передаются только при ручном выборе для одного разбора и не влияют на план автоматически.</p></div>
              </div>

              <div className="reflection-memory-manual">
                <label htmlFor="reflection-memory-manual-input">Добавить важную формулировку вручную</label>
                <textarea
                  id="reflection-memory-manual-input"
                  value={manualMemory}
                  onChange={(event) => setManualMemory(event.target.value)}
                  rows={3}
                  placeholder="Например: мне полезнее один реалистичный следующий шаг, чем длинный список советов."
                />
                <div><span>Текст можно изменить, поставить на паузу или удалить в любой момент.</span><button type="button" className="primary-button" onClick={addManualMemory} disabled={!manualMemory.trim()}><Plus size={16} /> Добавить</button></div>
              </div>

              {filteredMemory.length ? (
                <div className="reflection-memory-list">
                  {filteredMemory.map((item) => {
                    const source = memorySource(item, reflections);
                    const editing = editingMemoryId === item.id;
                    return (
                      <article key={item.id} className={`reflection-memory-card is-${item.status}`}>
                        <div className="reflection-memory-card-head">
                          <span className={`reflection-memory-state is-${item.status}`}>{item.status === "active" ? "Активна" : "На паузе"}</span>
                          <time dateTime={item.updatedAt}>Изменено {formatDate(item.updatedAt)}</time>
                        </div>

                        {editing ? (
                          <div className="reflection-memory-editor">
                            <textarea value={editingMemoryText} onChange={(event) => setEditingMemoryText(event.target.value)} rows={4} autoFocus aria-label="Изменить формулировку памяти" />
                            <div><button type="button" className="primary-button" onClick={() => saveMemoryEdit(item.id)} disabled={!editingMemoryText.trim()}><Check size={16} /> Сохранить</button><button type="button" className="secondary-button" onClick={() => { setEditingMemoryId(null); setEditingMemoryText(""); }}>Отмена</button></div>
                          </div>
                        ) : <p className="reflection-memory-text">{item.text}</p>}

                        <div className={`reflection-memory-source ${source.missing ? "is-missing" : source.stale ? "is-stale" : ""}`}>
                          {source.missing ? <Link2Off size={15} /> : <FileText size={15} />}
                          {source.reflection ? (
                            <button type="button" onClick={() => openReflection(source.reflection!.id)}>{source.label}</button>
                          ) : <span>{source.label}</span>}
                        </div>

                        <div className="reflection-memory-actions">
                          <button type="button" className="secondary-button" onClick={() => { setEditingMemoryId(item.id); setEditingMemoryText(item.text); }} disabled={editing}><PencilLine size={16} /> Изменить</button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => updateAssistantMemory(item.id, { status: item.status === "active" ? "paused" : "active" })}
                          >
                            {item.status === "active" ? <Pause size={16} /> : <Play size={16} />}
                            {item.status === "active" ? "Пауза" : "Возобновить"}
                          </button>
                          <button type="button" className="reflection-archive-delete" onClick={() => deleteMemory(item)}><Trash2 size={16} /> Удалить</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="reflection-archive-empty">
                  <Brain size={25} />
                  <strong>{assistantMemory.length ? "Ничего не найдено" : "Память пока пуста"}</strong>
                  <p>{assistantMemory.length ? "Попробуйте изменить запрос или фильтр." : "Добавляйте только то, что действительно поможет помощнику быть точнее."}</p>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
