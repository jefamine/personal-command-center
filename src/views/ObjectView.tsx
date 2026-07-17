import {
  ArrowRight,
  Boxes,
  FileText,
  Link2,
  Network,
  Plus,
  Save,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppLink } from "../components/AppLink";
import { EmptyState } from "../components/EmptyState";
import {
  buildObjectCatalog,
  objectBacklinks,
  objectChildren,
  parseLegacyObjectReference
} from "../domain/objects/legacyAdapter";
import {
  createTextBlock,
  type ObjectRelation,
  type UniversalObject,
  type UniversalObjectRole
} from "../domain/objects/objectGraph";
import { useAppNavigation } from "../navigation/NavigationContext";
import { useDashboard } from "../state/DashboardContext";

interface ObjectViewProps {
  objectId: string;
  onEditTask: (taskId: string) => void;
}

const roles: Array<{ value: UniversalObjectRole; label: string }> = [
  { value: "document", label: "Документ" },
  { value: "task", label: "Задача" },
  { value: "project", label: "Проект" },
  { value: "striving", label: "Стремление" },
  { value: "person", label: "Человек" },
  { value: "place", label: "Место" },
  { value: "event", label: "Событие" },
  { value: "material", label: "Материал" },
  { value: "collection", label: "Коллекция" }
];

const roleLabels = new Map(roles.map((role) => [role.value, role.label]));

function objectBody(object: UniversalObject): string {
  return object.blocks.filter((block) => ["text", "heading", "quote"].includes(block.type)).map((block) => block.text).join("\n\n");
}

export function hasSimpleEditableBody(object: UniversalObject): boolean {
  return object.source.kind === "native" &&
    object.blocks.length <= 1 &&
    object.blocks.every((block) => block.type === "text");
}

export function blocksAfterSimpleBodyEdit(object: UniversalObject, body: string) {
  if (!hasSimpleEditableBody(object)) return object.blocks;
  return object.blocks.length
    ? [{ ...object.blocks[0], text: body }]
    : [createTextBlock(body)];
}

