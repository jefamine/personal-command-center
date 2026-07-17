import { Archive, ArrowRight, Compass, FilePlus2, FolderKanban, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { AppLink } from "../components/AppLink";
import { EmptyState } from "../components/EmptyState";
import { buildObjectCatalog, legacyObjectReference, objectChildren } from "../domain/objects/legacyAdapter";
import { createTextBlock } from "../domain/objects/objectGraph";
import { useDashboard } from "../state/DashboardContext";
import { useAppNavigation } from "../navigation/NavigationContext";

interface SphereViewProps {
  sphereId: string;
}

export function SphereView({ sphereId }: SphereViewProps) {
  const { state, addObject } = useDashboard();
  const { navigate } = useAppNavigation();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const area = state.lifeAreas.find((entry) => entry.id === sphereId) ?? null;
  const catalog = useMemo(() => buildObjectCatalog(state), [state]);
  const sphereRef = legacyObjectReference("area", sphereId);
  const children = objectChildren(catalog, sphereRef);
  const projects = area ? state.projects.filter((project) => project.areaId === area.id) : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = state.tasks.filter((task) => task.projectId && projectIds.has(task.projectId) && task.status !== "done");
  const directObjects = children.filter(({ object }) => object && !object.roles.includes("project"));

  if (!area) {
    return (
      <div className="page sphere-page">
        <section className="panel sphere-missing">
          <Compass size={28} />
          <h1>Сфера не найдена</h1>
          <p>Она могла быть удалена или ссылка относится к другому устройству.</p>
          <AppLink className="primary-button" route={{ kind: "tool", tool: "sphere-manager" }}>Открыть управление сферами</AppLink>
        </section>
      </div>
    );
  }

  const createDocument = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const object = addObject({
      roles: ["document"],
      title,
      blocks: [createTextBlock("")]
    }, { parentId: sphereRef, kind: "contains" });
    setTitle("");
    setCreating(false);
    navigate({ kind: "object", objectId: object.id }, { preserveTrail: true, label: object.title });
  };

  return (
    <div className="page sphere-page" style={{ "--sphere-color": area.color } as React.CSSProperties}>
      <section className="sphere-hero">
        <div className="sphere-hero-mark"><Compass size={24} /></div>
        <div>
          <span className="eyebrow">Пользовательская сфера</span>
          <h1>{area.title}</h1>
          <p>{area.description || "Соберите здесь всё, что относится к этой стороне жизни."}</p>
        </div>
        <div className="sphere-hero-actions">
          {area.archived ? <span className="sphere-archive-badge"><Archive size={14} /> В архиве</span> : null}
          <button className="primary-button" type="button" onClick={() => setCreating((value) => !value)}><FilePlus2 size={17} /> Создать внутри</button>
          <AppLink className="secondary-button" route={{ kind: "tool", tool: "sphere-manager" }}>Настроить сферу</AppLink>
        </div>
      </section>

      {creating ? (
        <form className="panel sphere-quick-create" onSubmit={createDocument}>
          <div><Sparkles size={18} /><span><strong>Новый вложенный документ</strong><small>Он останется единым объектом и будет доступен в рабочем пространстве.</small></span></div>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название документа" />
          <button className="primary-button" disabled={!title.trim()}>Создать</button>
        </form>
      ) : null}

      <section className="sphere-metrics">
        <article><strong>{projects.length}</strong><span>проектов</span></article>
        <article><strong>{tasks.length}</strong><span>открытых действий</span></article>
        <article><strong>{directObjects.length}</strong><span>объектов внутри</span></article>
      </section>

      <div className="sphere-content-grid">
        <section className="panel sphere-section">
          <div className="panel-heading"><div><span className="eyebrow">Связанная деятельность</span><h2>Проекты</h2></div><FolderKanban size={20} /></div>
          {projects.length ? (
            <div className="sphere-object-list">
              {projects.map((project) => (
                <AppLink key={project.id} route={{ kind: "object", objectId: legacyObjectReference("project", project.id) }} navigation={{ preserveTrail: true, label: project.title }}>
                  <i style={{ background: project.color }} />
                  <span><strong>{project.title}</strong><small>{state.tasks.filter((task) => task.projectId === project.id && task.status !== "done").length} открытых действий</small></span>
                  <ArrowRight size={16} />
                </AppLink>
              ))}
            </div>
          ) : <EmptyState icon={FolderKanban} title="Проектов пока нет" text="Проекты, связанные с этой сферой, появятся здесь." />}
        </section>

        <section className="panel sphere-section">
          <div className="panel-heading"><div><span className="eyebrow">Фрактальная структура</span><h2>Внутри сферы</h2></div><Compass size={20} /></div>
          {directObjects.length ? (
            <div className="sphere-object-list">
              {directObjects.map(({ relation, object }) => object ? (
                <AppLink key={relation.id} route={{ kind: "object", objectId: object.id }} navigation={{ preserveTrail: true, label: object.title }}>
                  <span className="sphere-object-role">{object.roles[0]}</span>
                  <span><strong>{object.title}</strong><small>{relation.kind === "contains" ? "Вложенный объект" : "Встроенный объект"}</small></span>
                  <ArrowRight size={16} />
                </AppLink>
              ) : null)}
            </div>
          ) : <EmptyState icon={Compass} title="Здесь пока просторно" text="Создайте документ, материал или другой объект прямо внутри сферы." />}
        </section>
      </div>
    </div>
  );
}
