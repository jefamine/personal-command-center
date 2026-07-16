import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  Target
} from "lucide-react";
import { useMemo } from "react";
import { addDays, localDateKey } from "../lib/date";
import { useDashboard } from "../state/DashboardContext";

export function InsightsView() {
  const { state } = useDashboard();
  const today = localDateKey();
  const open = state.tasks.filter((task) => task.status !== "done");
  const overdue = open.filter((task) => task.dueDate && task.dueDate < today);
  const completedThisWeek = state.tasks.filter(
    (task) => task.completedAt && localDateKey(new Date(task.completedAt)) >= addDays(today, -6)
  );
  const plannedMinutes = open
    .filter((task) => task.scheduledDate === today)
    .reduce((sum, task) => sum + task.estimateMinutes, 0);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index - 6);
        const count = state.tasks.filter(
          (task) => task.completedAt && localDateKey(new Date(task.completedAt)) === date
        ).length;
        const label = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
        return { date, count, label };
      }),
    [state.tasks, today]
  );
  const maxCompleted = Math.max(1, ...days.map((day) => day.count));

  const projectWorkload = state.projects
    .map((project) => ({
      project,
      minutes: open.filter((task) => task.projectId === project.id).reduce((sum, task) => sum + task.estimateMinutes, 0),
      count: open.filter((task) => task.projectId === project.id).length
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const maxProjectMinutes = Math.max(1, ...projectWorkload.map((entry) => entry.minutes));

  const energy = (["high", "medium", "low"] as const).map((level) => ({
    level,
    count: open.filter((task) => task.energy === level).length
  }));
  const totalEnergyTasks = Math.max(1, energy.reduce((sum, entry) => sum + entry.count, 0));

  return (
    <div className="page insights-page">
      <section className="page-heading">
        <div><span className="eyebrow">Не контроль, а обратная связь</span><h1>Аналитика</h1><p>Нагрузка, завершения и риски — чтобы план становился реалистичнее с каждой неделей.</p></div>
      </section>

      <section className="insight-stat-grid">
        <article><div className="insight-icon green"><CheckCircle2 size={20} /></div><span>Завершено за 7 дней</span><strong>{completedThisWeek.length}</strong><small>задач</small></article>
        <article><div className="insight-icon violet"><Clock3 size={20} /></div><span>Фокус сегодня</span><strong>{Math.round(plannedMinutes / 60 * 10) / 10}</strong><small>часа</small></article>
        <article><div className="insight-icon orange"><AlertTriangle size={20} /></div><span>Просрочено</span><strong>{overdue.length}</strong><small>{overdue.length ? "требуют решения" : "сроки чисты"}</small></article>
        <article><div className="insight-icon blue"><Target size={20} /></div><span>Активные проекты</span><strong>{state.projects.filter((project) => project.status === "active").length}</strong><small>направлений</small></article>
      </section>

      <div className="insights-layout">
        <section className="panel completion-chart-card">
          <div className="panel-heading"><div><span className="eyebrow">Ритм завершений</span><h2>Последние семь дней</h2></div><BarChart3 size={21} /></div>
          <div className="completion-chart">
            {days.map((day) => (
              <div className="chart-column" key={day.date}>
                <div className="chart-value"><span>{day.count || ""}</span><i style={{ height: `${Math.max(4, (day.count / maxCompleted) * 100)}%` }} /></div>
                <small>{day.label}</small>
              </div>
            ))}
          </div>
          <p>График строится только по локальной истории завершения задач.</p>
        </section>

        <section className="panel energy-card">
          <div className="panel-heading"><div><span className="eyebrow">Требования задач</span><h2>Энергия</h2></div><Gauge size={21} /></div>
          <div className="energy-donut" style={{
            "--high": `${(energy[0].count / totalEnergyTasks) * 360}deg`,
            "--medium": `${((energy[0].count + energy[1].count) / totalEnergyTasks) * 360}deg`
          } as React.CSSProperties}><div><strong>{open.length}</strong><span>открыто</span></div></div>
          <div className="energy-legend"><span><i className="high" /> Высокая <strong>{energy[0].count}</strong></span><span><i className="medium" /> Средняя <strong>{energy[1].count}</strong></span><span><i className="low" /> Низкая <strong>{energy[2].count}</strong></span></div>
        </section>

        <section className="panel workload-card">
          <div className="panel-heading"><div><span className="eyebrow">Оставшийся объём</span><h2>Нагрузка по проектам</h2></div><Activity size={21} /></div>
          {projectWorkload.length ? <div className="workload-list">{projectWorkload.map(({ project, minutes, count }) => (
            <div key={project.id}><div><i style={{ background: project.color }} /><strong>{project.title}</strong><span>{count} задач · {minutes} мин</span></div><div className="progress-track"><i style={{ width: `${(minutes / maxProjectMinutes) * 100}%`, background: project.color }} /></div></div>
          ))}</div> : <p className="insight-empty">Нет открытой проектной нагрузки.</p>}
        </section>

        <section className="panel system-health-card">
          <div className="panel-heading"><div><span className="eyebrow">Качество системы</span><h2>Следующее улучшение</h2></div><Gauge size={21} /></div>
          <div className="health-score"><strong>{Math.max(0, 100 - overdue.length * 8 - state.tasks.filter((task) => task.status === "inbox").length * 4)}%</strong><span>ясности</span></div>
          <p>{state.tasks.some((task) => task.status === "inbox") ? "Разберите входящие — это быстрее всего повысит доверие к плану." : overdue.length ? "Пересмотрите просроченные сроки и отмените неактуальное." : "Система в хорошем состоянии. Сохраните еженедельный обзор."}</p>
        </section>
      </div>
    </div>
  );
}
