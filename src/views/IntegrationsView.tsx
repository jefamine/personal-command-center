import {
  ArrowDownToLine,
  Bot,
  BookOpen,
  BookOpenText,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  FileJson,
  FolderOpen,
  FolderKanban,
  ListTodo,
  NotebookPen,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  acknowledgeCodexCommands,
  deleteDashboardSnapshot,
  exportNotesToObsidian,
  loadCodexCommands,
  publishDashboardSnapshot,
  selectLocalFolder,
  testObsidianVault
} from "../lib/integrationApi";
import { reflectionDocuments } from "../domain/reflections/reflectionNote";
import { useDashboard } from "../state/DashboardContext";
import type { CodexCommand, IntegrationStatus } from "../types";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`integration-switch ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function OptionRow({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <div className="integration-option">
      <div className="integration-option-icon">{icon}</div>
      <div><strong>{title}</strong><span>{description}</span></div>
      <div className="integration-option-control">{children}</div>
    </div>
  );
}

function statusLabel(status: IntegrationStatus) {
  if (status === "connected") return "Подключено";
  if (status === "configured") return "Настроено";
  if (status === "error") return "Нужна проверка";
  return "Не подключено";
}

function commandTitle(command: CodexCommand) {
  if (command.type === "add_task") return `Добавить задачу «${command.payload.title}»`;
  if (command.type === "update_task") return `Обновить задачу ${command.entityId}`;
  if (command.type === "complete_task") return `Завершить задачу ${command.entityId}`;
  if (command.type === "add_note") return `Добавить заметку «${command.payload.title}»`;
  if (command.type === "add_reading") return `Добавить материал «${command.payload.title}»`;
  return `Обновить заметку ${command.entityId}`;
}

function stamp(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "ещё не запускалось";
}

export function IntegrationsView() {
  const {
    state,
    addTask,
    updateTask,
    toggleTask,
    addNote,
    addReadingItem,
    updateNote,
    updateGoogleIntegration,
    updateObsidianIntegration,
    updateCodexIntegration
  } = useDashboard();
  const google = state.integrations.google;
  const obsidian = state.integrations.obsidian;
  const codex = state.integrations.codex;
  const snapshotScope = codex.snapshotScope;
  const reflectionEntries = reflectionDocuments(state.notes);
  const reflectionNoteIds = new Set(reflectionEntries.map((entry) => entry.id));
  const shareableNotesCount = state.notes.filter((note) =>
    note.origin !== "reflection" &&
    !reflectionNoteIds.has(note.id) &&
    !note.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление")
  ).length;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [commands, setCommands] = useState<CodexCommand[]>([]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(null);
    }
  };

  const testVault = () => run("vault", async () => {
    const result = await testObsidianVault(obsidian.vaultPath);
    updateObsidianIntegration({ enabled: true });
    setMessage(`Хранилище «${result.vaultName}» найдено. Экспорт готов.`);
  });

  const chooseVault = () => run("picker", async () => {
    const result = await selectLocalFolder();
    if (result.path) {
      updateObsidianIntegration({ vaultPath: result.path });
      setMessage("Папка выбрана. Теперь можно проверить хранилище.");
    }
  });

  const exportToVault = () => run("export", async () => {
    const result = await exportNotesToObsidian(obsidian, state.notes);
    const now = new Date().toISOString();
    updateObsidianIntegration({ enabled: true, lastExportAt: now });
    setMessage(`Готово: ${result.exported} заметок сохранено в ${result.destination}.`);
  });

  const publishSnapshot = () => run("snapshot", async () => {
    const result = await publishDashboardSnapshot(state);
    updateCodexIntegration({ lastSnapshotAt: result.writtenAt });
    setMessage(snapshotScope.journal
      ? "Опубликован отфильтрованный снимок. Дневник включён по вашему разрешению; настройки, пути, профиль и память помощника не переданы."
      : "Опубликован отфильтрованный снимок. Дневник, настройки, пути, профиль и память помощника в него не входят."
    );
  });

  const deleteSnapshot = () => run("snapshot-delete", async () => {
    await deleteDashboardSnapshot();
    updateCodexIntegration({ lastSnapshotAt: null });
    setMessage("Опубликованный снимок удалён из локального моста.");
  });

  const updateSnapshotScope = (key: keyof typeof snapshotScope, value: boolean) => {
    updateCodexIntegration({ snapshotScope: { ...snapshotScope, [key]: value } });
  };

  const snapshotSummary = [
    snapshotScope.tasks ? `${state.tasks.length} задач` : "",
    snapshotScope.projects ? `${state.projects.length} проектов` : "",
    snapshotScope.calendar ? `${state.events.length} событий` : "",
    snapshotScope.notes ? `${shareableNotesCount} заметок` : "",
    snapshotScope.journal ? `${reflectionEntries.length} документов осмысления` : "",
    snapshotScope.reading ? `${state.readingItems.length} материалов` : ""
  ].filter(Boolean).join(" · ") || "ничего не выбрано";

  const checkCommands = () => run("commands", async () => {
    const result = await loadCodexCommands();
    setCommands(result.commands);
    setMessage(result.commands.length ? `Найдено команд: ${result.commands.length}. Проверьте их перед применением.` : "Новых команд от Codex нет.");
  });

  const allowed = (command: CodexCommand) => {
    if (command.type === "add_task") return codex.allowCreateTasks;
    if (command.type === "update_task") return codex.allowUpdateTasks;
    if (command.type === "complete_task") return codex.allowCompleteTasks;
    if (command.type === "add_reading") return codex.allowReading;
    return codex.allowNotes;
  };

  const applyCommands = () => run("apply", async () => {
    const applicable = commands.filter(allowed);
    for (const command of applicable) {
      if (command.type === "add_task") addTask(command.payload);
      if (command.type === "update_task" && state.tasks.some((task) => task.id === command.entityId)) updateTask(command.entityId, command.payload);
      if (command.type === "complete_task") {
        const task = state.tasks.find((entry) => entry.id === command.entityId);
        if (task && task.status !== "done") toggleTask(task.id);
      }
      if (command.type === "add_note") addNote(command.payload);
      if (command.type === "add_reading") addReadingItem(command.payload);
      if (command.type === "update_note" && state.notes.some((note) => note.id === command.entityId)) updateNote(command.entityId, command.payload);
    }
    await acknowledgeCodexCommands(applicable.map((command) => command.id));
    updateCodexIntegration({ lastCommandImportAt: new Date().toISOString() });
    setCommands(commands.filter((command) => !applicable.includes(command)));
    setMessage(`Применено команд: ${applicable.length}. Исходный пакет сохранён в архиве моста.`);
  });

  return (
    <div className="page integrations-page">
      <section className="page-heading integrations-heading">
        <div>
          <span className="eyebrow"><Sparkles size={13} /> Автономная экосистема</span>
          <h1>Интеграции</h1>
          <p>Один центр управления календарём, задачами, заметками и работой с Codex. Локальные функции работают без подписки и внешнего сервера.</p>
        </div>
        <div className="integration-trust"><ShieldCheck size={18} /><span><strong>Под вашим контролем</strong>Изменения Codex подтверждаются здесь</span></div>
      </section>

      <section className="integration-status-grid">
        <article className="integration-status-card google-tone"><div className="integration-logo"><Cloud size={22} /></div><div><span>Google</span><strong>{statusLabel(google.status)}</strong></div><i className={google.status === "connected" ? "online" : ""} /></article>
        <article className="integration-status-card obsidian-tone"><div className="integration-logo"><NotebookPen size={22} /></div><div><span>Obsidian</span><strong>{obsidian.enabled ? "Готов к экспорту" : "Нужен путь"}</strong></div><i className={obsidian.enabled ? "online" : ""} /></article>
        <article className="integration-status-card codex-tone"><div className="integration-logo"><Bot size={22} /></div><div><span>Codex</span><strong>{codex.enabled ? "Файловый мост включён" : "Выключен"}</strong></div><i className={codex.enabled ? "online" : ""} /></article>
      </section>

      {message ? <div className="integration-message"><Check size={16} /><span>{message}</span></div> : null}

      <div className="integration-stack">
        <section className="panel integration-card">
          <header className="integration-card-header">
            <div className="integration-title-icon google-tone"><Cloud size={24} /></div>
            <div><span className="eyebrow">Календарь и задачи</span><h2>Google</h2><p>Правила уже сохраняются. Вход в Google можно добавить позже, не переделывая дашборд.</p></div>
            <div className="integration-master"><span>{google.enabled ? "Правила включены" : "Правила выключены"}</span><Switch label="Правила Google" checked={google.enabled} onChange={(enabled) => updateGoogleIntegration({ enabled, status: enabled ? "configured" : "disconnected" })} /></div>
          </header>
          <div className="integration-card-body two-column-options">
            <div className="integration-options">
              <OptionRow icon={<CalendarDays size={18} />} title="Читать календарь" description="Учитывать занятое время и находить свободные окна"><Switch label="Читать календарь" checked={google.calendarEnabled} onChange={(calendarEnabled) => updateGoogleIntegration({ calendarEnabled })} /></OptionRow>
              <OptionRow icon={<ListTodo size={18} />} title="Синхронизировать задачи" description="Забирать Google Tasks во входящие дашборда"><Switch label="Синхронизировать задачи" checked={google.tasksEnabled} onChange={(tasksEnabled) => updateGoogleIntegration({ tasksEnabled })} /></OptionRow>
              <OptionRow icon={<Send size={18} />} title="Отправлять фокус-блоки" description="После подтверждения плана записывать блоки в Google Calendar"><Switch label="Отправлять фокус-блоки" checked={google.writeFocusBlocks} onChange={(writeFocusBlocks) => updateGoogleIntegration({ writeFocusBlocks })} /></OptionRow>
            </div>
            <div className="integration-fields">
              <label><span>Календарь для фокуса</span><input value={google.focusCalendarName} onChange={(event) => updateGoogleIntegration({ focusCalendarName: event.target.value })} /></label>
              <label><span>Список Google Tasks</span><input value={google.tasksListName} onChange={(event) => updateGoogleIntegration({ tasksListName: event.target.value })} /></label>
              <label><span>Режим задач</span><select value={google.tasksMode} onChange={(event) => updateGoogleIntegration({ tasksMode: event.target.value as "inbox" | "two-way" })}><option value="inbox">Google → Входящие</option><option value="two-way">Двусторонний</option></select></label>
              <label><span>Если данные расходятся</span><select value={google.conflictPolicy} onChange={(event) => updateGoogleIntegration({ conflictPolicy: event.target.value as "latest" | "dashboard" })}><option value="latest">Побеждает свежее изменение</option><option value="dashboard">Главный — дашборд</option></select></label>
              <label><span>Проверять каждые</span><select value={google.syncIntervalMinutes} onChange={(event) => updateGoogleIntegration({ syncIntervalMinutes: Number(event.target.value) })}><option value={5}>5 минут</option><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>1 час</option></select></label>
              <div className="future-connection"><CircleAlert size={17} /><span><strong>Авторизация отложена</strong>Настройки полностью готовы; позже останется только выполнить вход.</span></div>
            </div>
          </div>
        </section>

        <section className="panel integration-card">
          <header className="integration-card-header">
            <div className="integration-title-icon obsidian-tone"><NotebookPen size={24} /></div>
            <div><span className="eyebrow">Личная база знаний</span><h2>Obsidian</h2><p>Экспортирует каждую заметку отдельным Markdown-файлом прямо в выбранное хранилище.</p></div>
            <span className="last-action">Последний экспорт<br /><strong>{stamp(obsidian.lastExportAt)}</strong></span>
          </header>
          <div className="integration-card-body obsidian-layout">
            <div className="vault-fields integration-fields">
              <label className="wide-field"><span>Папка хранилища Obsidian</span><div className="path-picker"><input value={obsidian.vaultPath} onChange={(event) => updateObsidianIntegration({ vaultPath: event.target.value, enabled: false })} placeholder="Выберите папку с каталогом .obsidian" /><button className="secondary-button" onClick={chooseVault} disabled={busy === "picker"}><FolderOpen size={16} /> Выбрать</button></div></label>
              <label><span>Папка внутри хранилища</span><input value={obsidian.folder} onChange={(event) => updateObsidianIntegration({ folder: event.target.value })} /></label>
              <label><span>Режим</span><select value={obsidian.mode} onChange={(event) => updateObsidianIntegration({ mode: event.target.value as "manual" | "mirror" })}><option value="manual">Вручную</option><option value="mirror">Зеркало (подготовлено)</option></select></label>
            </div>
            <div className="obsidian-actions">
              <OptionRow icon={<FileJson size={18} />} title="Служебные свойства" description="Добавлять теги, проект и идентификатор в YAML"><Switch label="Служебные свойства" checked={obsidian.includeFrontmatter} onChange={(includeFrontmatter) => updateObsidianIntegration({ includeFrontmatter })} /></OptionRow>
              <div className="action-row"><button className="secondary-button" onClick={testVault} disabled={!obsidian.vaultPath || busy === "vault"}><RefreshCw size={16} /> Проверить</button><button className="primary-button" onClick={exportToVault} disabled={!obsidian.vaultPath || busy === "export"}><ArrowDownToLine size={16} /> Экспортировать {state.notes.length}</button></div>
            </div>
          </div>
        </section>

        <section className="panel integration-card codex-card">
          <header className="integration-card-header">
            <div className="integration-title-icon codex-tone"><Bot size={24} /></div>
            <div><span className="eyebrow">Без платного API</span><h2>Мост Codex</h2><p>Передаёт только выбранные категории, а предложенные Codex изменения принимает через очередь с проверкой.</p></div>
            <div className="integration-master"><span>{codex.enabled ? "Мост включён" : "Мост выключен"}</span><Switch label="Мост Codex" checked={codex.enabled} onChange={(enabled) => updateCodexIntegration({ enabled })} /></div>
          </header>
          <div className="integration-card-body codex-layout">
            <div>
              <section className="snapshot-scope-card">
                <div className="snapshot-scope-heading"><ShieldCheck size={19} /><span><strong>Что войдёт в общий снимок</strong><small>Личная запись и отмеченные вами разделы контекста передаются только отдельным разовым запросом.</small></span></div>
                <div className="permission-grid snapshot-permission-grid">
                  <OptionRow icon={<ListTodo size={18} />} title="Задачи" description="Без заметок внутри задач"><Switch label="Передавать задачи" checked={snapshotScope.tasks} onChange={(value) => updateSnapshotScope("tasks", value)} /></OptionRow>
                  <OptionRow icon={<FolderKanban size={18} />} title="Проекты" description="Название, имя сферы и состояние; описания сфер не передаются"><Switch label="Передавать проекты" checked={snapshotScope.projects} onChange={(value) => updateSnapshotScope("projects", value)} /></OptionRow>
                  <OptionRow icon={<CalendarDays size={18} />} title="Календарь" description="Время и название, без описаний"><Switch label="Передавать календарь" checked={snapshotScope.calendar} onChange={(value) => updateSnapshotScope("calendar", value)} /></OptionRow>
                  <OptionRow icon={<NotebookPen size={18} />} title="Заметки" description="Без записей осмысления; по умолчанию выключены"><Switch label="Передавать заметки" checked={snapshotScope.notes} onChange={(value) => updateSnapshotScope("notes", value)} /></OptionRow>
                  <OptionRow icon={<BookOpenText size={18} />} title="Дневник" description="Исходные записи; включается отдельно"><Switch label="Передавать дневник" checked={snapshotScope.journal} onChange={(value) => updateSnapshotScope("journal", value)} /></OptionRow>
                  <OptionRow icon={<BookOpen size={18} />} title="Материалы" description="Ссылки и сохранённые тексты"><Switch label="Передавать материалы" checked={snapshotScope.reading} onChange={(value) => updateSnapshotScope("reading", value)} /></OptionRow>
                </div>
                <p className="bridge-meta">Состав сейчас: {snapshotSummary}. Настройки, пути, личный контекст и память помощника исключены всегда.</p>
              </section>
              <div className="permission-grid">
                <OptionRow icon={<Check size={18} />} title="Создавать задачи" description="Новые задачи и входящие"><Switch label="Создавать задачи" checked={codex.allowCreateTasks} onChange={(allowCreateTasks) => updateCodexIntegration({ allowCreateTasks })} /></OptionRow>
                <OptionRow icon={<RefreshCw size={18} />} title="Обновлять задачи" description="Названия, сроки и параметры"><Switch label="Обновлять задачи" checked={codex.allowUpdateTasks} onChange={(allowUpdateTasks) => updateCodexIntegration({ allowUpdateTasks })} /></OptionRow>
                <OptionRow icon={<ListTodo size={18} />} title="Завершать задачи" description="По умолчанию выключено"><Switch label="Завершать задачи" checked={codex.allowCompleteTasks} onChange={(allowCompleteTasks) => updateCodexIntegration({ allowCompleteTasks })} /></OptionRow>
                <OptionRow icon={<NotebookPen size={18} />} title="Работать с заметками" description="Создание и дополнение заметок"><Switch label="Работать с заметками" checked={codex.allowNotes} onChange={(allowNotes) => updateCodexIntegration({ allowNotes })} /></OptionRow>
                <OptionRow icon={<BookOpen size={18} />} title="Добавлять материалы" description="Ссылки, подборки и написанные статьи"><Switch label="Добавлять материалы" checked={codex.allowReading} onChange={(allowReading) => updateCodexIntegration({ allowReading })} /></OptionRow>
              </div>
              <div className="bridge-actions"><button className="primary-button" onClick={publishSnapshot} disabled={!codex.enabled || busy === "snapshot"}><Send size={16} /> Опубликовать выбранное</button><button className="secondary-button" onClick={deleteSnapshot} disabled={busy === "snapshot-delete"}><Trash2 size={16} /> Удалить снимок</button><button className="secondary-button" onClick={checkCommands} disabled={!codex.enabled || busy === "commands"}><RefreshCw size={16} /> Проверить команды</button></div>
              <p className="bridge-meta">Снимок: {stamp(codex.lastSnapshotAt)} · Команды: {stamp(codex.lastCommandImportAt)}</p>
            </div>
            <div className="command-queue">
              <div className="command-queue-heading"><div><span className="eyebrow">Очередь изменений</span><h3>{commands.length ? `${commands.length} ожидают` : "Очередь пуста"}</h3></div><FileJson size={20} /></div>
              {commands.length ? <div className="command-list">{commands.map((command) => <div key={command.id} className={!allowed(command) ? "is-blocked" : ""}><span>{commandTitle(command)}</span>{allowed(command) ? <ChevronRight size={15} /> : <small>Запрещено</small>}</div>)}</div> : <p>Codex может положить сюда пакет действий. Ни одно изменение не применяется незаметно.</p>}
              {commands.some(allowed) ? <button className="primary-button full-button" onClick={applyCommands} disabled={busy === "apply"}><Check size={16} /> Применить разрешённые</button> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
