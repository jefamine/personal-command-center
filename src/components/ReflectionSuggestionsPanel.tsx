import {
  AlertCircle,
  Check,
  CircleHelp,
  Inbox,
  Lightbulb,
  ListTodo,
  NotebookPen,
  PencilLine,
  Plus,
  RotateCcw,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDashboard } from "../state/DashboardContext";
import type { ReflectionDocument, ReflectionSuggestion } from "../types";

interface ReflectionSuggestionsPanelProps {
  entry: ReflectionDocument;
}

const SUGGESTION_COPY: Record<ReflectionSuggestion["kind"], { label: string; icon: typeof Lightbulb }> = {
  meaning: { label: "Возможный смысл", icon: Lightbulb },
  question: { label: "Вопрос для размышления", icon: CircleHelp },
  next_action: { label: "Возможный следующий шаг", icon: ListTodo }
};

const STATUS_COPY: Record<ReflectionSuggestion["status"], string> = {
  pending: "Не решено",
  accepted: "Принято",
  dismissed: "Отклонено"
};

const SUGGESTION_MAX_LENGTH: Record<ReflectionSuggestion["kind"], number> = {
  meaning: 4_000,
  question: 1_500,
  next_action: 2_000
};

export function ReflectionSuggestionsPanel({ entry }: ReflectionSuggestionsPanelProps) {
  const {
    state,
    editReflectionSuggestion,
    decideReflectionSuggestion,
    addReflectionSuggestionToNote,
    createTaskFromReflectionSuggestion
  } = useDashboard();
  const suggestions = entry.reflection.suggestions;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const editButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setEditingId(null);
    setDraft("");
    setMessage("");
  }, [entry.id]);

  if (!suggestions.length) return null;

  const focusCard = (id: string) => {
    window.setTimeout(() => cardRefs.current[id]?.focus(), 0);
  };

  const focusEditButton = (id: string) => {
    window.setTimeout(() => editButtonRefs.current[id]?.focus(), 0);
  };

  const beginEditing = (suggestion: ReflectionSuggestion) => {
    setEditingId(suggestion.id);
    setDraft(suggestion.text);
    setMessage("");
  };

  const cancelEditing = (id: string) => {
    setEditingId(null);
    setDraft("");
    focusEditButton(id);
  };

  const saveEditing = (suggestion: ReflectionSuggestion) => {
    const text = draft.trim();
    if (!text || text.length > SUGGESTION_MAX_LENGTH[suggestion.kind]) return;
    editReflectionSuggestion(entry.id, suggestion.id, text);
    setEditingId(null);
    setDraft("");
    setMessage("Формулировка сохранена. Решение по предложению не изменилось.");
    focusEditButton(suggestion.id);
  };

  const handleEditorKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    suggestion: ReflectionSuggestion
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      saveEditing(suggestion);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing(suggestion.id);
    }
  };

  const decide = (suggestion: ReflectionSuggestion, status: ReflectionSuggestion["status"]) => {
    decideReflectionSuggestion(entry.id, suggestion.id, status);
    setEditingId(null);
    setDraft("");
    setMessage(
      status === "accepted"
        ? "Предложение принято. Никаких внешних действий не выполнено."
        : status === "dismissed"
          ? "Предложение отклонено. Его можно вернуть в любой момент."
          : "Предложение снова ожидает вашего решения."
    );
    focusCard(suggestion.id);
  };

  const addToNote = (suggestion: ReflectionSuggestion) => {
    const note = addReflectionSuggestionToNote(entry.id, suggestion.id);
    setMessage(note
      ? "Предложение добавлено в этот документ. Файл Obsidian пока не изменён."
      : "Не удалось добавить предложение в документ. Проверьте, что оно принято."
    );
    focusCard(suggestion.id);
  };

  const createTask = (suggestion: ReflectionSuggestion) => {
    const task = createTaskFromReflectionSuggestion(entry.id, suggestion.id);
    setMessage(task
      ? "Задача добавлена во входящие. Дальнейшие изменения предложения не изменят её автоматически."
      : "Не удалось создать задачу. Проверьте, что следующий шаг принят."
    );
    focusCard(suggestion.id);
  };

  return (
    <section className="reflection-suggestions" aria-labelledby={`reflection-suggestions-${entry.id}`}>
      <header className="reflection-suggestions-heading">
        <span><Sparkles size={14} /> Необязательно</span>
        <h4 id={`reflection-suggestions-${entry.id}`}>Предложения из разбора</h4>
        <p>Решения независимы. Ничего не становится памятью, заметкой или задачей автоматически.</p>
      </header>

      <div className="reflection-suggestions-list">
        {suggestions.map((suggestion) => {
          const copy = SUGGESTION_COPY[suggestion.kind];
          const SuggestionIcon = copy.icon;
          const editing = editingId === suggestion.id;
          const editedByUser = suggestion.text !== suggestion.sourceText;
          const linkedNoteExists = Boolean(suggestion.addedToNoteAt);
          const noteWasDeleted = false;
          const linkedTask = suggestion.createdTaskId
            ? state.tasks.find((task) => task.id === suggestion.createdTaskId) ?? null
            : null;
          const taskWasDeleted = Boolean(suggestion.createdTaskId && !linkedTask);
          const maxLength = SUGGESTION_MAX_LENGTH[suggestion.kind];
          const cardId = `reflection-suggestion-${entry.id}-${suggestion.id}`;

          return (
            <article
              key={suggestion.id}
              id={cardId}
              ref={(node) => { cardRefs.current[suggestion.id] = node; }}
              className={`reflection-suggestion-card is-${suggestion.status} is-${suggestion.kind}`}
              tabIndex={-1}
              aria-labelledby={`${cardId}-title`}
            >
              <div className="reflection-suggestion-card-heading">
                <span className="reflection-suggestion-kind-icon"><SuggestionIcon size={18} /></span>
                <div>
                  <h5 id={`${cardId}-title`}>{copy.label}</h5>
                  {editedByUser ? <small>Изменено вами</small> : null}
                </div>
                <span className={`reflection-suggestion-status is-${suggestion.status}`}>{STATUS_COPY[suggestion.status]}</span>
              </div>

              {editing ? (
                <div className="reflection-suggestion-editor">
                  <label htmlFor={`${cardId}-editor`}>Формулировка</label>
                  <textarea
                    id={`${cardId}-editor`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => handleEditorKeyDown(event, suggestion)}
                    rows={4}
                    maxLength={maxLength}
                    autoFocus
                  />
                  <small>
                    Сохранение текста не принимает предложение
                    {suggestion.addedToNoteAt || suggestion.createdTaskId ? " и не меняет созданный ранее внешний объект" : ""}
                    {` · ${draft.length}/${maxLength}`}
                  </small>
                  <div>
                    <button type="button" className="primary-button" onClick={() => saveEditing(suggestion)} disabled={!draft.trim()}><Check size={16} /> Сохранить</button>
                    <button type="button" className="secondary-button" onClick={() => cancelEditing(suggestion.id)}>Отмена</button>
                  </div>
                </div>
              ) : (
                <p className="reflection-suggestion-text">{suggestion.text}</p>
              )}

              {!editing && suggestion.status !== "accepted" && (suggestion.addedToNoteAt || suggestion.createdTaskId) ? (
                <p className={`reflection-suggestion-existing-output-note ${noteWasDeleted || taskWasDeleted ? "has-warning" : ""}`}>
                  {suggestion.kind === "next_action"
                    ? taskWasDeleted
                      ? "Связанная задача удалена. Верните и примите предложение, чтобы создать её снова."
                      : "Созданная ранее задача останется без изменений."
                      : "Добавленный ранее фрагмент документа останется без изменений."}
                </p>
              ) : null}

              {!editing && suggestion.status === "pending" ? (
                <div className="reflection-suggestion-actions" role="group" aria-label={`Решение: ${copy.label}`}>
                  <button ref={(node) => { editButtonRefs.current[suggestion.id] = node; }} type="button" className="secondary-button" onClick={() => beginEditing(suggestion)}><PencilLine size={16} /> Изменить</button>
                  <button type="button" className="primary-button" onClick={() => decide(suggestion, "accepted")}><Check size={16} /> Принять</button>
                  <button type="button" className="reflection-suggestion-dismiss" onClick={() => decide(suggestion, "dismissed")}><X size={16} /> Отклонить</button>
                </div>
              ) : null}

              {!editing && suggestion.status === "accepted" ? (
                <>
                  <div className="reflection-suggestion-actions" role="group" aria-label={`Изменить решение: ${copy.label}`}>
                    <button type="button" className="secondary-button" onClick={() => decide(suggestion, "pending")}><RotateCcw size={16} /> Вернуть к выбору</button>
                    <button type="button" className="reflection-suggestion-dismiss" onClick={() => decide(suggestion, "dismissed")}><X size={16} /> Отклонить</button>
                  </div>

                  {suggestion.kind === "meaning" || suggestion.kind === "question" ? (
                    <div className={`reflection-suggestion-output ${noteWasDeleted ? "has-warning" : ""}`}>
                      <div>
                        {noteWasDeleted ? <AlertCircle size={18} /> : <NotebookPen size={18} />}
                        <span>
                          <strong>{linkedNoteExists ? "Добавлено в документ" : "Можно добавить в документ"}</strong>
                          <small>{linkedNoteExists
                            ? "Файл Obsidian изменится только при следующем экспорте. Дальнейшие изменения предложения не меняют добавленный фрагмент автоматически."
                            : "Файл Obsidian изменится только при следующем экспорте."}</small>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={linkedNoteExists}
                        onClick={() => addToNote(suggestion)}
                      >
                        {linkedNoteExists ? <Check size={16} /> : <Plus size={16} />}
                        {linkedNoteExists ? "В документе" : "Добавить в документ"}
                      </button>
                    </div>
                  ) : (
                    <div className={`reflection-suggestion-output ${taskWasDeleted ? "has-warning" : ""}`}>
                      <div>
                        {taskWasDeleted ? <AlertCircle size={18} /> : <Inbox size={18} />}
                        <span>
                          <strong>{taskWasDeleted ? "Связанная задача удалена" : linkedTask ? "Задача создана" : "Шаг принят. Задача ещё не создана"}</strong>
                          <small>{linkedTask
                            ? "Дальнейшие изменения предложения не меняют задачу автоматически."
                            : "Во входящие ничего не добавится без отдельного нажатия."}</small>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={Boolean(linkedTask)}
                        onClick={() => createTask(suggestion)}
                      >
                        {linkedTask ? <Check size={16} /> : <Plus size={16} />}
                        {linkedTask
                          ? linkedTask.status === "inbox" ? "Во входящих" : "Задача создана"
                          : taskWasDeleted ? "Создать задачу снова" : "Добавить во входящие"}
                      </button>
                    </div>
                  )}
                </>
              ) : null}

              {!editing && suggestion.status === "dismissed" ? (
                <div className="reflection-suggestion-dismissed-actions">
                  <button type="button" className="secondary-button" onClick={() => decide(suggestion, "pending")}><RotateCcw size={16} /> Вернуть</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {message ? <p className="reflection-suggestions-message" role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}
