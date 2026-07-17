import { describe, expect, it } from "vitest";
import {
  ObjectGraphError,
  addObjectRelation,
  addUniversalObject,
  childRelations,
  createEmptyObjectGraph,
  createTextBlock,
  createUniversalObject,
  normalizeObjectGraph,
  patchUniversalObject
} from "./objectGraph";

const now = "2026-07-17T00:00:00.000Z";

describe("универсальное объектное ядро", () => {
  it("создаёт объекты разных ролей и фрактальную вложенность", () => {
    const task = createUniversalObject({ id: "task", roles: ["task"], title: "Задача" }, { now });
    const document = createUniversalObject({
      id: "document",
      roles: ["document", "material"],
      title: "Материал",
      blocks: [createTextBlock("Текст", "block")]
    }, { now });
    let graph = addUniversalObject(createEmptyObjectGraph(), task);
    graph = addUniversalObject(graph, document);
    graph = addObjectRelation(graph, {
      id: "relation",
      kind: "contains",
      fromId: task.id,
      toId: document.id
    }, { now });

    expect(childRelations(graph, task.id)).toEqual([
      expect.objectContaining({ fromId: "task", toId: "document", kind: "contains" })
    ]);
    expect(graph.objects.find((entry) => entry.id === "document")?.roles).toEqual(["document", "material"]);
  });

  it("не допускает второго структурного родителя и циклов вложенности", () => {
    let graph = createEmptyObjectGraph();
    for (const id of ["a", "b", "c"]) {
      graph = addUniversalObject(graph, createUniversalObject({ id, title: id }, { now }));
    }
    graph = addObjectRelation(graph, { id: "a-b", kind: "contains", fromId: "a", toId: "b" }, { now });
    graph = addObjectRelation(graph, { id: "b-c", kind: "contains", fromId: "b", toId: "c" }, { now });

    try {
      addObjectRelation(graph, { id: "a-c", kind: "contains", fromId: "a", toId: "c" }, { now });
      throw new Error("Ожидалась ошибка второго родителя.");
    } catch (error) {
      expect(error).toBeInstanceOf(ObjectGraphError);
      expect((error as ObjectGraphError).code).toBe("already_has_parent");
    }
    try {
      addObjectRelation(graph, { id: "c-a", kind: "contains", fromId: "c", toId: "a" }, { now });
      throw new Error("Ожидалась ошибка цикла.");
    } catch (error) {
      expect(error).toBeInstanceOf(ObjectGraphError);
      expect((error as ObjectGraphError).code).toBe("containment_cycle");
    }
  });

  it("разрешает многократные встраивания и циклические обычные ссылки", () => {
    let graph = createEmptyObjectGraph();
    for (const id of ["area-a", "area-b", "doc", "person"]) {
      graph = addUniversalObject(graph, createUniversalObject({ id, title: id }, { now }));
    }
    graph = addObjectRelation(graph, { id: "embed-a", kind: "embeds", fromId: "area-a", toId: "doc" }, { now });
    graph = addObjectRelation(graph, { id: "embed-b", kind: "embeds", fromId: "area-b", toId: "doc" }, { now });
    graph = addObjectRelation(graph, { id: "link-a", kind: "links", fromId: "doc", toId: "person" }, { now });
    graph = addObjectRelation(graph, { id: "link-b", kind: "links", fromId: "person", toId: "doc" }, { now });

    expect(graph.relations).toHaveLength(4);
  });

  it("обновляет объект версионно и мягко архивирует его", () => {
    const object = createUniversalObject({ id: "doc", title: "Черновик" }, { now });
    let graph = addUniversalObject(createEmptyObjectGraph(), object);
    graph = patchUniversalObject(graph, "doc", { title: "Текст", status: "archived" }, {
      now: "2026-07-17T01:00:00.000Z",
      expectedRevision: 1
    });

    expect(graph.objects[0]).toMatchObject({
      title: "Текст",
      status: "archived",
      revision: 2,
      archivedAt: "2026-07-17T01:00:00.000Z"
    });
  });

  it("не отбрасывает повреждённые объекты и связи молча", () => {
    const valid = createUniversalObject({ id: "one", title: "Один" }, { now });
    expect(normalizeObjectGraph({
      schemaVersion: 1,
      objects: [valid],
      relations: []
    })).toEqual({ schemaVersion: 1, objects: [valid], relations: [] });

    expect(() => normalizeObjectGraph({
      schemaVersion: 1,
      objects: [valid, createUniversalObject({ id: "one", title: "Дубликат" }, { now })],
      relations: []
    })).toThrowError(expect.objectContaining({ code: "invalid_object" }));

    expect(() => normalizeObjectGraph({
      schemaVersion: 1,
      objects: [valid],
      relations: [
        { id: "self", kind: "contains", fromId: "one", toId: "one", order: 0, createdAt: now }
      ]
    })).toThrowError(expect.objectContaining({ code: "invalid_relation" }));
  });

  it("отклоняет неизвестную схему и устаревшую ревизию", () => {
    expect(() => normalizeObjectGraph({ schemaVersion: 2, objects: [], relations: [] }))
      .toThrowError(expect.objectContaining({ code: "unsupported_schema" }));

    const object = createUniversalObject({ id: "doc", title: "Версия" }, { now });
    const graph = addUniversalObject(createEmptyObjectGraph(), object);
    expect(() => patchUniversalObject(graph, "doc", { title: "Старая запись" }, {
      expectedRevision: 2,
      now
    })).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("проверяет сгенерированные идентификаторы и не допускает скрытых коллизий", () => {
    expect(() => createUniversalObject({ id: "", title: "Без id" }, { now }))
      .toThrowError(expect.objectContaining({ code: "invalid_object" }));

    let graph = createEmptyObjectGraph();
    graph = addUniversalObject(graph, createUniversalObject({ id: "a", title: "A" }, { now }));
    graph = addUniversalObject(graph, createUniversalObject({ id: "b", title: "B" }, { now }));
    graph = addObjectRelation(graph, {
      id: "existing-id",
      kind: "links",
      fromId: "a",
      toId: "b"
    }, { now });

    expect(() => addObjectRelation(graph, {
      kind: "embeds",
      fromId: "a",
      toId: "b"
    }, { now, idFactory: () => "existing-id" }))
      .toThrowError(expect.objectContaining({ code: "duplicate_relation_id" }));
  });
});
