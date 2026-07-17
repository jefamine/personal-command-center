import { describe, expect, it } from "vitest";
import { createInitialState } from "../../data/seed";
import { addObjectRelation, addUniversalObject, createUniversalObject } from "./objectGraph";
import {
  adaptLegacyObjects,
  buildObjectCatalog,
  legacyObjectReference,
  objectBacklinks,
  objectChildren,
  parseLegacyObjectReference
} from "./legacyAdapter";

describe("адаптер старых данных", () => {
  it("строит детерминированные проекции и не изменяет исходное состояние", () => {
    const state = createInitialState();
    const before = JSON.stringify(state);
    const first = adaptLegacyObjects(state);
    const second = adaptLegacyObjects(state);

    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
    expect(first.objects.some((object) => object.roles.includes("task"))).toBe(true);
  });

  it("разводит одинаковые исходные идентификаторы пространствами имён", () => {
    const state = createInitialState();
    const rawId = state.tasks[0].id;
    state.notes.push({
      id: rawId,
      title: "Заметка",
      body: "Текст",
      projectId: null,
      tags: [],
      pinned: false,
      contentUpdatedAt: state.updatedAt,
      reflection: null,
      createdAt: state.updatedAt,
      updatedAt: state.updatedAt
    });
    const catalog = buildObjectCatalog(state);

    expect(catalog.byId.has(legacyObjectReference("task", rawId))).toBe(true);
    expect(catalog.byId.has(legacyObjectReference("note", rawId))).toBe(true);
    expect(legacyObjectReference("task", rawId)).not.toBe(legacyObjectReference("note", rawId));
  });

  it("связывает нативный документ с существующей задачей без копии задачи", () => {
    const state = createInitialState();
    const taskRef = legacyObjectReference("task", state.tasks[0].id);
    const document = createUniversalObject({ id: "native-document", roles: ["document"], title: "Вложенный текст" }, {
      now: state.updatedAt
    });
    state.objectGraph = addUniversalObject(state.objectGraph, document);
    state.objectGraph = addObjectRelation(state.objectGraph, {
      id: "native-relation",
      kind: "contains",
      fromId: taskRef,
      toId: document.id
    }, { now: state.updatedAt });

    const catalog = buildObjectCatalog(state);
    expect(objectChildren(catalog, taskRef)).toEqual([
      expect.objectContaining({ object: expect.objectContaining({ id: "native-document" }) })
    ]);
    expect(objectBacklinks(catalog, document.id)).toEqual([
      expect.objectContaining({ id: "native-relation", fromId: taskRef })
    ]);
    expect(state.objectGraph.objects.some((object) => object.id === taskRef)).toBe(false);
  });

  it("кодирует и восстанавливает специальные символы идентификатора", () => {
    const reference = legacyObjectReference("task", "задача/1: тест");
    expect(parseLegacyObjectReference(reference)).toEqual({ type: "task", rawId: "задача/1: тест" });
  });
});
