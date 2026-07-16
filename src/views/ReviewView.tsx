import { ArrowRight, CheckCircle2, ClipboardCheck, Inbox, ListChecks } from "lucide-react";
import { useDashboard } from "../state/DashboardContext";
import type { ViewId } from "../types";

interface ReviewViewProps {
  onNavigate: (view: ViewId) => void;
}

export function ReviewView({ onNavigate }: ReviewViewProps) {
  const { state } = useDashboard();
  const inbox = state.tasks.filter((task) => task.status === "inbox").length;
  const withoutProject = state.tasks.filter(
    (task) => task.status !== "done" && task.status !== "inbox" && !task.projectId
  ).length;
  const projectsWithoutNext = state.projects.filter(
    (project) =>
      project.status === "active" &&
      !state.tasks.some((task) => task.projectId === project.id && task.status === "next")
  ).length;

  const steps = [
    { icon: Inbox, title: "Разобрать входящие", count: inbox, text: "У каждого пункта должно появиться решение.", view: "inbox" as ViewId },
    { icon: ListChecks, title: "Уточнить одиночные задачи", count: withoutProject, text: "Проверить сроки, контекст и длительность.", view: "tasks" as ViewId },
    { icon: ClipboardCheck, title: "Проверить проекты", count: projectsWithoutNext, text: "У активного проекта должен быть следующий шаг.", view: "projects" as ViewId }
  ];

  return (
    <div className="page">
      <section className="page-heading">
        <div><span className="eyebrow">Вернуть системе доверие</span><h1>Еженедельный обзор</h1><p>Короткая последовательность проверок, после которой списки снова соответствуют реальности.</p></div>
      </section>
      <section className="review-grid">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const complete = step.count === 0;
          return (
            <article className={`review-step ${complete ? "complete" : ""}`} key={step.title}>
              <div className="review-index">{complete ? <CheckCircle2 size={21} /> : index + 1}</div>
              <div className="review-step-icon"><Icon size={23} /></div>
              <div className="review-step-copy"><h2>{step.title}</h2><p>{step.text}</p><span>{complete ? "Порядок" : `${step.count} требуют внимания`}</span></div>
              <button className="icon-button" onClick={() => onNavigate(step.view)}><ArrowRight size={19} /></button>
            </article>
          );
        })}
      </section>
      <section className="panel review-summary">
        <div><span className="eyebrow">Состояние системы</span><h2>{steps.every((step) => step.count === 0) ? "Всё готово к новой неделе" : "Осталось вернуть ясность"}</h2></div>
        <div className="review-score"><strong>{steps.filter((step) => step.count === 0).length}/3</strong><span>проверок пройдено</span></div>
      </section>
    </div>
  );
}
