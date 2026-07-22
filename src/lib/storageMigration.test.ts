import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { noteDocumentId } from "../domain/documents/documentContract";
import { addUniversalObject, createUniversalObject } from "../domain/objects/objectGraph";
import type { DashboardState, Note } from "../types";
import {
  isExperimentalV16State,
  migrateState,
  migrationSafetyBackupKey,
  shouldCreateMigrationSafetyBackup
} from "./storage";

const now = "2026-07-22T09:00:00.000Z";

function note(id: string, body = ""): Note {
  return {
    id, title: id, body, projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
}

function stateWithEndpoints(): DashboardState {
  const state = createInitialState();
  state.notes = [note("legacy-note", "Пользовательский [[текст]]")];
  state.objectGraph = addUniversalObject(
    state.objectGraph,
    createUniversalObject({ id: "native", roles: ["document"], title: "Native" }, { now })
  );
  return state;
}

function asV15(state: DashboardState) {
  const { pendingRelations: _pending, ...rest } = state;
  return { ...rest, version: 15 as const };
}

function binding(label = "legacy-note") {
  return {
    labelAtBinding: label,
    occurrence: 0,
    lastKnownStart: 0,
    lastKnownEnd: label.length + 4,
    contextFingerprint: "fnv1a:test"
  };
}

describe("final schema migration v15 → v16", () => {
  it("migrates v15 to final v16 and preserves plain semantic relations", () => {
    const current = stateWithEndpoints();
    const migrated = migrateState({
      ...asV15(current),
      objectGraph: {
        ...current.objectGraph,
        relations: [{
          id: "semantic", kind: "links", fromId: "native", toId: noteDocumentId("legacy-note"),
          order: 0, createdAt: now
        }]
      }
    } as never);
    expect(migrated.version).toBe(16);
    expect(migrated.objectGraph.relations).toEqual([{
      id: "semantic", kind: "links", fromId: "native", toId: noteDocumentId("legacy-note"),
      order: 0, createdAt: now
    }]);
    expect(migrated.pendingRelations).toEqual([]);
    expect(migrateState(migrated)).toEqual(migrated);
  });

  it("quarantines dangling v15 semantic relations instead of losing them", () => {
    const current = stateWithEndpoints();
    const migrated = migrateState({
      ...asV15(current),
      objectGraph: {
        ...current.objectGraph,
        relations: [{
          id: "dangling", kind: "links", fromId: "native", toId: "missing",
          order: 0, createdAt: now
        }]
      }
    } as never);
    expect(migrated.objectGraph.relations).toEqual([]);
    expect(migrated.pendingRelations).toEqual([
      expect.objectContaining({
        relation: expect.objectContaining({ id: "dangling" }),
        reason: "missing-to"
      })
    ]);
  });

  it("adds an empty relations array to a v15 Note tombstone", () => {
    const current = stateWithEndpoints();
    const legacyTrash = [{
      id: "trash", entityId: "legacy-note", entityKind: "note", title: "legacy-note", deletedAt: now,
      snapshot: { kind: "note", note: current.notes[0] }
    }];
    const migrated = migrateState({ ...asV15(current), notes: [], trash: legacyTrash } as never);
    expect(migrated.trash[0].snapshot).toMatchObject({ kind: "note", relations: [] });
  });

  it("rejects unknown versions and fails closed on a damaged semantic relation", () => {
    expect(() => migrateState({ ...createInitialState(), version: 17 } as never))
      .toThrow(/Неподдерживаемая версия/u);
    const damaged = stateWithEndpoints();
    damaged.objectGraph = {
      ...damaged.objectGraph,
      relations: [{
        id: "damaged", kind: "links", fromId: "", toId: "native", order: 0, createdAt: now
      }]
    };
    expect(() => migrateState(damaged)).toThrow(/повреждены/u);
  });
});

describe("experimental v16 → final v16 compatibility", () => {
  function experimentalState() {
    const current = stateWithEndpoints();
    const trashedNote = note("trashed", "![[Native]]");
    return {
      ...current,
      objectGraph: {
        ...current.objectGraph,
        relations: [
          {
            id: "manual", kind: "contains", fromId: "native", toId: noteDocumentId("legacy-note"),
            order: 0, createdAt: now, origin: "manual"
          },
          {
            id: "wiki", kind: "links", fromId: noteDocumentId("legacy-note"), toId: "native",
            order: 0, createdAt: now, origin: "wiki-link", binding: binding("Native")
          }
        ]
      },
      pendingRelations: [
        {
          relation: {
            id: "manual-pending", kind: "links", fromId: "native", toId: "missing",
            order: 0, createdAt: now, origin: "manual"
          },
          reason: "missing-to", capturedAt: now
        },
        {
          relation: {
            id: "wiki-pending", kind: "links", fromId: noteDocumentId("legacy-note"), toId: "native",
            order: 0, createdAt: now, origin: "wiki-link", binding: binding("Native")
          },
          reason: "binding-ambiguous", capturedAt: now
        }
      ],
      trash: [{
        id: "trash", entityId: trashedNote.id, entityKind: "note", title: trashedNote.title, deletedAt: now,
        snapshot: {
          kind: "note", note: trashedNote, relations: [
            {
              id: "trash-manual", kind: "links", fromId: noteDocumentId(trashedNote.id), toId: "native",
              order: 0, createdAt: now, origin: "manual"
            },
            {
              id: "trash-wiki", kind: "embeds", fromId: noteDocumentId(trashedNote.id), toId: "native",
              order: 1, createdAt: now, origin: "wiki-embed", binding: binding("Native")
            }
          ]
        }
      }]
    };
  }

  it("recognizes experimental v16 and assigns its dedicated safety key", () => {
    const experimental = experimentalState();
    expect(isExperimentalV16State(experimental)).toBe(true);
    expect(migrationSafetyBackupKey(experimental)).toBe("dashboard-state-before-computed-wiki-v16");
  });

  it("keeps the first safety snapshot and never requests overwriting it", () => {
    expect(shouldCreateMigrationSafetyBackup(undefined)).toBe(true);
    expect(shouldCreateMigrationSafetyBackup({ already: "saved" })).toBe(false);
  });

  it("converts manual relations to plain semantic relations and removes wiki relations", () => {
    const migrated = migrateState(experimentalState() as never);
    expect(migrated.objectGraph.relations).toEqual([{
      id: "manual", kind: "contains", fromId: "native", toId: noteDocumentId("legacy-note"),
      order: 0, createdAt: now
    }]);
    expect(migrated.objectGraph.relations[0]).not.toHaveProperty("origin");
    expect(migrated.objectGraph.relations.some((relation) => relation.id === "wiki")).toBe(false);
  });

  it("drops wiki pending entries but preserves plain manual recovery", () => {
    const migrated = migrateState(experimentalState() as never);
    expect(migrated.pendingRelations).toEqual([{
      relation: {
        id: "manual-pending", kind: "links", fromId: "native", toId: "missing",
        order: 0, createdAt: now
      },
      reason: "missing-to", capturedAt: now
    }]);
  });

  it("removes wiki relations from trash snapshots and keeps semantic ones plain", () => {
    const migrated = migrateState(experimentalState() as never);
    expect(migrated.trash[0].snapshot).toMatchObject({
      kind: "note",
      relations: [{ id: "trash-manual", kind: "links" }]
    });
    if (migrated.trash[0].snapshot.kind !== "note") throw new Error("Expected Note snapshot.");
    expect(migrated.trash[0].snapshot.relations[0]).not.toHaveProperty("origin");
  });

  it("does not rewrite canonical user text during conversion", () => {
    const experimental = experimentalState();
    const originalText = experimental.notes[0].body;
    expect(migrateState(experimental as never).notes[0].body).toBe(originalText);
  });

  it("fails closed when an experimental semantic relation cannot be interpreted safely", () => {
    const experimental = experimentalState();
    experimental.objectGraph.relations[0] = {
      ...experimental.objectGraph.relations[0],
      origin: "unknown"
    };
    expect(() => migrateState(experimental as never)).toThrow(/origin/u);
  });
});
