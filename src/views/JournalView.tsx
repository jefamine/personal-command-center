import {
  BookOpenText,
  Bot,
  CheckCircle2,
  FileCheck2,
  FilePlus2,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReflectionWidget } from "../components/ReflectionWidget";
import { reflectionDocuments } from "../domain/reflections/reflectionNote";
import { useDashboard } from "../state/DashboardContext";
import type { DashboardWidget, ReflectionDocument } from "../types";

interface JournalViewProps {
  onOpenNote: (noteId: string) => void;
  onOpenWorkspace: () => void;
}

const assistantWidget: DashboardWidget = {
  id: "document-assistant",
  type: "document",
  title: "Помощник для документа",
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

function reflectionStatus(entry: ReflectionDocument) {
  if (entry.reflection.status === "queued") return "Ждёт ИИ";
  if (entry.reflection.status === "analyzed") return "Разобран";
  if (entry.reflection.status === "confirmed") return "Подтверждён";
  if (entry.reflection.status === "corrected") return "Исправлен";
  if (entry.reflection.status === "ignored") return "Без учёта";
  return "Сохранён";
}

export function JournalView({ onOpenNote, onOpenWorkspace }: JournalViewProps) {
  const {
    state,
    removeReflection,
    updateCodexIntegration
  } = useDashboard();
  const entries = useMemo(
    () => reflectionDocuments(state.notes).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.notes]
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;

  useEffect(() => {
    if (!entries.length) {
      setSelectedId(null);
      setAssistantOpen(false);
      return;
    }
    if (!selectedId || !entries.some((entry) => entry.id === selectedId)) {
      setSelectedId(entries[0].id);
      setAssistantOpen(false);
    }
  }, [entries, selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return normalized
      ? entries.filter((entry) => `${entry.body} ${entry.reflection.correction ?? ""} ${entry.reflection.analysis?.understanding ?? ""}`.toLocaleLowerCase("ru").includes(normalized))
      : entries;
  }, [entries, query]);

  const openNote = () => {
    if (!selected) return;
    onOpenNote(selected.id);
  };

  const removeSelected = () => {
    if (!selected || !window.confirm("Переместить этот документ в корзину? Его можно будет восстановить.")) return;
    removeReflection(selected.id);
  };

  const journalShared = state.integrations.codex.snapshotScope.journal;

  return (
    <div className="page journal-page">
      <section className="page-heading journal-heading">
        <div>
          <span className="eyebrow"><BookOpenText size={13} /> Писать — значит думать</span>
          <h1>Осмысление</h1>
          <p>Это не отдельный дневник: здесь собраны документы рабочего пространства с тегом «осмысление».</p>
        </div>
        <div className="journal-heading-stats">
          <span><strong>{entries.length}</strong><small>документов</small></span>
          <span><strong>{entries.filter((entry) => entry.reflection.analysis).length}</strong><small>разобрано</small></span>
        </div>
        <button type="button" className="primary-button" onClick={onOpenWorkspace}>
          <FilePlus2 size={17} /> Новый документ
        </button>
      </section>

      <section className={`panel journal-ai-card ${journalShared ? "is-enabled" : ""}`}>
        <div className="journal-ai-icon"><Bot size={23} /></div>
        <div>
          <span className="eyebrow">Память для помощника</span>
          <strong>{journalShared ? "ИИ может читать эти документы в общем снимке" : "Документы доступны ИИ только по одному"}</strong>
          <p>{journalShared ? "При следующей публикации локального снимка документы с тегом войдут в контекст Codex." : "Разбор одного документа уже работает. Чтение всей подборки включается только этой кнопкой."}</p>
        </div>
        <button
          type="button"
          className={journalShared ? "secondary-button" : "primary-button"}
          onClick={() => updateCodexIntegration({ snapshotScope: { ...state.integrations.codex.snapshotScope, journal: !journalShared } })}
        >
          <ShieldCheck size={16} /> {journalShared ? "Отключить общий доступ" : "Разрешить читать подборку"}
        </button>
      </section>

      <section className="journal-history-section">
        <div className="journal-section-heading">
          <div><span className="eyebrow">Вся хронология</span><h2>Сохранённые документы</h2></div>
          <label className="journal-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти мысль или тему" /></label>
        </div>

        {entries.length ? (
          <>
          <div className="journal-workspace">
            <aside className="panel journal-timeline" aria-label="Документы осмысления">
              {filtered.map((entry) => (
                <button key={entry.id} type="button" className={selected?.id === entry.id ? "active" : ""} onClick={() => { setSelectedId(entry.id); setAssistantOpen(false); }}>
                  <span className="journal-timeline-dot" />
                  <div><time>{formatJournalDate(entry.createdAt)}</time><strong>{entry.body}</strong><small>{reflectionStatus(entry)}</small></div>
                </button>
              ))}
              {!filtered.length ? <p className="journal-no-results">По этому запросу документов нет.</p> : null}
            </aside>

            <article className="panel journal-entry-detail">
              {selected ? (
                <>
                  <header>
                    <div><span className={`journal-status is-${selected.reflection.status}`}><CheckCircle2 size={14} /> {reflectionStatus(selected)}</span><time>{formatJournalDate(selected.createdAt)}</time></div>
                    <div className="journal-entry-actions">
                      <button type="button" className="secondary-button" onClick={() => setAssistantOpen((value) => !value)}><Bot size={16} /> {assistantOpen ? "Скрыть ИИ" : "ИИ-действия"}</button>
                      <button type="button" className="secondary-button" onClick={openNote}><FileCheck2 size={16} /> Открыть документ</button>
                      <button type="button" className="icon-button danger-icon-button" onClick={removeSelected} aria-label="Удалить документ"><Trash2 size={17} /></button>
                    </div>
                  </header>
                  <div className="journal-entry-text">{selected.body}</div>
                  <div className="journal-storage-line">
                    <FileCheck2 size={16} />
                    <span>Один документ в рабочем пространстве и экспорте Obsidian — без скрытой копии.</span>
                  </div>
                  {selected.reflection.analysis ? (
                    <section className="journal-analysis-summary">
                      <span><Sparkles size={15} /> Понимание ИИ</span>
                      <p>{selected.reflection.analysis.understanding}</p>
                      {selected.reflection.correction ? <blockquote><strong>Ваша поправка</strong>{selected.reflection.correction}</blockquote> : null}
                    </section>
                  ) : (
                    <section className="journal-analysis-empty"><Sparkles size={18} /><span><strong>Этот документ ещё не разобран</strong><small>Откройте ИИ-действия: разбор будет привязан к этому обычному документу.</small></span></section>
                  )}
                </>
              ) : null}
            </article>
          </div>
          {assistantOpen && selected ? (
            <div className="journal-document-assistant">
              <ReflectionWidget
                widget={assistantWidget}
                documentId={selected.id}
                allowDocumentCreation={false}
                showArchiveButton={false}
              />
            </div>
          ) : null}
          </>
        ) : (
          <section className="panel journal-empty"><BookOpenText size={28} /><h2>В подборке пока пусто</h2><p>Создайте обычный документ в рабочем пространстве и добавьте тег «осмысление».</p><button type="button" className="primary-button" onClick={onOpenWorkspace}>Открыть рабочее пространство</button></section>
        )}
      </section>
    </div>
  );
}
