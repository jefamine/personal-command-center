import {
  Check,
  ChevronDown,
  CircleUserRound,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useDashboard } from "../state/DashboardContext";
import type { PersonalContext, PersonalContextPatch, SvpLanguageMode, SvpVectorId } from "../types";

const vectorOptions: Array<{ id: SvpVectorId; label: string }> = [
  { id: "skin", label: "Кожный" },
  { id: "anal", label: "Анальный" },
  { id: "muscular", label: "Мышечный" },
  { id: "urethral", label: "Уретральный" },
  { id: "visual", label: "Зрительный" },
  { id: "sound", label: "Звуковой" },
  { id: "oral", label: "Оральный" },
  { id: "olfactory", label: "Обонятельный" }
];

const languageModes: Array<{ id: SvpLanguageMode; label: string; description: string }> = [
  { id: "off", label: "Не использовать", description: "Обычный личный контекст без системных терминов" },
  { id: "plain", label: "Простой язык", description: "Смысл сохраняется, формулировки остаются повседневными" },
  { id: "systemic", label: "Системный язык", description: "Можно использовать указанные вами системные понятия" }
];

function cloneContext(context: PersonalContext): PersonalContext {
  return {
    ...context,
    systemProfile: {
      ...context.systemProfile,
      selfDeclaredVectors: [...context.systemProfile.selfDeclaredVectors]
    }
  };
}

function comparableContext(context: PersonalContext) {
  return JSON.stringify({
    goals: context.goals,
    rhythms: context.rhythms,
    preferences: context.preferences,
    boundaries: context.boundaries,
    systemProfile: context.systemProfile
  });
}

function clearedContext(context: PersonalContext): PersonalContext {
  return {
    ...context,
    goals: "",
    rhythms: "",
    preferences: "",
    boundaries: "",
    systemProfile: {
      mode: "off",
      selfDeclaredVectors: [],
      manifestations: "",
      combinationNotes: ""
    }
  };
}

