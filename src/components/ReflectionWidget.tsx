import {
  Brain,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  History,
  Inbox,
  Lightbulb,
  LoaderCircle,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  acknowledgeReflectionAnalysis,
  cancelReflectionAnalysis,
  loadReflectionAnalysisResponse,
  queueReflectionAnalysis
} from "../lib/integrationApi";
import {
  availablePersonalContextSections,
  buildReflectionContextProjection,
  PERSONAL_CONTEXT_SECTION_LABELS,
  sectionsFromProjection,
  SVP_VECTOR_LABELS
} from "../domain/profile/personalContext";
import {
  buildReflectionMemoryProjection,
  MAX_REFLECTION_MEMORY_ITEMS
} from "../domain/reflections/reflectionMemory";
import {
  hasStoredReflectionResponse,
  type PendingReflectionAcknowledgement
} from "../domain/reflections/reflectionAcknowledgement";
import { ReflectionArchiveDrawer } from "./ReflectionArchiveDrawer";
import { ReflectionSuggestionsPanel } from "./ReflectionSuggestionsPanel";
import { useDashboard } from "../state/DashboardContext";
import type {
  AssistantMemoryItem,
  DashboardWidget,
  PersonalContextSectionId,
  ReflectionAnalysisRequest,
  ReflectionEntry
} from "../types";

interface ReflectionWidgetProps {
  widget: DashboardWidget;
  startInCompose?: boolean;
  onOpenJournal?: () => void;
}

type EditorMode = "compose" | "preview" | "correction";

function sourceUpdatedAt(entry: ReflectionEntry) {
  return (entry as ReflectionEntry & { updatedAt?: string }).updatedAt ?? entry.createdAt;
}

function statusCopy(status: ReflectionEntry["status"]) {
  if (status === "confirmed") return { label: "Подтверждено", icon: CheckCircle2 };
  if (status === "corrected") return { label: "Учтено с поправкой", icon: PenLine };
  if (status === "ignored") return { label: "Не учитывается", icon: X };
  return null;
}

