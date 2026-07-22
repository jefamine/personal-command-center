import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { noteDocumentId } from "../domain/documents/documentContract";
import { addUniversalObject, createUniversalObject } from "../domain/objects/objectGraph";
import { legacyObjectReference } from "../domain/objects/legacyAdapter";
import type { CalendarEvent, DashboardState, Note } from "../types";
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

function linkedEvent(taskId: string): CalendarEvent {
  return {
    id: "legacy-event", title: "Событие", startAt: now,
    endAt: "2026-07-22T10:00:00.000Z", kind: "focus", source: "dashboard",
    taskId, notes: "", locked: true, createdAt: now, updatedAt: now
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

  it("adds empty relations arrays to old v15 Task and Event tombstones", () => {
    const current = stateWithEndpoints();
    const task = current.tasks[0];
    const event = linkedEvent(task.id);
    const trash = [
      {
        id: "task-trash", entityId: task.id, entityKind: "task", title: task.title, deletedAt: now,
        snapshot: { kind: "task", task, linkedEvents: [event] }
      },
      {
        id: "event-trash", entityId: event.id, entityKind: "event", title: event.title, deletedAt: now,
        snapshot: { kind: "event", event }
      }
    ];
    const migrated = migrateState({
      ...asV15(current), tasks: current.tasks.slice(1), events: [], trash
    } as never);
    expect(migrated.trash.map((entry) => entry.snapshot)).toMatchObject([
      { kind: "task", relations: [] },
      { kind: "event", relations: [] }
    ]);
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

describe("stored final v16 legacy tombstone normalization", () => {
  it("normalizes old Task/Event snapshots and moves their dangling relations into trash", () => {
    const current = stateWithEndpoints();
    const task = current.tasks[0];
    const event = linkedEvent(task.id);
    const taskId = legacyObjectReference("task", task.id);
    const eventId = legacyObjectReference("event", event.id);
    const migrated = migrateState({
      ...current,
      tasks: current.tasks.slice(1),
      events: [],
      trash: [
        {
          id: "task-trash", entityId: task.id, entityKind: "task", title: task.title, deletedAt: now,
          snapshot: { kind: "task", task, linkedEvents: [event] }
        },
        {
          id: "event-trash", entityId: "other-event", entityKind: "event", title: "Другое", deletedAt: now,
          snapshot: { kind: "event", event: { ...event, id: "other-event", taskId: null } }
        }
      ],
      objectGraph: {
        ...current.objectGraph,
        relations: [
          { id: "task-dangling", kind: "links", fromId: "native", toId: taskId, order: 0, createdAt: now },
          { id: "event-dangling", kind: "embeds", fromId: eventId, toId: "native", order: 0, createdAt: now }
        ]
      }
    } as never);

    expect(migrated.objectGraph.relations).toEqual([]);
    expect(migrated.trash[0].snapshot).toMatchObject({
      kind: "task",
      relations: [
        expect.objectContaining({ id: "task-dangling" }),
        expect.objectContaining({ id: "event-dangling" })
      ]
    });
    expect(migrated.trash[1].snapshot).toMatchObject({ kind: "event", relations: [] });
    expect(migrateState(migrated)).toEqual(migrated);
  });

  it("normalizes an old Event snapshot and moves its dangling relation into that snapshot", () => {
    const current = stateWithEndpoints();
    const event = linkedEvent(current.tasks[0].id);
    const eventId = legacyObjectReference("event", event.id);
    const migrated = migrateState({
      ...current,
      events: [],
      trash: [{
        id: "event-trash", entityId: event.id, entityKind: "event", title: event.title, deletedAt: now,
        snapshot: { kind: "event", event }
      }],
      objectGraph: {
        ...current.objectGraph,
        relations: [{
          id: "event-dangling", kind: "links", fromId: "native", toId: eventId,
          order: 0, createdAt: now
        }]
      }
    } as never);
    expect(migrated.objectGraph.relations).toEqual([]);
    expect(migrated.trash[0].snapshot).toMatchObject({
      kind: "event", relations: [expect.objectContaining({ id: "event-dangling" })]
    });
  });

  it("does not silently discard a dangling relation unknown to live catalog and tombstones", () => {
    const current = stateWithEndpoints();
    const relation = {
      id: "unknown-dangling", kind: "links", fromId: "native", toId: "missing",
      order: 0, createdAt: now
    } as const;
    expect(() => migrateState({
      ...current,
      objectGraph: { ...current.objectGraph, relations: [relation] }
    } as never)).toThrow();
    expect(relation.toId).toBe("missing");
  });

  it("fails closed for invalid or duplicate Task snapshot relations", () => {
    const current = stateWithEndpoints();
    const task = current.tasks[0];
    const valid = {
      id: "duplicate", kind: "links", fromId: legacyObjectReference("task", task.id),
      toId: "native", order: 0, createdAt: now
    } as const;
    const base = {
      ...current,
      tasks: current.tasks.slice(1),
      trash: [{
        id: "task-trash", entityId: task.id, entityKind: "task", title: task.title, deletedAt: now,
        snapshot: { kind: "task", task, linkedEvents: [], relations: [valid, valid] }
      }]
    };
    expect(() => migrateState(base as never)).toThrow(/повреждены/u);
    expect(() => migrateState({
      ...base,
      trash: [{
        ...base.trash[0],
        snapshot: {
          ...base.trash[0].snapshot,
          relations: [{ ...valid, id: "unrelated", fromId: "native", toId: "missing" }]
        }
      }]
    } as never)).toThrow(/повреждены/u);
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

  it("normalizes experimental Task/Event tombstones and keeps their manual relations plain", () => {
    const experimental = experimentalState();
    const task = experimental.tasks[0];
    const event = linkedEvent(task.id);
    const migrated = migrateState({
      ...experimental,
      tasks: experimental.tasks.slice(1),
      trash: [
        ...experimental.trash,
        {
          id: "task-trash", entityId: task.id, entityKind: "task", title: task.title, deletedAt: now,
          snapshot: {
            kind: "task", task, linkedEvents: [event], relations: [{
              id: "task-manual", kind: "links",
              fromId: legacyObjectReference("task", task.id), toId: "native",
              order: 0, createdAt: now, origin: "manual"
            }]
          }
        },
        {
          id: "event-trash", entityId: "other-event", entityKind: "event", title: "Другое", deletedAt: now,
          snapshot: { kind: "event", event: { ...event, id: "other-event", taskId: null } }
        }
      ]
    } as never);
    const taskSnapshot = migrated.trash.find((entry) => entry.id === "task-trash")?.snapshot;
    const eventSnapshot = migrated.trash.find((entry) => entry.id === "event-trash")?.snapshot;
    expect(taskSnapshot).toMatchObject({
      kind: "task", relations: [expect.objectContaining({ id: "task-manual" })]
    });
    if (taskSnapshot?.kind !== "task") throw new Error("Expected Task snapshot.");
    expect(taskSnapshot.relations[0]).not.toHaveProperty("origin");
    expect(eventSnapshot).toMatchObject({ kind: "event", relations: [] });
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