export function PersonalContextPanel() {
  const { state, updatePersonalContext, clearPersonalContext } = useDashboard();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<PersonalContext>(() => cloneContext(state.personalContext));
  const [message, setMessage] = useState("");
  const panelId = useId();

  useEffect(() => {
    setDraft(cloneContext(state.personalContext));
  }, [state.personalContext]);

  const completedSections = useMemo(() => {
    const textSections = [draft.goals, draft.rhythms, draft.preferences, draft.boundaries]
      .filter((value) => value.trim().length > 0).length;
    return textSections + (draft.systemProfile.mode !== "off" ? 1 : 0);
  }, [draft]);

  const changed = comparableContext(draft) !== comparableContext(state.personalContext);
  const summary = completedSections === 0 ? "Не заполнен" : `${completedSections} из 5`;
  const hasAnyDraftData = [
    draft.goals,
    draft.rhythms,
    draft.preferences,
    draft.boundaries,
    draft.systemProfile.manifestations,
    draft.systemProfile.combinationNotes
  ].some((value) => value.trim().length > 0)
    || draft.systemProfile.selfDeclaredVectors.length > 0
    || draft.systemProfile.mode !== "off";

  const updateText = (field: "goals" | "rhythms" | "preferences" | "boundaries", value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const updateSystemProfile = (changes: Partial<PersonalContext["systemProfile"]>) => {
    setDraft((current) => ({
      ...current,
      systemProfile: { ...current.systemProfile, ...changes }
    }));
    setMessage("");
  };

  const toggleVector = (vectorId: SvpVectorId) => {
    const selected = draft.systemProfile.selfDeclaredVectors.includes(vectorId);
    const next = selected
      ? draft.systemProfile.selfDeclaredVectors.filter((id) => id !== vectorId)
      : vectorOptions.map((option) => option.id).filter((id) => (
          id === vectorId || draft.systemProfile.selfDeclaredVectors.includes(id)
        ));
    updateSystemProfile({ selfDeclaredVectors: next });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed) return;
    const patch: PersonalContextPatch = {
      goals: draft.goals.trim(),
      rhythms: draft.rhythms.trim(),
      preferences: draft.preferences.trim(),
      boundaries: draft.boundaries.trim(),
      systemProfile: {
        ...draft.systemProfile,
        manifestations: draft.systemProfile.manifestations.trim(),
        combinationNotes: draft.systemProfile.combinationNotes.trim()
      }
    };
    updatePersonalContext(patch);
    setMessage("Сохранено локально");
  };

  const cancel = () => {
    setDraft(cloneContext(state.personalContext));
    setMessage("Изменения отменены");
  };

  const clear = () => {
    if (!window.confirm("Очистить весь личный контекст? Это действие нельзя отменить.")) return;
    clearPersonalContext();
    setDraft(clearedContext(state.personalContext));
    setMessage("Личный контекст очищен");
  };

  return (
    <section className={`panel personal-context-panel${expanded ? " is-expanded" : ""}`} aria-label="Личный контекст">
      <button
        type="button"
        className="personal-context-summary"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="personal-context-icon" aria-hidden="true"><CircleUserRound size={24} /></span>
        <span className="personal-context-heading">
          <span className="eyebrow"><Sparkles size={12} /> Персонализация</span>
          <strong>Личный контекст</strong>
          <small>То, что помогает планировать и отвечать именно для вас</small>
        </span>
        <span className="personal-context-progress" aria-label={`Заполнено разделов: ${completedSections} из 5${changed ? "; есть несохранённые изменения" : ""}`}>
          <span className="personal-context-dots" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < completedSections ? "is-filled" : ""} />)}
          </span>
          <strong>{summary}</strong>
          {changed ? <small>Черновик</small> : null}
        </span>
        <ChevronDown className="personal-context-chevron" size={21} aria-hidden="true" />
      </button>

      {expanded ? (
        <form id={panelId} className="personal-context-form" onSubmit={save}>
          <div className="personal-context-intro">
            <div>
              <h3>Расскажите только то, что действительно полезно</h3>
              <p>Все поля необязательны. Черновик остаётся в этой форме до нажатия «Сохранить».</p>
            </div>
            <span><ShieldCheck size={17} /> Хранится локально</span>
          </div>

          <div className="personal-context-fields">
            <label>
              <span><strong>Цели и направления</strong><small>Чего вы хотите добиться или куда сейчас движетесь</small></span>
              <textarea
                value={draft.goals}
                onChange={(event) => updateText("goals", event.target.value)}
                placeholder="Например: закончить исследование, вернуть спокойный ритм…"
                rows={4}
              />
            </label>
            <label>
              <span><strong>Ритм и нагрузка</strong><small>Когда вам легче работать, отдыхать и переключаться</small></span>
              <textarea
                value={draft.rhythms}
                onChange={(event) => updateText("rhythms", event.target.value)}
                placeholder="Например: сложные задачи лучше утром, после встреч нужен перерыв…"
                rows={4}
              />
            </label>
            <label>
              <span><strong>Предпочтения</strong><small>Как удобнее получать планы, варианты и напоминания</small></span>
              <textarea
                value={draft.preferences}
                onChange={(event) => updateText("preferences", event.target.value)}
                placeholder="Например: предлагать один главный вариант, объяснять логику кратко…"
                rows={4}
              />
            </label>
            <label>
              <span><strong>Границы и ограничения</strong><small>Что важно учитывать и чего не следует предлагать</small></span>
              <textarea
                value={draft.boundaries}
                onChange={(event) => updateText("boundaries", event.target.value)}
                placeholder="Например: не ставить дела раньше 10:00, не перегружать вечер…"
                rows={4}
              />
            </label>
          </div>

          <section className="personal-system-profile" aria-labelledby={`${panelId}-system-title`}>
            <div className="personal-system-heading">
              <div>
                <span className="eyebrow">Опционально</span>
                <h3 id={`${panelId}-system-title`}>Системный профиль</h3>
                <p>Выберите, каким языком можно пользоваться в будущих подсказках и разборах.</p>
              </div>
              <Sparkles size={20} aria-hidden="true" />
            </div>

            <fieldset className="personal-language-modes">
              <legend>Режим языка</legend>
              <div>
                {languageModes.map((mode) => (
                  <label key={mode.id} className={draft.systemProfile.mode === mode.id ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name={`${panelId}-language-mode`}
                      value={mode.id}
                      checked={draft.systemProfile.mode === mode.id}
                      onChange={() => updateSystemProfile({ mode: mode.id })}
                    />
                    <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
                    {draft.systemProfile.mode === mode.id ? <Check size={16} aria-hidden="true" /> : null}
                  </label>
                ))}
              </div>
            </fieldset>

            {draft.systemProfile.mode !== "off" ? (
              <div className="personal-system-details">
                <fieldset className="personal-vector-picker">
                  <legend>Векторы, которые вы определили у себя</legend>
                  <p>Можно отметить несколько. Это ваше самоописание, а не результат диагностики.</p>
                  <div>
                    {vectorOptions.map((vector) => {
                      const selected = draft.systemProfile.selfDeclaredVectors.includes(vector.id);
                      return (
                        <label key={vector.id} className={selected ? "is-selected" : ""}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleVector(vector.id)}
                          />
                          {selected ? <Check size={14} aria-hidden="true" /> : null}
                          <span>{vector.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="personal-system-textareas">
                  <label>
                    <span><strong>Как это проявляется у вас</strong><small>Ваши наблюдения, желания, реакции и состояния</small></span>
                    <textarea
                      value={draft.systemProfile.manifestations}
                      onChange={(event) => updateSystemProfile({ manifestations: event.target.value })}
                      placeholder="Опишите своими словами — без необходимости раскладывать каждое желание по категориям"
                      rows={4}
                    />
                  </label>
                  <label>
                    <span><strong>Сочетания и отличия</strong><small>Что важно понимать именно в вашей комбинации</small></span>
                    <textarea
                      value={draft.systemProfile.combinationNotes}
                      onChange={(event) => updateSystemProfile({ combinationNotes: event.target.value })}
                      placeholder="Например: в каких ситуациях проявления различаются или дополняют друг друга"
                      rows={4}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="personal-context-safety-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <p><strong>Только введённое вами.</strong> Система не определяет векторы автоматически и не добавляет скрытых характеристик. Любое использование этого профиля должно быть явным и подтверждаемым.</p>
            </div>
          </section>

          <div className="personal-context-actions">
            <button type="submit" className="primary-button" disabled={!changed}>
              <Save size={17} /> Сохранить
            </button>
            <button type="button" className="secondary-button" onClick={cancel} disabled={!changed}>
              <RotateCcw size={16} /> Отменить изменения
            </button>
            <button
              type="button"
              className="personal-context-clear"
              onClick={clear}
              disabled={!hasAnyDraftData && !changed}
            >
              <Trash2 size={16} /> Очистить
            </button>
            <span className="personal-context-message" role="status" aria-live="polite">{message}</span>
          </div>
        </form>
      ) : null}
    </section>
  );
}
