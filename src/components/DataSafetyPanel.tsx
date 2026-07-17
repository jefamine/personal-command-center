import {
  ArchiveRestore,
  Clock3,
  DatabaseBackup,
  History,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAutomaticBackups,
  createAutomaticBackup,
  listAutomaticBackups,
  loadAutomaticBackup,
  type AutomaticBackupSummary
} from "../lib/storage";
import { useDashboard } from "../state/DashboardContext";
import type { RecoverableEntityKind } from "../types";

const kindLabels: Record<RecoverableEntityKind, string> = {
  task: "Задача",
  note: "Документ",
  event: "Событие",
  object: "Объект"
};

function stamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без даты";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function DataSafetyPanel() {
  const {
    state,
    replaceState,
    restoreTrashEntry,
    purgeTrashEntry,
    emptyTrash,
    restoreRevision,
    clearRevisionHistory
  } = useDashboard();
  const [backups, setBackups] = useState<AutomaticBackupSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refreshBackups = useCallback(async () => {
    try {
      setBackups(await listAutomaticBackups());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать автоматические копии.");
    }
  }, []);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  const revisions = useMemo(
    () => [...state.revisionHistory].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)),
    [state.revisionHistory]
  );
  const trash = useMemo(
    () => [...state.trash].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)),
    [state.trash]
  );

  const restoreDeleted = (id: string) => {
    const restored = restoreTrashEntry(id);
    setMessage(restored ? "Объект восстановлен на прежнее место." : "Не удалось восстановить: объект с таким идентификатором уже существует.");
  };

  const purge = (id: string, title: string) => {
    if (!window.confirm(`Удалить «${title}» окончательно? После этого восстановление будет невозможно.`)) return;
    purgeTrashEntry(id);
    setMessage("Объект окончательно удалён.");
  };

  const restoreCheckpoint = (id: string, title: string) => {
    if (!window.confirm(`Вернуть «${title}» к этой версии? Текущее состояние тоже останется в истории.`)) return;
    const restored = restoreRevision(id);
    setMessage(restored ? "Версия восстановлена. Предыдущее состояние сохранено для обратного отката." : "Исходный объект больше не найден. Сначала проверьте корзину.");
  };

  const restoreBackup = async (backup: AutomaticBackupSummary) => {
    if (!window.confirm(`Восстановить состояние на ${stamp(backup.stateUpdatedAt)}? Текущее состояние будет предварительно сохранено отдельной копией.`)) return;
    setBusy(backup.key);
    try {
      await createAutomaticBackup(state);
      const restored = await loadAutomaticBackup(backup.key);
      replaceState(restored);
      setMessage("Автоматическая копия восстановлена. Состояние до восстановления также сохранено.");
      await refreshBackups();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось восстановить автоматическую копию.");
    } finally {
      setBusy(null);
    }
  };

  const makeCheckpoint = async () => {
    setBusy("create");
    try {
      await createAutomaticBackup(state);
      await refreshBackups();
      setMessage("Локальная контрольная копия создана.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось создать контрольную копию.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel data-safety-panel">
      <header className="data-safety-heading">
        <div className="settings-icon"><ShieldCheck size={22} /></div>
        <div>
          <span className="eyebrow">Защита от потерь</span>
          <h2>Корзина, версии и контрольные копии</h2>
          <p>Удаление теперь обратимо, а редактирование создаёт ограниченную историю без записи каждого нажатия клавиши.</p>
        </div>
        <div className="safety-status"><i /><span><strong>Локально</strong>до 5 копий · 200 версий</span></div>
      </header>

      {message ? <p className="settings-message data-safety-message" role="status">{message}</p> : null}

      <div className="data-safety-grid">
        <section className="safety-column">
          <div className="safety-column-heading">
            <div><Trash2 size={18} /><span><strong>Корзина</strong><small>{trash.length} объектов</small></span></div>
            {trash.length ? <button type="button" className="text-button danger-text" onClick={() => {
              if (!window.confirm("Очистить всю корзину окончательно?")) return;
              emptyTrash();
              setMessage("Корзина очищена.");
            }}>Очистить</button> : null}
          </div>
          <div className="safety-list">
            {trash.length ? trash.map((entry) => (
              <article key={entry.id}>
                <div className="safety-item-icon"><Trash2 size={15} /></div>
                <div><strong>{entry.title || "Без названия"}</strong><small>{kindLabels[entry.entityKind]} · {stamp(entry.deletedAt)}</small></div>
                <div className="safety-item-actions">
                  <button type="button" onClick={() => restoreDeleted(entry.id)} title="Восстановить"><ArchiveRestore size={16} /></button>
                  <button type="button" className="is-danger" onClick={() => purge(entry.id, entry.title)} title="Удалить окончательно"><XCircle size={16} /></button>
                </div>
              </article>
            )) : <div className="safety-empty"><Trash2 size={20} /><span>Корзина пуста</span></div>}
          </div>
        </section>

        <section className="safety-column">
          <div className="safety-column-heading">
            <div><History size={18} /><span><strong>История версий</strong><small>{revisions.length} точек возврата</small></span></div>
            {revisions.length ? <button type="button" className="text-button" onClick={() => {
              if (!window.confirm("Очистить историю версий? Основные данные не изменятся.")) return;
              clearRevisionHistory();
              setMessage("История версий очищена.");
            }}>Очистить</button> : null}
          </div>
          <div className="safety-list">
            {revisions.length ? revisions.slice(0, 30).map((entry) => (
              <article key={entry.id}>
                <div className="safety-item-icon"><Clock3 size={15} /></div>
                <div><strong>{entry.title || "Без названия"}</strong><small>{kindLabels[entry.entityKind]} · {stamp(entry.capturedAt)}</small></div>
                <div className="safety-item-actions"><button type="button" onClick={() => restoreCheckpoint(entry.id, entry.title)} title="Вернуть эту версию"><RotateCcw size={16} /></button></div>
              </article>
            )) : <div className="safety-empty"><History size={20} /><span>Версии появятся после изменений</span></div>}
          </div>
        </section>

        <section className="safety-column">
          <div className="safety-column-heading">
            <div><DatabaseBackup size={18} /><span><strong>Копии состояния</strong><small>{backups.length} локальных снимков</small></span></div>
            <button type="button" className="text-button" onClick={makeCheckpoint} disabled={busy === "create"}>Создать</button>
          </div>
          <div className="safety-list">
            {backups.length ? backups.map((backup) => (
              <article key={backup.key}>
                <div className="safety-item-icon"><DatabaseBackup size={15} /></div>
                <div><strong>{stamp(backup.stateUpdatedAt)}</strong><small>Снимок создан {stamp(backup.createdAt)}</small></div>
                <div className="safety-item-actions"><button type="button" onClick={() => void restoreBackup(backup)} disabled={busy === backup.key} title="Восстановить состояние"><RotateCcw size={16} /></button></div>
              </article>
            )) : <div className="safety-empty"><DatabaseBackup size={20} /><span>Первая копия появится после изменений</span></div>}
          </div>
          {backups.length ? <button type="button" className="clear-backups-button" onClick={async () => {
            if (!window.confirm("Удалить автоматические копии? Корзина и история версий останутся.")) return;
            await clearAutomaticBackups();
            await refreshBackups();
            setMessage("Автоматические копии очищены.");
          }}>Удалить локальные копии</button> : null}
        </section>
      </div>
    </section>
  );
}
