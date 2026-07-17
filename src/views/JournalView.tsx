import {
  BookOpenText,
  Bot,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FilePlus2,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReflectionWidget } from "../components/ReflectionWidget";
import { useDashboard } from "../state/DashboardContext";
import type { DashboardWidget, ReflectionEntry } from "../types";

interface JournalViewProps {
  onOpenNote: (noteId: string) => void;
}

const journalWidget: DashboardWidget = {
  id: "journal-main-composer",
  type: "reflection",
  title: "Новая запись",
  enabled: true,
  size: "full",
  gridWidth: 12,
  gridHeight: 7,
  order: 0,
  config: {}
};

function formatJournalDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без даты";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function reflectionStatus(entry: ReflectionEntry) {
  if (entry.status === "queued") return "Ждёт ИИ";
  if (entry.status === "analyzed") return "Разобрана";
  if (entry.status === "confirmed") return "Подтверждена";
  if (entry.status === "corrected") return "Исправлена";
  if (entry.status === "ignored") return "Без учёта";
  return "Сохранена";
}

export function JournalView({ onOpenNote }: JournalViewProps) {
  const {
    state,
    ensureReflectionNote,
    removeReflection,
    updateCodexIntegration
  } = useDashboard();
  const entries = useMemo(
    () => [...(state.reflections ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.reflections]
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const linkedNote = selected?.noteId
    ? state.notes.find((note) => note.id === selected.noteId) ?? null
    : null;

  useEffect(() => {
    if (!entries.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !entries.some((entry) => entry.id === selectedId)) setSelectedId(entries[0].id);
  }, [entries, selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return normalized
      ? entries.filter((entry) => `${entry.originalText} ${entry.correction ?? ""} ${entry.analysis?.understanding ?? ""}`.toLocaleLowerCase("ru").includes(normalized))
      : entries;
  }, [entries, query]);

  const openNote = () => {
    if (!selected) return;
    const note = linkedNote ?? ensureReflectionNote(selected.id);
    if (note) onOpenNote(note.id);
  };

  const removeSelected = () => {
    if (!selected || !window.confirm("Переместить эту запись в корзину? Связанный документ останется в рабочем пространстве.")) return;
    removeReflection(selected.id);
  };

  const journalShared = state.integrations.codex.snapshotScope.journal;

  return (
    <div className="page journal-page">
      <section className="page-heading journal-heading">
        <div>
          <span className="eyebrow"><BookOpenText size={13} /> Писать — значит думать</span>
          <h1>Дневник</h1>
          <p>Записи не исчезают: каждая хранится в хронологии, создаёт связанную заметку и попадает в экспорт Obsidian.</p>
        </div>
        <div className="journal-heading-stats">
          <span><strong>{entries.length}</strong><small>записей</small></span>
          <span><strong>{entries.filter((entry) => entry.analysis).length}</strong><small>разобрано</small></span>
        </div>
      </section>

      <section className={`panel journal-ai-card ${journalShared ? "is-enabled" : ""}`}>
        <div className="journal-ai-icon"><Bot size={23} /></div>
        <div>
          <span className="eyebrow">Память для помощника</span>
          <strong>{journalShared ? "ИИ может читать дневник в общем снимке" : "Дневник доступен ИИ только по одной записи"}</strong>
          <p>{journalShared ? "При следующей публикации локального снимка записи войдут в контекст Codex." : "Разбор отдельной записи уже работает. Чтение всей хронологии включается только этой кнопкой."}</p>
        </div>
        <button
          type="button"
          className={journalShared ? "secondary-button" : "primary-button"}
          onClick={() => updateCodexIntegration({ snapshotScope: { ...state.integrations.codex.snapshotScope, journal: !journalShared } })}
        >
          <ShieldCheck size={16} /> {journalShared ? "Отключить общий доступ" : "Разрешить читать дневник"}
        </button>
      </section>

      <ReflectionWidget widget={journalWidget} startInCompose />

      <section className="journal-history-section">
        <div className="journal-section-heading">
          <div><span className="eyebrow">Вся хронология</span><h2>Сохранённые записи</h2></div>
          <label className="journal-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти мысль или тему" /></label>
        </div>

        {entries.length ? (
          <div className="journal-workspace">
            <aside className="panel journal-timeline" aria-label="Записи дневника">
              {filtered.map((entry) => (
                <button key={entry.id} type="button" className={selected?.id === entry.id ? "active" : ""} onClick={() => setSelectedId(entry.id)}>
                  <span className="journal-timeline-dot" />
                  <div><time>{formatJournalDate(entry.createdAt)}</time><strong>{entry.originalText}</strong><small>{reflectionStatus(entry)}</small></div>
                </button>
              ))}
              {!filtered.length ? <p className="journal-no-results">По этому запросу записей нет.</p> : null}
            </aside>

            <article className="panel journal-entry-detail">
              {selected ? (
                <>
                  <header>
                    <div><span className={`journal-status is-${selected.status}`}><CheckCircle2 size={14} /> {reflectionStatus(selected)}</span><time>{formatJournalDate(selected.createdAt)}</time></div>
                    <div className="journal-entry-actions">
                      <button type="button" className="secondary-button" onClick={openNote}>{linkedNote ? <FileCheck2 size={16} /> : <FilePlus2 size={16} />} {linkedNote ? "Открыть заметку" : "Восстановить заметку"}</button>
                      <button type="button" className="icon-button danger-icon-button" onClick={removeSelected} aria-label="Удалить запись"><Trash2 size={17} /></button>
                    </div>
                  </header>
                  <div className="journal-entry-text">{selected.originalText}</div>
                  <div className="journal-storage-line">
                    {linkedNote ? <FileCheck2 size={16} /> : <Clock3 size={16} />}
                    <span>{linkedNote ? `Связана с заметкой «${linkedNote.title}»` : "Связанная заметка не найдена — её можно восстановить одним нажатием"}</span>
                  </div>
                  {selected.analysis ? (
                    <section className="journal-analysis-summary">
                      <span><Sparkles size={15} /> Понимание ИИ</span>
                      <p>{selected.analysis.understanding}</p>
                      {selected.correction ? <blockquote><strong>Ваша поправка</strong>{selected.correction}</blockquote> : null}
                    </section>
                  ) : (
                    <section className="journal-analysis-empty"><Sparkles size={18} /><span><strong>Эта запись ещё не разобрана</strong><small>Откройте её в блоке выше или на главном экране и выберите «Разобрать».</small></span></section>
                  )}
                </>
              ) : null}
            </article>
          </div>
        ) : (
          <section className="panel journal-empty"><BookOpenText size={28} /><h2>Первая запись начнёт хронологию</h2><p>Напишите выше то, что сейчас занимает вас. Система сохранит исходный текст без разметки и оценки.</p></section>
        )}
      </section>
    </div>
  );
}
