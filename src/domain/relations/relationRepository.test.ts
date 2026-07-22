import { describe, expect, it } from "vitest";
import { createInitialState } from "../../data/seed";
import type { DashboardState, Note, ReadingItem } from "../../types";
import { materialDocumentId, noteDocumentId } from "../documents/documentContract";
import { addUniversalObject, createUniversalObject, type ObjectRelation } from "../objects/objectGraph";
import {
  addRelationToState,
  captureRelationsForDeletion,
  liveRelationEndpointIds,
  purgeRelationsForEndpoints,
  restoreCapturedRelations,
  retryPendingRelations
} from "./relationRepository";

const now = "2026-07-22T09:00:00.000Z";

function note(id: string, title = id): Note {
  return {
    id, title, body: "", projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
}

function material(id: string): ReadingItem {
  return { id, title: id, summary: "", body: "", url: "", source: "", tags: [], createdAt: now };
}

function stateFixture(): DashboardState {
  const state = createInitialState();
  state.notes = [note("note-a"), note("note-b")];
  state.readingItems = [material("material")];
  state.objectGraph = addUniversalObject(
    addUniversalObject(state.objectGraph, createUniversalObject({ id: "native-a", roles: ["document"], title: "A" }, { now })),
    createUniversalObject({ id: "native-b", roles: ["document"], title: "B" }, { now })
  );
  return state;
}

function add(state: DashboardState, id: string, fromId: string, toId: string) {
  return addRelationToState(state, { id, kind: "links", fromId, toId }, { now });
}

describe("mixed relation application boundary", () => {
  it.each([
    ["native → native", "native-a", "native-b"],
    ["native → Note", "native-a", noteDocumentId("note-a")],
    ["Note → native", noteDocumentId("note-a"), "native-a"],
    ["Note → Note", noteDocumentId("note-a"), noteDocumentId("note-b")],
    ["material endpoint", "native-a", materialDocumentId("material")]
  ])("accepts a real %s relation", (_label, fromId, toId) => {
    expect(add(stateFixture(), "relation", fromId, toId).result.status).toBe("accepted");
  });

  it.each([
    ["fake legacy", "native-a", "legacy:v12:note:not-real"],
    ["missing native", "native-a", "missing-native"],
    ["damaged legacy", "native-a", "legacy:v12:note:%E0%A4%A"],
  ])("rejects %s endpoint", (_label, fromId, toId) => {
    expect(add(stateFixture(), "relation", fromId, toId).result).toMatchObject({
      status: "rejected", code: "missing_endpoint"
    });
  });

  it("rejects a deleted native endpoint and a self relation", () => {
    const state = stateFixture();
    state.objectGraph.objects = state.objectGraph.objects.map((object) =>
      object.id === "native-b" ? { ...object, status: "deleted", deletedAt: now } : object
    );
    expect(add(state, "deleted", "native-a", "native-b").result.status).toBe("rejected");
    expect(add(state, "self", "native-a", "native-a").result.status).toBe("rejected");
  });

  it("does not create a duplicate persisted relation", () => {
    const first = add(stateFixture(), "first", "native-a", "native-b");
    if (first.result.status !== "accepted") throw new Error("fixture failed");
    expect(add(first.state, "second", "native-a", "native-b").result).toMatchObject({
      status: "rejected", code: "duplicate_relation"
    });
  });

  it("resolves endpoints only from the actual combined live catalog", () => {
    const ids = liveRelationEndpointIds(stateFixture());
    expect(ids.has("native-a")).toBe(true);
    expect(ids.has(noteDocumentId("note-a"))).toBe(true);
    expect(ids.has(materialDocumentId("material"))).toBe(true);
    expect(ids.has("legacy:v12:note:not-real")).toBe(false);
  });
});

describe("atomic relation deletion and recovery", () => {
  function mixedState() {
    let state = stateFixture();
    for (const [id, fromId, toId] of [
      ["incoming", "native-a", noteDocumentId("note-a")],
      ["outgoing", noteDocumentId("note-a"), "native-b"]
    ] as const) {
      const result = add(state, id, fromId, toId);
      if (result.result.status !== "accepted") throw new Error("fixture failed");
      state = result.state;
    }
    return state;
  }

  it("captures incoming and outgoing Note relations and leaves no dangling live relation", () => {
    const captured = captureRelationsForDeletion(mixedState(), noteDocumentId("note-a"));
    expect(captured.relations.map((relation) => relation.id).sort()).toEqual(["incoming", "outgoing"]);
    expect(captured.state.objectGraph.relations).toEqual([]);
  });

  it("captures mixed relations of a native document without computed legacy relations", () => {
    const state = mixedState();
    const captured = captureRelationsForDeletion(state, "native-a");
    expect(captured.relations.map((relation) => relation.id)).toEqual(["incoming"]);
    expect(captured.relations.every((relation) => !relation.id.startsWith("legacy:relation:"))).toBe(true);
  });

  it("deleting a target relation snapshot does not delete its source object", () => {
    const captured = captureRelationsForDeletion(mixedState(), noteDocumentId("note-a"));
    expect(captured.state.objectGraph.objects.some((object) => object.id === "native-a")).toBe(true);
    expect(captured.state.objectGraph.objects.some((object) => object.id === "native-b")).toBe(true);
    expect(captured.state.notes.some((entry) => entry.id === "note-b")).toBe(true);
  });

  it("restores available relations and preserves unavailable ones for retry", () => {
    const captured = captureRelationsForDeletion(mixedState(), noteDocumentId("note-a"));
    const withoutNote = { ...captured.state, notes: captured.state.notes.filter((entry) => entry.id !== "note-a") };
    const first = restoreCapturedRelations(withoutNote, captured.relations, now);
    expect(first.restored).toEqual([]);
    expect(first.pending).toHaveLength(2);

    const noteRestored = { ...first.state, notes: [note("note-a"), ...first.state.notes] };
    const retry = retryPendingRelations(noteRestored);
    expect(retry.restored).toHaveLength(2);
    expect(retry.state.pendingRelations).toEqual([]);
  });

  it("does not duplicate a semantic relation while restoring", () => {
    const state = mixedState();
    const relation = state.objectGraph.relations[0];
    const restored = restoreCapturedRelations(state, [relation]);
    expect(restored.state.objectGraph.relations).toHaveLength(2);
  });

  it("permanently removing a material deletes its semantic relations without pending recovery", () => {
    const relation = add(stateFixture(), "material-link", "native-a", materialDocumentId("material"));
    if (relation.result.status !== "accepted") throw new Error("fixture failed");
    const pending: ObjectRelation = {
      id: "material-pending", kind: "links", fromId: "native-b",
      toId: materialDocumentId("material"), order: 0, createdAt: now
    };
    const state = {
      ...relation.state,
      pendingRelations: [{ relation: pending, reason: "missing-to" as const, capturedAt: now }]
    };
    const purged = purgeRelationsForEndpoints(state, [materialDocumentId("material")]);
    expect(purged.objectGraph.relations).toEqual([]);
    expect(purged.pendingRelations).toEqual([]);
    expect(purged.objectGraph.objects.some((object) => object.id === "native-a")).toBe(true);
  });

  it("purges pending relations for one destroyed endpoint and keeps unrelated recovery entries", () => {
    const related: ObjectRelation = {
      id: "related", kind: "links", fromId: noteDocumentId("note-a"),
      toId: "missing", order: 0, createdAt: now
    };
    const unrelated: ObjectRelation = {
      id: "unrelated", kind: "links", fromId: "native-a",
      toId: "elsewhere", order: 0, createdAt: now
    };
    const state = {
      ...stateFixture(),
      pendingRelations: [related, unrelated].map((relation) => ({
        relation, reason: "missing-to" as const, capturedAt: now
      }))
    };
    const purged = purgeRelationsForEndpoints(state, [noteDocumentId("note-a")]);
    expect(purged.pendingRelations.map((entry) => entry.relation.id)).toEqual(["unrelated"]);
  });

  it("purges pending relations for every endpoint destroyed by empty trash", () => {
    const first: ObjectRelation = {
      id: "first", kind: "links", fromId: noteDocumentId("note-a"),
      toId: "missing-a", order: 0, createdAt: now
    };
    const second: ObjectRelation = {
      id: "second", kind: "embeds", fromId: "missing-b",
      toId: "native-b", order: 0, createdAt: now
    };
    const unrelated: ObjectRelation = {
      id: "keep", kind: "links", fromId: "native-a",
      toId: "missing-c", order: 0, createdAt: now
    };
    const state = {
      ...stateFixture(),
      pendingRelations: [first, second, unrelated].map((relation) => ({
        relation, reason: "missing-to" as const, capturedAt: now
      }))
    };
    const purged = purgeRelationsForEndpoints(state, [noteDocumentId("note-a"), "native-b"]);
    expect(purged.pendingRelations.map((entry) => entry.relation.id)).toEqual(["keep"]);
  });
});
