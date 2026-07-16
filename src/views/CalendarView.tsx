import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LockKeyhole,
  Plus,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  addDays,
  dateHeading,
  formatTime,
  localDateKey,
  minutesFromDateTime,
  parseTime
} from "../lib/date";
import { buildDailyPlan, getFreeIntervals } from "../lib/planner";
import { useDashboard } from "../state/DashboardContext";
import type { CalendarEventKind } from "../types";

const kindLabels: Record<CalendarEventKind, string> = {
  meeting: "Встреча",
  focus: "Фокус",
  personal: "Личное",
  break: "Перерыв"
};

export function CalendarView() {
  const { state, addEvent, removeEvent, confirmPlan } = useDashboard();
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [kind, setKind] = useState<CalendarEventKind>("meeting");
  const [formError, setFormError] = useState("");

  const events = useMemo(
    () =>
      state.events
        .filter((event) => event.startAt.startsWith(selectedDate))
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [selectedDate, state.events]
  );
  const plan = useMemo(
    () => buildDailyPlan(state.tasks, state.settings, selectedDate, state.events),
    [selectedDate, state.events, state.settings, state.tasks]
  );
  const suggestions = plan.filter((item) => !item.confirmed);
  const freeIntervals = useMemo(
    () => getFreeIntervals(state.settings, events, selectedDate),
    [events, selectedDate, state.settings]
  );

  const workStart = parseTime(state.settings.workdayStart);
  const workEnd = parseTime(state.settings.workdayEnd);
  const gridStart = Math.min(8 * 60, Math.floor(workStart / 60) * 60);
  const gridEnd = Math.max(20 * 60, Math.ceil(workEnd / 60) * 60);
  const gridDuration = gridEnd - gridStart;
  const hours = Array.from(
    { length: (gridEnd - gridStart) / 60 + 1 },
    (_, index) => gridStart / 60 + index
  );

  const submitEvent = (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!title.trim()) {
      setFormError("Введите название блока.");
      return;
    }
    if (parseTime(endTime) <= parseTime(startTime)) {
      setFormError("Конец должен быть позже начала.");
      return;
    }
    addEvent({
      title,
      startAt: `${selectedDate}T${startTime}`,
      endAt: `${selectedDate}T${endTime}`,
      kind,
      source: "local",
      locked: true
    });
    setTitle("");
    setCreating(false);
  };

  const remove = (eventId: string) => {
    if (window.confirm("Удалить календарный блок?")) removeEvent(eventId);
  };

  const blockStyle = (start: number, end: number) => ({
    top: `${((Math.max(start, gridStart) - gridStart) / gridDuration) * 100}%`,
    height: `${Math.max(3.8, ((Math.min(end, gridEnd) - Math.max(start, gridStart)) / gridDuration) * 100)}%`
  });

  return (
    <div className="page calendar-page">
      <section className="page-heading calendar-heading">
        <div>
          <span className="eyebrow">Время как ограниченный ресурс</span>
          <h1>Календарь</h1>
          <p>Фиксированные события задают границы, а оптимизатор предлагает задачи только в действительно свободные окна.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Добавить блок</button>
      </section>

      <div className="calendar-toolbar panel">
        <div className="date-navigation">
          <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="Предыдущий день"><ChevronLeft size={19} /></button>
          <button className="date-title" onClick={() => setSelectedDate(localDateKey())}>
            <strong>{dateHeading(selectedDate)}</strong>
            <span>{selectedDate === localDateKey() ? "Сегодня" : "Вернуться к сегодня"}</span>
          </button>
          <button className="icon-button" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="Следующий день"><ChevronRight size={19} /></button>
        </div>
        <div className="calendar-legend">
          <span><i className="legend-event" /> Событие</span>
          <span><i className="legend-focus" /> Закреплённый фокус</span>
          <span><i className="legend-suggestion" /> Предложение</span>
        </div>
      </div>

      {creating ? (
        <form className="event-form panel" onSubmit={submitEvent}>
          <div className="event-form-heading"><div><span className="eyebrow">Локальный календарь</span><h2>Новый блок</h2></div><button className="icon-button" type="button" onClick={() => setCreating(false)}><X size={19} /></button></div>
          <label className="event-title-input"><span>Название</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Встреча, дорога, личное дело…" /></label>
          <div className="event-form-grid">
            <label><span>Начало</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label><span>Конец</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            <label><span>Тип</span><select value={kind} onChange={(event) => setKind(event.target.value as CalendarEventKind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button className="primary-button" type="submit">Сохранить блок</button>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
        </form>
      ) : null}

      <div className="calendar-layout">
        <section className="panel day-calendar">
          <div className="day-grid" style={{ height: `${(gridDuration / 60) * 64}px` }}>
            {hours.map((hour) => (
              <div className="hour-line" key={hour} style={{ top: `${(((hour * 60) - gridStart) / gridDuration) * 100}%` }}>
                <time>{String(hour).padStart(2, "0")}:00</time><i />
              </div>
            ))}
            <div className="calendar-blocks">
              {events.map((event) => {
                const start = minutesFromDateTime(event.startAt);
                const end = minutesFromDateTime(event.endAt);
                if (end <= gridStart || start >= gridEnd) return null;
                return (
                  <article className={`calendar-block event-kind-${event.kind}`} style={blockStyle(start, end)} key={event.id}>
                    <div><strong>{event.title}</strong><span>{formatTime(start)}–{formatTime(end)} · {kindLabels[event.kind]}</span></div>
                    {event.locked ? <LockKeyhole size={14} /> : null}
                  </article>
                );
              })}
              {suggestions.map((item) => (
                <article className="calendar-block event-kind-suggestion" style={blockStyle(item.startMinutes, item.endMinutes)} key={`suggestion-${item.task.id}`}>
                  <div><strong>{item.task.title}</strong><span>{formatTime(item.startMinutes)}–{formatTime(item.endMinutes)} · предложение</span></div>
                  <Sparkles size={14} />
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="calendar-side">
          <section className="panel plan-decision-card">
            <div className="side-section-heading"><div><span className="eyebrow">Оптимизатор</span><h2>План на день</h2></div><Sparkles size={21} /></div>
            {suggestions.length ? (
              <>
                <p>Найдено {suggestions.length} задач, которые помещаются между обязательствами.</p>
                <div className="suggestion-list">
                  {suggestions.slice(0, 4).map((item) => (
                    <div key={item.task.id}><time>{formatTime(item.startMinutes)}</time><span>{item.task.title}</span><small>{item.task.estimateMinutes} мин</small></div>
                  ))}
                </div>
                <button className="primary-button full-button" onClick={() => confirmPlan(plan, selectedDate)}>Закрепить предложенный план</button>
              </>
            ) : (
              <div className="calendar-empty"><CalendarDays size={25} /><strong>{plan.length ? "План уже закреплён" : "Нет доступных предложений"}</strong><span>{plan.length ? "Фокус-блоки защищены от перестановки." : "Добавьте следующие задачи или увеличьте доступное время."}</span></div>
            )}
          </section>

          <section className="panel free-time-card">
            <div className="side-section-heading"><div><span className="eyebrow">После буферов</span><h2>Свободные окна</h2></div><Clock3 size={20} /></div>
            <div className="free-window-list">
              {freeIntervals.filter((interval) => interval.endMinutes - interval.startMinutes >= 15).map((interval) => (
                <div key={`${interval.startMinutes}-${interval.endMinutes}`}><strong>{formatTime(interval.startMinutes)}–{formatTime(interval.endMinutes)}</strong><span>{interval.endMinutes - interval.startMinutes} минут</span></div>
              ))}
            </div>
          </section>

          {events.length ? (
            <section className="panel event-list-card">
              <div className="side-section-heading"><div><span className="eyebrow">Зафиксировано</span><h2>События</h2></div></div>
              {events.map((event) => (
                <div className="calendar-event-row" key={event.id}>
                  <i className={`event-dot event-kind-${event.kind}`} />
                  <div><strong>{event.title}</strong><span>{event.startAt.slice(11, 16)}–{event.endAt.slice(11, 16)}</span></div>
                  <button className="icon-button danger-button" onClick={() => remove(event.id)} aria-label="Удалить блок"><Trash2 size={16} /></button>
                </div>
              ))}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
