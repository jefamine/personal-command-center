import { ArrowRight, Inbox, Sparkles, Trash2 } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { useDashboard } from "../state/DashboardContext";

export function InboxView() {
  const { state, updateTask, removeTask } = useDashboard();
  const tasks = state.tasks.filter((task) => task.status === "inbox");

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Собрать → прояснить → решить</span>
          <h1>Входящие</h1>
          <p>Здесь ничего не нужно делать сразу. Сначала определите, что означает каждый пункт.</p>
        </div>
        <div className="heading-number"><strong>{tasks.length}</strong><span>на разбор</span></div>
      </section>

      <section className="panel inbox-workspace">
        {tasks.length ? (
          <div className="inbox-stack">
            {tasks.map((task) => (
              <article className="inbox-card" key={task.id}>
                <div className="inbox-card-icon"><Sparkles size={18} /></div>
                <div className="inbox-card-content">
                  <strong>{task.title}</strong>
                  {task.notes ? <p>{task.notes}</p> : <p>Что нужно сделать следующим физическим действием?</p>}
                  <div className="inbox-actions">
                    <button className="small-button primary-small" onClick={() => updateTask(task.id, { status: "next" })}>
                      Следующее действие <ArrowRight size={15} />
                    </button>
                    <button className="small-button" onClick={() => updateTask(task.id, { status: "planned" })}>
                      Запланировать
                    </button>
                    <button className="small-button" onClick={() => updateTask(task.id, { status: "someday" })}>
                      Когда-нибудь
                    </button>
                    <button className="icon-button danger-button" onClick={() => removeTask(task.id)} aria-label="Удалить">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={Inbox} title="Входящие разобраны" text="Отличное состояние: ни один пункт не висит без решения." />
        )}
      </section>
    </div>
  );
}

