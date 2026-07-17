import { ArrowRight, FilePlus2, FileText, Search, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { AppLink } from "../components/AppLink";
import { EmptyState } from "../components/EmptyState";
import { buildObjectCatalog } from "../domain/objects/legacyAdapter";
import { createTextBlock } from "../domain/objects/objectGraph";
import { useDashboard } from "../state/DashboardContext";
import { useAppNavigation } from "../navigation/NavigationContext";

export function WorkspaceView() {
  const { state, addObject } = useDashboard();
  const { navigate } = useAppNavigation();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const catalog = useMemo(() => buildObjectCatalog(state), [state]);
  const documents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return catalog.objects
      .filter((object) =>
        object.roles.includes("document") &&
        !["archived", "deleted"].includes(object.status) &&
        (!normalized || `${object.title} ${object.blocks.map((block) => block.text).join(" ")}`.toLocaleLowerCase("ru").includes(normalized))
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [catalog.objects, query]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const object = addObject({ roles: ["document"], title, blocks: [createTextBlock("")] });
    setTitle("");
    setCreating(false);
    navigate({ kind: "object", objectId: object.id }, { preserveTrail: true, label: object.title });
  };

  return (
    <div className="page workspace-page">
      <section className="page-heading workspace-heading">
        <div>
          <span className="eyebrow">Единая база текстов и материалов</span>
          <h1>Рабочее пространство</h1>
          <p>Короткие заметки, статьи и личные записи используют один документ. Связи и встраивания не создают копий.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating((value) => !value)}><FilePlus2 size={18} /> Новый документ</button>
      </section>

      <section className="workspace-toolbar">
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по рабочему пространству" /></label>
        <span><Sparkles size={15} /> {documents.length} документов · Markdown и Obsidian совместимость</span>
      </section>

      {creating ? (
        <form className="panel workspace-create" onSubmit={create}>
          <FileText size={22} />
          <label><span>Название</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Можно изменить позднее" /></label>
          <button className="primary-button" disabled={!title.trim()}>Создать и открыть</button>
        </form>
      ) : null}

      {documents.length ? (
        <section className="workspace-document-grid">
          {documents.map((object) => (
            <AppLink key={object.id} route={{ kind: "object", objectId: object.id }} navigation={{ preserveTrail: true, label: object.title }}>
              <span className="workspace-document-icon"><FileText size={20} /></span>
              <div>
                <small>{object.source.kind === "legacy" ? "Существующий документ" : "Универсальный документ"}</small>
                <strong>{object.title}</strong>
                <p>{object.blocks.map((block) => block.text).filter(Boolean).join(" ").slice(0, 150) || "Пустой документ"}</p>
              </div>
              <ArrowRight size={17} />
            </AppLink>
          ))}
        </section>
      ) : <section className="panel"><EmptyState icon={FileText} title="Документов не найдено" text="Создайте первый документ или измените поисковый запрос." /></section>}
    </div>
  );
}