function memorySourceLabel(item: AssistantMemoryItem, reflections: ReflectionEntry[]) {
  if (item.sourceType === "manual") return "Добавлено вручную";
  const source = item.sourceId
    ? reflections.find((entry) => entry.id === item.sourceId) ?? null
    : null;
  if (!source) return "Исходная запись удалена";
  const date = new Date(source.createdAt);
  const label = Number.isNaN(date.getTime())
    ? "Из личной записи"
    : `Из записи от ${date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
  return item.sourceUpdatedAt && item.sourceUpdatedAt !== source.updatedAt
    ? `${label} · источник изменён`
    : label;
}

interface UsedMemoryDetailsProps {
  entry: ReflectionEntry;
  memory: AssistantMemoryItem[];
  phase: "queued" | "analyzed";
}

function UsedMemoryDetails({ entry, memory, phase }: UsedMemoryDetailsProps) {
  const references = entry.analysisMemoryRefs ?? [];
  if (!references.length) return null;

  return (
    <details className="reflection-used-memory">
      <summary>
        <Brain size={16} />
        <span>{phase === "queued" ? "В запрос включена память" : "В разбор передана память"} · {references.length}</span>
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
        {phase === "queued" ? "Выбор относится только к этому запросу." : "Выбор относился только к этому разбору."}
      </p>
    </details>
  );
}

export function ReflectionWidget({ widget, startInCompose = false, onOpenJournal }: ReflectionWidgetProps) {
  const {
    state,
    addReflection,
    markReflectionQueued,
    cancelReflectionRequest,
    applyReflectionAnalysis,
    reviewReflection,
    removeReflection,
    addTask
  } = useDashboard();
  const reflections = state.reflections ?? [];
  const memoryPickerId = `reflection-memory-picker-${widget.id}`;
  const latest = useMemo(
    () => reflections.find((entry) => entry.status === "queued") ?? [...reflections].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [reflections]
  );
  const [activeId, setActiveId] = useState<string | null>(startInCompose ? null : latest?.id ?? null);
  const [composing, setComposing] = useState(startInCompose || !latest);
  const [mode, setMode] = useState<EditorMode>("compose");
  const [draftText, setDraftText] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);
  const [selectedContextSections, setSelectedContextSections] = useState<PersonalContextSectionId[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [memoryPickerOpen, setMemoryPickerOpen] = useState(false);
  const [memorySearch, setMemorySearch] = useState("");
  const [memorySelectionMessage, setMemorySelectionMessage] = useState("");
  const [pendingAcknowledgement, setPendingAcknowledgement] = useState<PendingReflectionAcknowledgement | null>(null);
  const [correction, setCorrection] = useState("");
  const [whyOpen, setWhyOpen] = useState(false);
  const [busy, setBusy] = useState<"queue" | "check" | "cancel" | null>(null);
  const [bridgeCheckActive, setBridgeCheckActive] = useState(false);
  const [message, setMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const checkingRef = useRef(false);
  const cancellingRef = useRef(false);
  const acknowledgingRef = useRef(false);
  const memoryPickerToggleRef = useRef<HTMLButtonElement>(null);

  const availableContextSections = useMemo(
    () => availablePersonalContextSections(state.personalContext),
    [state.personalContext]
  );
  const previewContext = useMemo(
    () => buildReflectionContextProjection(state.personalContext, selectedContextSections),
    [selectedContextSections, state.personalContext]
  );
  const activeMemoryItems = useMemo(
    () => [...(state.assistantMemory ?? [])]
      .filter((item) => item.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [state.assistantMemory]
  );
  const validSelectedMemoryIds = useMemo(() => {
    const activeIds = new Set(activeMemoryItems.map((item) => item.id));
    return selectedMemoryIds.filter((id) => activeIds.has(id));
  }, [activeMemoryItems, selectedMemoryIds]);
  const previewMemoryState = useMemo(() => {
    try {
      return {
        projection: buildReflectionMemoryProjection(state.assistantMemory ?? [], validSelectedMemoryIds),
        error: ""
      };
    } catch (error) {
      return {
        projection: null,
        error: error instanceof Error ? error.message : "Не удалось подготовить выбранную память."
      };
    }
  }, [state.assistantMemory, validSelectedMemoryIds]);
  const filteredMemoryItems = useMemo(() => {
    const normalized = memorySearch.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return activeMemoryItems;
    return activeMemoryItems.filter((item) =>
      `${item.text} ${memorySourceLabel(item, reflections)}`.toLocaleLowerCase("ru-RU").includes(normalized)
    );
  }, [activeMemoryItems, memorySearch, reflections]);
  const pendingAcknowledgementAccepted = useMemo(
    () => Boolean(pendingAcknowledgement && reflections.some((entry) =>
      hasStoredReflectionResponse(entry, pendingAcknowledgement)
    )),
    [pendingAcknowledgement, reflections]
  );

  const active = useMemo(
    () => reflections.find((entry) => entry.id === activeId) ?? (!composing ? latest : null),
    [activeId, composing, latest, reflections]
  );

  useEffect(() => {
    if (validSelectedMemoryIds.length === selectedMemoryIds.length) return;
    setSelectedMemoryIds(validSelectedMemoryIds);
    setMemorySelectionMessage("Одна из выбранных формулировок больше не активна и исключена из запроса.");
  }, [selectedMemoryIds.length, validSelectedMemoryIds]);

  const clearMemorySelection = () => {
    setSelectedMemoryIds([]);
    setMemoryPickerOpen(false);
    setMemorySearch("");
    setMemorySelectionMessage("");
  };

  const closeMemoryPicker = (restoreFocus = true) => {
    setMemoryPickerOpen(false);
    setMemorySearch("");
    setMemorySelectionMessage("");
    if (restoreFocus) window.setTimeout(() => memoryPickerToggleRef.current?.focus(), 0);
  };

  const toggleMemoryItem = (id: string) => {
    const next = selectedMemoryIds.includes(id)
      ? selectedMemoryIds.filter((entry) => entry !== id)
      : [...selectedMemoryIds, id];
    if (next.length > MAX_REFLECTION_MEMORY_ITEMS) {
      setMemorySelectionMessage(`Можно выбрать не больше ${MAX_REFLECTION_MEMORY_ITEMS} формулировок.`);
      return;
    }
    try {
      buildReflectionMemoryProjection(state.assistantMemory ?? [], next);
      setSelectedMemoryIds(next);
      setMemorySelectionMessage("");
    } catch (error) {
      setMemorySelectionMessage(error instanceof Error ? error.message : "Эту формулировку нельзя добавить в запрос.");
    }
  };

  const handleMemoryPickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeMemoryPicker();
  };

  const beginNew = () => {
    setActiveId(null);
    setComposing(true);
    setMode("compose");
    setDraftText("");
    setPreviewText("");
    setPreviewEntryId(null);
    setSelectedContextSections([]);
    clearMemorySelection();
    setCorrection("");
    setWhyOpen(false);
    setMessage("");
  };

  const saveOnly = () => {
    const text = draftText.trim();
    if (!text) return;
    const entry = addReflection(text);
    setActiveId(entry.id);
    setComposing(false);
    setDraftText("");
    setMessage("Запись сохранена и добавлена в «Заметки» для следующего экспорта в Obsidian.");
  };

  const openPreview = (text: string, entryId: string | null = null) => {
    const normalized = text.trim();
    if (!normalized) return;
    setPreviewText(normalized);
    setPreviewEntryId(entryId);
    setSelectedContextSections([]);
    clearMemorySelection();
    setMode("preview");
    setMessage("");
  };

  const queuePreview = async () => {
    if (!previewText.trim() || previewMemoryState.error) return;
    setBusy("queue");
    setMessage("");

    let entry = previewEntryId ? reflections.find((item) => item.id === previewEntryId) ?? null : null;
    if (!entry) {
      entry = addReflection(previewText);
      setActiveId(entry.id);
      setPreviewEntryId(entry.id);
    }
    setComposing(false);

    const requestId = crypto.randomUUID();
    const sourceStamp = sourceUpdatedAt(entry);
    const request: ReflectionAnalysisRequest = {
      entryId: entry.id,
      requestId,
      sourceUpdatedAt: sourceStamp,
      originalText: entry.originalText,
      context: previewContext,
      memory: previewMemoryState.projection
    };

    try {
      const queued = await queueReflectionAnalysis(request);
      const includedSections = sectionsFromProjection(previewContext);
      markReflectionQueued(
        entry.id,
        requestId,
        sourceStamp,
        queued.requestDigest,
        includedSections,
        previewContext?.profileUpdatedAt ?? null,
        request.memory
      );
      setMode("compose");
      setPreviewText("");
      setPreviewEntryId(null);
      setSelectedContextSections([]);
      clearMemorySelection();
      setMessage("Запись добавлена в «Заметки» и передана в локальную очередь. Проверяем ответ каждые 20 секунд.");
    } catch (error) {
      setMessage(error instanceof Error
        ? `Запись сохранена. ${error.message} Выбор оставлен для повторной попытки.`
        : "Запись сохранена, но поставить её в очередь пока не удалось. Выбор для повторной попытки оставлен без изменений.");
    } finally {
      setBusy(null);
    }
  };

  const checkAnalysis = useCallback(async (silent = false) => {
    if (
      !active ||
      active.status !== "queued" ||
      !active.analysisRequestId ||
      checkingRef.current ||
      cancellingRef.current
    ) return;
    checkingRef.current = true;
    setBridgeCheckActive(true);
    if (!silent) setBusy("check");

    try {
      const { response } = await loadReflectionAnalysisResponse();
      if (!response) {
        if (!silent) setMessage("Ответ пока не готов. Запись остаётся в очереди.");
        return;
      }
      if (response.requestId !== active.analysisRequestId || response.entryId !== active.id) {
        if (!silent) setMessage("Получен ответ для другой записи. Эта запись продолжает ждать своего разбора.");
        return;
      }
      if (response.sourceUpdatedAt !== active.analysisSourceUpdatedAt) {
        if (!silent) setMessage("Ответ относится к более ранней версии записи и не был применён.");
        return;
      }
      if (response.requestDigest !== active.analysisRequestDigest) {
        if (!silent) setMessage("Ответ не совпадает с подтверждённым текстом и контекстом и не был применён.");
        return;
      }

      applyReflectionAnalysis(response);
      setPendingAcknowledgement({
        entryId: response.entryId,
        requestId: response.requestId,
        requestDigest: response.requestDigest,
        responseId: response.analysis.responseId,
        sourceUpdatedAt: response.sourceUpdatedAt
      });
      setMessage("Разбор получен и сохраняется локально…");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Не удалось проверить ответ.");
    } finally {
      checkingRef.current = false;
      setBridgeCheckActive(false);
      if (!silent) setBusy(null);
    }
  }, [active, applyReflectionAnalysis]);

  useEffect(() => {
    if (!pendingAcknowledgement || acknowledgingRef.current) return;
    if (!pendingAcknowledgementAccepted) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    acknowledgingRef.current = true;
    void acknowledgeReflectionAnalysis(
      pendingAcknowledgement.responseId,
      pendingAcknowledgement.requestId,
      pendingAcknowledgement.requestDigest,
      pendingAcknowledgement.entryId,
      pendingAcknowledgement.sourceUpdatedAt
    ).then(({ acknowledged }) => {
      if (!acknowledged) throw new Error("Локальный мост не подтвердил сохранение ответа.");
      if (cancelled) return;
      setPendingAcknowledgement(null);
      setMessage("Разбор получен. Проверьте, верно ли помощник вас понял.");
    }).catch((error) => {
      if (cancelled) return;
      setMessage(error instanceof Error
        ? `${error.message} Повторю очистку локальной очереди автоматически.`
        : "Не удалось очистить локальную очередь; повторю автоматически.");
      retryTimer = window.setTimeout(() => {
        acknowledgingRef.current = false;
        setPendingAcknowledgement((current) => current ? { ...current } : null);
      }, 5_000);
    }).finally(() => {
      if (!retryTimer) acknowledgingRef.current = false;
    });

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      acknowledgingRef.current = false;
    };
  }, [pendingAcknowledgement, pendingAcknowledgementAccepted]);

  useEffect(() => {
    if (!active || active.status !== "queued") return;
    const timer = window.setInterval(() => { void checkAnalysis(true); }, 20_000);
    return () => window.clearInterval(timer);
  }, [active, checkAnalysis]);

  const deleteActive = () => {
    if (active && pendingAcknowledgement?.entryId === active.id) {
      setMessage("Сначала завершаю безопасное сохранение разбора. Удаление станет доступно после очистки локальной очереди.");
      return;
    }
    if (!active || !window.confirm("Удалить эту запись и её разбор? Связанная заметка и сохранённая память останутся отдельно.")) return;
    removeReflection(active.id);
    beginNew();
  };

  const cancelQueuedAnalysis = async () => {
    if (!active?.analysisRequestId || !active.analysisRequestDigest || active.status !== "queued") return;
    if (checkingRef.current) {
      setMessage("Сейчас завершается проверка ответа. После неё отмену можно будет повторить.");
      return;
    }
    cancellingRef.current = true;
    setBusy("cancel");
    setMessage("");
    try {
      await cancelReflectionAnalysis(active.analysisRequestId, active.analysisRequestDigest);
      cancelReflectionRequest(active.id);
      setMessage("Ожидание отменено. Запись осталась на устройстве и её можно разобрать позже.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отменить ожидание.");
    } finally {
      cancellingRef.current = false;
      setBusy(null);
    }
  };

  const saveCorrection = () => {
    if (!active || !correction.trim()) return;
    reviewReflection(active.id, "corrected", correction.trim());
    setMode("compose");
    setCorrection("");
    setMessage("Поправка сохранена отдельно от исходного разбора.");
  };

  const addProposedAction = () => {
    const title = active?.analysis?.proposedAction.trim();
    if (!active || !title) return;
    addTask({
      title,
      status: "inbox",
      notes: "Добавлено вручную из разбора личной записи."
    });
    setMessage("Предложенное действие добавлено во входящие.");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      openPreview(draftText);
    }
  };

  const toggleContextSection = (section: PersonalContextSectionId) => {
    setSelectedContextSections((current) => current.includes(section)
      ? current.filter((entry) => entry !== section)
      : [...current, section]
    );
  };

  const selectAllContext = () => {
    setSelectedContextSections((current) =>
      current.length === availableContextSections.length ? [] : [...availableContextSections]
    );
  };

  const leavePreview = () => {
    setMode("compose");
    setPreviewText("");
    setPreviewEntryId(null);
    setSelectedContextSections([]);
    clearMemorySelection();
  };

  const openArchivedReflection = (id: string) => {
    setActiveId(id);
    setComposing(false);
    setMode("compose");
    setDraftText("");
    setPreviewText("");
    setPreviewEntryId(null);
    setSelectedContextSections([]);
    clearMemorySelection();
    setCorrection("");
    setWhyOpen(false);
    setMessage("");
    setArchiveOpen(false);
  };
  const closeArchive = useCallback(() => setArchiveOpen(false), []);

  const proposedAction = active?.analysis?.proposedAction.trim() ?? "";
  const hasStructuredSuggestions = Boolean(active?.suggestions?.length);
  const selectedMemoryCount = previewMemoryState.projection?.items.length ?? 0;
  const hasSelectedAnalysisContext = selectedContextSections.length > 0 || selectedMemoryCount > 0;
  const actionAlreadyExists = Boolean(proposedAction && state.tasks.some(
    (task) => task.status !== "done" && task.title.trim().toLocaleLowerCase("ru") === proposedAction.toLocaleLowerCase("ru")
  ));
  const reviewStatus = active ? statusCopy(active.status) : null;
  const activeContextLabels = active?.analysisContextSections.map(
    (section) => PERSONAL_CONTEXT_SECTION_LABELS[section]
  ) ?? [];

  return (
    <>
    <section className="panel dashboard-widget reflection-widget">
      <header className="reflection-widget-header">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Личное пространство</span>
          <h2>{widget.title}</h2>
        </div>
        <div className="reflection-header-actions">
          <button type="button" className="reflection-new-button" onClick={() => setArchiveOpen(true)} aria-label="Открыть все записи и память"><History size={17} /> Все записи · {reflections.length}</button>
          {active && active.status !== "queued" && !composing && mode === "compose" ? (
            <button type="button" className="reflection-new-button" onClick={beginNew} aria-label="Новая запись"><Plus size={17} /> Новая запись</button>
          ) : null}
        </div>
      </header>

      {mode === "preview" ? (
        <div className="reflection-preview">
          <div className="reflection-preview-heading">
            <ShieldCheck size={22} />
            <div><strong>Перед отправкой</strong><span>Будет передан текст записи. Дополнительно — только выбранные вами разделы и формулировки памяти. Задачи, календарь и заметки не добавляются.</span></div>
          </div>
          <div className="reflection-source-preview" aria-label="Точный текст для передачи">{previewText}</div>
          {availableContextSections.length ? (
            <div className="reflection-context-selector">
              <div className="reflection-context-selector-heading">
                <div><strong>Добавить личный контекст?</strong><span>Необязательно. Ни один раздел не выбран заранее.</span></div>
                <button type="button" onClick={selectAllContext}>
                  {selectedContextSections.length === availableContextSections.length ? "Снять выбор" : "Выбрать всё"}
                </button>
              </div>
              <div className="reflection-context-options">
                {availableContextSections.map((section) => (
                  <label key={section} className={selectedContextSections.includes(section) ? "is-selected" : ""}>
                    <input
                      type="checkbox"
                      checked={selectedContextSections.includes(section)}
                      onChange={() => toggleContextSection(section)}
                    />
                    <span>{PERSONAL_CONTEXT_SECTION_LABELS[section]}</span>
                  </label>
                ))}
              </div>
              {previewContext ? (
                <div className="reflection-context-preview" aria-label="Точный личный контекст для передачи">
                  <span className="reflection-context-preview-label"><ShieldCheck size={14} /> Точный дополнительный контекст</span>
                  {(Object.keys(previewContext.sections) as PersonalContextSectionId[]).map((section) => {
                    const value = previewContext.sections[section];
                    if (value === null) return null;
                    if (section === "systemProfile" && typeof value === "object") {
                      return (
                        <section key={section}>
                          <strong>{PERSONAL_CONTEXT_SECTION_LABELS[section]}</strong>
                          <p>Язык: {value.mode === "systemic" ? "системные термины" : "обычные формулировки"}</p>
                          {value.selfDeclaredVectors.length ? <p>Указано пользователем: {value.selfDeclaredVectors.map((id) => SVP_VECTOR_LABELS[id]).join(", ")}</p> : null}
                          {value.manifestations ? <p>{value.manifestations}</p> : null}
                          {value.combinationNotes ? <p>{value.combinationNotes}</p> : null}
                        </section>
                      );
                    }
                    return <section key={section}><strong>{PERSONAL_CONTEXT_SECTION_LABELS[section]}</strong><p>{String(value)}</p></section>;
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="reflection-context-empty">Личный контекст пока не заполнен. Его можно один раз настроить в разделе «Настройки».</p>
          )}
          <div className="reflection-memory-selector">
            <button
              ref={memoryPickerToggleRef}
              type="button"
              className="reflection-memory-selector-toggle"
              aria-expanded={memoryPickerOpen}
              aria-controls={memoryPickerId}
              onClick={() => memoryPickerOpen ? closeMemoryPicker(false) : setMemoryPickerOpen(true)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !memoryPickerOpen) return;
                event.preventDefault();
                closeMemoryPicker(false);
              }}
            >
              <span className="reflection-memory-selector-icon"><Brain size={19} /></span>
              <span className="reflection-memory-selector-copy">
                <strong>Память помощника</strong>
                <small>{selectedMemoryCount ? `Выбрано формулировок: ${selectedMemoryCount}` : "Ничего не выбрано · добавляется только вручную"}</small>
              </span>
              <span className="reflection-memory-selector-action">
                {memoryPickerOpen ? "Скрыть" : selectedMemoryCount ? "Изменить" : "Выбрать"}
                <ChevronDown size={16} className={memoryPickerOpen ? "is-open" : ""} />
              </span>
            </button>

            {memoryPickerOpen ? (
              <div id={memoryPickerId} className="reflection-memory-picker" onKeyDown={handleMemoryPickerKeyDown}>
                {activeMemoryItems.length ? (
                  <>
                    <div className="reflection-memory-picker-heading">
                      <div><strong>Что из памяти передать?</strong><span>Выберите до {MAX_REFLECTION_MEMORY_ITEMS} формулировок. Они будут переданы дословно только в этом запросе.</span></div>
                      <span>{selectedMemoryCount}/{MAX_REFLECTION_MEMORY_ITEMS}</span>
                    </div>
                    {activeMemoryItems.length > 5 ? (
                      <div className="reflection-memory-picker-search" role="search">
                        <Search size={16} />
                        <input
                          type="search"
                          aria-label="Найти формулировку в активной памяти"
                          value={memorySearch}
                          onChange={(event) => setMemorySearch(event.target.value)}
                          placeholder="Найти формулировку"
                        />
                        {memorySearch ? <button type="button" onClick={() => setMemorySearch("")} aria-label="Очистить поиск"><X size={15} /></button> : null}
                      </div>
                    ) : null}
                    <fieldset className="reflection-memory-picker-options">
                      <legend>Активная память для этого разбора</legend>
                      {filteredMemoryItems.length ? filteredMemoryItems.map((item) => {
                        const checked = validSelectedMemoryIds.includes(item.id);
                        const atLimit = selectedMemoryCount >= MAX_REFLECTION_MEMORY_ITEMS;
                        return (
                          <label key={item.id} className={checked ? "is-selected" : ""}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && atLimit}
                              onChange={() => toggleMemoryItem(item.id)}
                            />
                            <span><strong>{item.text}</strong><small>{memorySourceLabel(item, reflections)}</small></span>
                          </label>
                        );
                      }) : <p className="reflection-memory-picker-empty">По этому запросу ничего не найдено.</p>}
                    </fieldset>
                    {memorySelectionMessage || previewMemoryState.error ? (
                      <p className="reflection-memory-picker-message" role="status">{memorySelectionMessage || previewMemoryState.error}</p>
                    ) : null}
                    <div className="reflection-memory-picker-footer">
                      <span role="status" aria-live="polite">Выбрано {selectedMemoryCount} из {MAX_REFLECTION_MEMORY_ITEMS}</span>
                      <button type="button" className="secondary-button" onClick={() => closeMemoryPicker()}>Готово</button>
                    </div>
                  </>
                ) : (
                  <div className="reflection-memory-picker-empty-state">
                    <Brain size={20} />
                    <div><strong>Активной памяти пока нет</strong><p>Добавить или возобновить формулировки можно в «Все записи» → «Память».</p></div>
                  </div>
                )}
              </div>
            ) : null}

            {previewMemoryState.projection ? (
              <div className="reflection-memory-exact-preview" aria-label="Точная память для передачи">
                <span><ShieldCheck size={14} /> Точная память для передачи</span>
                <ol>{previewMemoryState.projection.items.map((item) => <li key={item.id}>{item.text}</li>)}</ol>
              </div>
            ) : null}
            {!memoryPickerOpen && previewMemoryState.error ? <p className="reflection-memory-selector-error" role="alert">{previewMemoryState.error}</p> : null}
          </div>
          <div className="reflection-send-summary">
            <ShieldCheck size={15} />
            <span>
              Итог: {hasSelectedAnalysisContext
                ? `запись${selectedContextSections.length ? ` · личный контекст: ${selectedContextSections.length}` : ""}${selectedMemoryCount ? ` · память: ${selectedMemoryCount}` : ""}`
                : "только запись"}
            </span>
          </div>
          <div className="reflection-actions">
            <button type="button" className="primary-button" onClick={() => void queuePreview()} disabled={busy === "queue" || Boolean(previewMemoryState.error)}>
              {busy === "queue" ? <LoaderCircle className="is-spinning" size={17} /> : <Sparkles size={17} />}
              {busy === "queue"
                ? "Ставлю в очередь"
                : hasSelectedAnalysisContext
                  ? "Отправить с выбранным контекстом"
                  : "Отправить только запись"}
            </button>
            <button type="button" className="secondary-button" onClick={leavePreview} disabled={busy === "queue"}>Назад</button>
          </div>
        </div>
      ) : mode === "correction" && active?.analysis ? (
        <div className="reflection-correction">
          <div className="reflection-section-intro"><PenLine size={21} /><div><strong>Поправить понимание</strong><span>Исходный разбор сохранится, а ваша поправка будет храниться отдельно.</span></div></div>
          <blockquote>{active.analysis.understanding}</blockquote>
          <label>
            <span>Что понято неверно или чего не хватает?</span>
            <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} rows={4} autoFocus />
          </label>
          <div className="reflection-actions">
            <button type="button" className="primary-button" onClick={saveCorrection} disabled={!correction.trim()}><Check size={17} /> Сохранить поправку</button>
            <button type="button" className="secondary-button" onClick={() => { setMode("compose"); setCorrection(""); }}>Отмена</button>
          </div>
        </div>
      ) : composing || !active ? (
        <div className="reflection-composer">
          <label htmlFor={`reflection-input-${widget.id}`}>Что сейчас занимает вас?</label>
          <textarea
            id={`reflection-input-${widget.id}`}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={4}
            placeholder="Можно писать как думается — ничего размечать не нужно."
          />
          <div className="reflection-composer-footer">
            <span><ShieldCheck size={15} /> Сохранится локально и появится в «Заметках» для Obsidian</span>
            <div className="reflection-actions">
              <button type="button" className="reflection-save-button" onClick={saveOnly} disabled={!draftText.trim()}>Просто сохранить</button>
              <button type="button" className="primary-button" onClick={() => openPreview(draftText)} disabled={!draftText.trim()}><Sparkles size={17} /> Разобрать</button>
            </div>
          </div>
          <small className="reflection-key-hint">Ctrl + Enter — посмотреть и отправить на разбор</small>
        </div>
      ) : active.status === "queued" ? (
        <div className="reflection-queued">
          <div className="reflection-state-icon"><Clock3 size={24} /></div>
          <div className="reflection-queued-copy">
            <strong>Запись ждёт разбора</strong>
            <p>Она уже сохранена локально. Без готового ответа система не будет изображать глубокое понимание.</p>
            {activeContextLabels.length ? <p className="reflection-context-used">В запрос передано: {activeContextLabels.join(" · ")}</p> : null}
            <UsedMemoryDetails entry={active} memory={state.assistantMemory ?? []} phase="queued" />
            <details><summary>Показать отправленный текст <ChevronDown size={15} /></summary><div>{active.originalText}</div></details>
          </div>
          <div className="reflection-queued-actions">
            <button type="button" className="secondary-button reflection-check-button" onClick={() => void checkAnalysis(false)} disabled={busy !== null || bridgeCheckActive}>
              {busy === "check" || bridgeCheckActive ? <LoaderCircle className="is-spinning" size={17} /> : <RefreshCw size={17} />}
              {busy === "check" ? "Проверяю" : bridgeCheckActive ? "Автопроверка" : "Проверить ответ"}
            </button>
            <button type="button" className="reflection-ignore-button" onClick={() => void cancelQueuedAnalysis()} disabled={busy !== null || bridgeCheckActive}>
              {busy === "cancel" ? <LoaderCircle className="is-spinning" size={16} /> : <X size={16} />}
              {busy === "cancel" ? "Отменяю" : "Оставить без разбора"}
            </button>
          </div>
        </div>
      ) : active.analysis ? (
        <div className={`reflection-analysis ${active.status === "ignored" ? "is-ignored" : ""}`}>
          <div className="reflection-analysis-title">
            <div className="reflection-state-icon is-ready"><Lightbulb size={23} /></div>
            <div><span>{reviewStatus ? reviewStatus.label : "Проверьте понимание"}</span><h3>Я понял</h3></div>
            {reviewStatus ? (() => { const StatusIcon = reviewStatus.icon; return <span className={`reflection-review-badge is-${active.status}`}><StatusIcon size={15} /> {reviewStatus.label}</span>; })() : null}
          </div>

          <p className="reflection-understanding">{active.analysis.understanding}</p>
          {activeContextLabels.length ? <p className="reflection-context-used">В разбор передано: {activeContextLabels.join(" · ")}</p> : null}
          <UsedMemoryDetails entry={active} memory={state.assistantMemory ?? []} phase="analyzed" />

          {active.correction ? (
            <div className="reflection-user-correction"><PenLine size={18} /><div><span>Ваша поправка</span><p>{active.correction}</p></div></div>
          ) : null}

          {hasStructuredSuggestions ? <ReflectionSuggestionsPanel entry={active} /> : (
            <>
              {active.analysis.question ? (
                <div className="reflection-question"><CircleHelp size={19} /><div><span>Важный вопрос</span><strong>{active.analysis.question}</strong></div></div>
              ) : null}

              {proposedAction ? (
                <div className="reflection-proposal">
                  <div><Inbox size={19} /><span><small>Предлагаю</small><strong>{proposedAction}</strong></span></div>
                  <button type="button" className="secondary-button" onClick={addProposedAction} disabled={actionAlreadyExists}>
                    {actionAlreadyExists ? <Check size={17} /> : <Plus size={17} />}
                    {actionAlreadyExists ? "Уже во входящих" : "Добавить во входящие"}
                  </button>
                </div>
              ) : null}
            </>
          )}

          {whyOpen ? (
            <div className="reflection-why" id={`reflection-why-${active.id}`}>
              {active.analysis.observations.length ? <section><strong>На что я опираюсь</strong><ul>{active.analysis.observations.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
              {!hasStructuredSuggestions && active.analysis.possibleExplanation ? <section><strong>Возможное объяснение</strong><p>{active.analysis.possibleExplanation}</p></section> : null}
              {active.analysis.alternatives.length ? <section><strong>Другие варианты</strong><ul>{active.analysis.alternatives.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
            </div>
          ) : null}

          <div className="reflection-review-actions">
            {active.status === "analyzed" ? <button type="button" className="primary-button" onClick={() => reviewReflection(active.id, "confirmed")}><Check size={17} /> Верно</button> : null}
            {active.status !== "ignored" ? <button type="button" className="secondary-button" onClick={() => { setCorrection(active.correction ?? ""); setMode("correction"); }}><PenLine size={17} /> Поправить</button> : null}
            <button type="button" className="reflection-why-button" aria-expanded={whyOpen} aria-controls={`reflection-why-${active.id}`} onClick={() => setWhyOpen((value) => !value)}><CircleHelp size={17} /> {whyOpen ? "Скрыть объяснение" : "Почему?"}</button>
            {active.status === "analyzed" ? <button type="button" className="reflection-ignore-button" onClick={() => reviewReflection(active.id, "ignored")}><X size={16} /> Не учитывать</button> : null}
          </div>

          <button type="button" className="reflection-delete-button" onClick={deleteActive}><Trash2 size={16} /> Удалить запись</button>
        </div>
      ) : (
        <div className="reflection-saved">
          <div className="reflection-state-icon"><PenLine size={23} /></div>
          <div><strong>Запись сохранена</strong><p>{active.originalText}</p></div>
          <div className="reflection-saved-actions">
            <button type="button" className="primary-button" onClick={() => openPreview(active.originalText, active.id)}><Sparkles size={17} /> Разобрать</button>
            <button type="button" className="reflection-delete-button" onClick={deleteActive}><Trash2 size={16} /> Удалить</button>
          </div>
        </div>
      )}

      {onOpenJournal && reflections.length ? (
        <div className="reflection-recent-entries">
          <div><span><BookOpenText size={16} /> Последние записи</span><button type="button" onClick={onOpenJournal}>Открыть дневник</button></div>
          <div>
            {[...reflections].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3).map((entry) => (
              <button key={entry.id} type="button" className={active?.id === entry.id && !composing ? "active" : ""} onClick={() => openArchivedReflection(entry.id)}>
                <time>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.createdAt))}</time>
                <span>{entry.originalText}</span>
                <small>{entry.noteId && state.notes.some((note) => note.id === entry.noteId) ? "В заметках" : "Нужна заметка"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {message ? <div className="reflection-message" role="status" aria-live="polite">{message}</div> : null}
    </section>
    <ReflectionArchiveDrawer
      open={archiveOpen}
      onClose={closeArchive}
      onOpenReflection={openArchivedReflection}
      protectedEntryId={pendingAcknowledgement?.entryId ?? null}
    />
    </>
  );
}