export function ObjectView({ objectId, onEditTask }: ObjectViewProps) {
  const {
    state,
    addObject,
    updateObject,
    addObjectRelation,
    removeObjectRelation,
    updateTask,
    updateProject,
    updateLifeArea,
    updateEvent,
    updateNote
  } = useDashboard();
  const { navigate } = useAppNavigation();
  const catalog = useMemo(() => buildObjectCatalog(state), [state]);
  const object = catalog.byId.get(objectId) ?? null;
  const children = objectChildren(catalog, objectId);
  const backlinks = objectBacklinks(catalog, objectId);
  const outgoingLinks = catalog.relations.filter((relation) => relation.fromId === objectId && relation.kind === "links");
  const existingTargets = new Set(catalog.relations.filter((relation) => relation.fromId === objectId).map((relation) => relation.toId));
  const candidates = catalog.objects.filter((candidate) =>
    candidate.id !== objectId &&
    candidate.status !== "deleted" &&
    !existingTargets.has(candidate.id)
  ).slice(0, 250);
  const [title, setTitle] = useState(object?.title ?? "");
  const [body, setBody] = useState(object ? objectBody(object) : "");
  const [message, setMessage] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRole, setNewRole] = useState<UniversalObjectRole>("document");
  const [embedId, setEmbedId] = useState("");
  const [linkId, setLinkId] = useState("");

  useEffect(() => {
    setTitle(object?.title ?? "");
    setBody(object ? objectBody(object) : "");
    setMessage("");
  }, [object?.id, object?.revision, object?.updatedAt]);

  if (!object) {
    return (
      <div className="page object-page">
        <section className="panel object-missing">
          <Boxes size={30} />
          <h1>Объект не найден</h1>
          <p>Ссылка могла устареть, либо объект ещё не синхронизирован с этим устройством.</p>
          <AppLink className="primary-button" route={{ kind: "tool", tool: "workspace" }}>Открыть рабочее пространство</AppLink>
        </section>
      </div>
    );
  }

  const legacy = parseLegacyObjectReference(object.id);
  const readOnly = legacy?.type === "reading";
  const structuredBody = object.source.kind === "native" && !hasSimpleEditableBody(object);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || readOnly) return;
    try {
      if (object.source.kind === "native") {
        const blocks = blocksAfterSimpleBodyEdit(object, body);
        updateObject(object.id, object.revision, { title: title.trim(), blocks });
      } else if (legacy) {
        if (legacy.type === "task") updateTask(legacy.rawId, { title: title.trim(), notes: body });
        if (legacy.type === "project") updateProject(legacy.rawId, { title: title.trim(), description: body });
        if (legacy.type === "area") updateLifeArea(legacy.rawId, { title: title.trim(), description: body });
        if (legacy.type === "event") updateEvent(legacy.rawId, { title: title.trim(), notes: body });
        if (legacy.type === "note") updateNote(legacy.rawId, { title: title.trim(), body });
      }
      setMessage("Сохранено в единственном источнике данных.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить объект.");
    }
  };

  const createChild = (event: FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const child = addObject({
        title: newTitle,
        roles: [newRole],
        blocks: [createTextBlock("")]
      }, { parentId: object.id, kind: "contains" });
      setNewTitle("");
      navigate({ kind: "object", objectId: child.id }, { preserveTrail: true, label: child.title });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось создать вложенный объект.");
    }
  };

  const connectExisting = (kind: "embeds" | "links", targetId: string) => {
    if (!targetId) return;
    try {
      addObjectRelation({ kind, fromId: object.id, toId: targetId });
      if (kind === "embeds") setEmbedId("");
      else setLinkId("");
      setMessage(kind === "embeds" ? "Объект встроен без копирования." : "Ссылка добавлена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить связь.");
    }
  };

  const renderRelationCard = (relation: ObjectRelation, related: UniversalObject | null) => (
    <article className="object-relation-card" key={relation.id}>
      {related ? (
        <AppLink route={{ kind: "object", objectId: related.id }} navigation={{ preserveTrail: true, label: related.title }}>
          <span className="object-role-mark">{roleLabels.get(related.roles[0]) ?? related.roles[0]}</span>
          <div><strong>{related.title}</strong><small>{relation.kind === "contains" ? "Вложено" : relation.kind === "embeds" ? "Встроено" : "Связано"}</small></div>
          <ArrowRight size={16} />
        </AppLink>
      ) : <div className="object-missing-relation"><strong>Объект пока недоступен</strong><small>{relation.toId}</small></div>}
      {state.objectGraph.relations.some((entry) => entry.id === relation.id) ? (
        <button type="button" className="icon-button subtle" onClick={() => removeObjectRelation(relation.id)} aria-label="Убрать связь"><Trash2 size={15} /></button>
      ) : null}
    </article>
  );

  return (
    <div className="page object-page">
      <section className="object-hero">
        <div className="object-hero-icon"><Boxes size={24} /></div>
        <div>
          <span className="eyebrow">{object.roles.map((role) => roleLabels.get(role) ?? role).join(" · ")}</span>
          <h1>{object.title}</h1>
          <p>{object.source.kind === "legacy" ? "Совместимое представление существующих данных" : `Универсальный объект · ревизия ${object.revision}`}</p>
        </div>
        <div className="object-hero-meta"><span>{children.length} внутри</span><span>{backlinks.length} обратных связей</span></div>
      </section>

      <div className="object-layout">
        <form className="panel object-editor" onSubmit={save}>
          <div className="panel-heading"><div><span className="eyebrow">Содержание</span><h2>Единый объект</h2></div><FileText size={20} /></div>
          <label><span>Название</span><input value={title} onChange={(event) => setTitle(event.target.value)} disabled={readOnly} /></label>
          <label><span>Текст</span><textarea rows={14} value={body} onChange={(event) => setBody(event.target.value)} disabled={readOnly || structuredBody} placeholder="Пишите здесь. Позже этот редактор станет мультимодальным полотном." /></label>
          <div className="object-editor-actions">
            {legacy?.type === "task" ? <button type="button" className="secondary-button" onClick={() => onEditTask(legacy.rawId)}>Параметры задачи</button> : <span />}
            <button className="primary-button" disabled={readOnly || !title.trim()}><Save size={16} /> Сохранить</button>
          </div>
          {message ? <p className="object-message" role="status">{message}</p> : null}
          {readOnly ? <p className="object-readonly">Материал старого типа пока открыт для чтения. Его можно связать или встроить в другие объекты.</p> : null}
          {structuredBody ? <p className="object-readonly">Структура из нескольких блоков защищена от упрощённого редактирования. Сейчас можно переименовать объект; содержимое станет доступно в блочном редакторе.</p> : null}
        </form>

        <aside className="object-side">
          <section className="panel object-create-child">
            <div className="panel-heading"><div><span className="eyebrow">Фрактальная вложенность</span><h2>Создать внутри</h2></div><Plus size={20} /></div>
            <form onSubmit={createChild}>
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Название объекта" />
              <select value={newRole} onChange={(event) => setNewRole(event.target.value as UniversalObjectRole)}>
                {roles.map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}
              </select>
              <button className="primary-button" disabled={!newTitle.trim()}><Plus size={15} /> Создать</button>
            </form>
          </section>

          <section className="panel object-connect">
            <div className="panel-heading"><div><span className="eyebrow">Без дублирования</span><h2>Связать существующее</h2></div><Network size={20} /></div>
            <label><span>Встроить карточкой</span><div><select value={embedId} onChange={(event) => setEmbedId(event.target.value)}><option value="">Выберите объект</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><button type="button" onClick={() => connectExisting("embeds", embedId)} disabled={!embedId}>Встроить</button></div></label>
            <label><span>Добавить ссылку</span><div><select value={linkId} onChange={(event) => setLinkId(event.target.value)}><option value="">Выберите объект</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><button type="button" onClick={() => connectExisting("links", linkId)} disabled={!linkId}><Link2 size={14} /> Связать</button></div></label>
          </section>
        </aside>
      </div>

      <section className="panel object-children-section">
        <div className="panel-heading"><div><span className="eyebrow">Содержимое и встраивания</span><h2>Внутри объекта</h2></div><Boxes size={20} /></div>
        {children.length ? <div className="object-relation-grid">{children.map(({ relation, object: related }) => renderRelationCard(relation, related))}</div> : <EmptyState icon={Boxes} title="Вложений пока нет" text="Создайте новый объект внутри или встроите существующий без копирования." />}
      </section>

      {outgoingLinks.length ? (
        <section className="panel object-links-section">
          <div className="panel-heading"><div><span className="eyebrow">Граф</span><h2>Связанные объекты</h2></div><Link2 size={20} /></div>
          <div className="object-relation-grid">{outgoingLinks.map((relation) => renderRelationCard(relation, catalog.byId.get(relation.toId) ?? null))}</div>
        </section>
      ) : null}

      {backlinks.length ? (
        <section className="object-backlinks">
          <Sparkles size={16} />
          <span><strong>Обратные связи:</strong> этот объект используется ещё в {backlinks.length} {backlinks.length === 1 ? "месте" : "местах"}.</span>
        </section>
      ) : null}
    </div>
  );
}
