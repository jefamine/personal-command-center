import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import {
  addUniversalObject,
  createUniversalObject,
  type ObjectRelation
} from "../domain/objects/objectGraph";
import { legacyObjectReference } from "../domain/objects/legacyAdapter";
import { objectTrashEntry } from "../domain/safety/dataSafety";
import {
  addRelationToState,
  assertPersistedRelationEndpoints
} from "../domain/relations/relationRepository";
import type { CalendarEvent, DashboardState } from "../types";
import {
  deleteEventFromDashboardState,
  deleteLifeAreaFromDashboardState,
  deleteTaskFromDashboardState,
  emptyTrashFromDashboardState,
  purgeTrashEntryFromDashboardState,
  restoreTrashEntryInDashboardState
} from "./DashboardContext";

const now = "2026-07-22T09:00:00.000Z";

function fixture(): { state: DashboardState; event: CalendarEvent } {
  const state = createInitialState();
  const event: CalendarEvent = {
    id: "linked-event", title: "Связанное событие", startAt: now,
    endAt: "2026-07-22T10:00:00.000Z", kind: "focus", source: "dashboard",
    taskId: state.tasks[0].id, notes: "", locked: true, createdAt: now, updatedAt: now
  };
  state.events = [event];
  state.objectGraph = addUniversalObject(
    addUniversalObject(
      state.objectGraph,
      createUniversalObject({ id: "native-a", roles: ["document"], title: "A" }, { now })
    ),
    createUniversalObject({ id: "native-b", roles: ["document"], title: "B" }, { now })
  );
  return { state, event };
}

function add(state: DashboardState, relation: Omit<ObjectRelation, "order" | "createdAt">): DashboardState {
  const result = addRelationToState(state, { ...relation, order: 0 }, { now });
  if (result.result.status !== "accepted") throw new Error(`Fixture relation rejected: ${relation.id}`);
  return result.state;
}

function pending(relation: ObjectRelation) {
  return { relation, reason: "missing-to" as const, capturedAt: now };
}

describe("DashboardContext legacy semantic lifecycle commands", () => {
  it("Task deletion captures incoming, outgoing and linked-event relations exactly once", () => {
    const built = fixture();
    const taskId = legacyObjectReference("task", built.state.tasks[0].id);
    const eventId = legacyObjectReference("event", built.event.id);
    let state = built.state;
    for (const relation of [
      { id: "incoming", kind: "links" as const, fromId: "native-a", toId: taskId },
      { id: "outgoing", kind: "embeds" as const, fromId: taskId, toId: "native-b" },
      { id: "task-event", kind: "links" as const, fromId: taskId, toId: eventId },
      { id: "event-out", kind: "links" as const, fromId: eventId, toId: "native-a" },
      { id: "unrelated", kind: "links" as const, fromId: "native-a", toId: "native-b" }
    ]) state = add(state, relation);

    const deleted = deleteTaskFromDashboardState(state, built.state.tasks[0].id);
    const snapshot = deleted.trash[0].snapshot;
    expect(snapshot.kind).toBe("task");
    if (snapshot.kind !== "task") throw new Error("Expected Task tombstone.");
    expect(snapshot.relations.map((relation) => relation.id).sort()).toEqual([
      "event-out", "incoming", "outgoing", "task-event"
    ]);
    expect(new Set(snapshot.relations.map((relation) => relation.id)).size).toBe(4);
    expect(snapshot.linkedEvents.map((event) => event.id)).toEqual([built.event.id]);
    expect(deleted.objectGraph.relations.map((relation) => relation.id)).toEqual(["unrelated"]);
    expect(deleted.tasks.some((task) => task.id === built.state.tasks[0].id)).toBe(false);
    expect(deleted.events.some((event) => event.id === built.event.id)).toBe(false);
    expect(deleted.objectGraph.objects.map((object) => object.id).sort()).toEqual(["native-a", "native-b"]);
    expect(() => assertPersistedRelationEndpoints(deleted)).not.toThrow();
  });

  it("Task restore returns the Task, linked events and available relations without duplicates", () => {
    const built = fixture();
    const taskId = legacyObjectReference("task", built.state.tasks[0].id);
    const eventId = legacyObjectReference("event", built.event.id);
    let state = add(built.state, { id: "task-event", kind: "links", fromId: taskId, toId: eventId });
    state = add(state, { id: "incoming", kind: "links", fromId: "native-a", toId: taskId });
    const deleted = deleteTaskFromDashboardState(state, built.state.tasks[0].id);
    const restored = restoreTrashEntryInDashboardState(deleted, deleted.trash[0].id);

    expect(restored.restored).toBe(true);
    expect(restored.state.tasks.filter((task) => task.id === built.state.tasks[0].id)).toHaveLength(1);
    expect(restored.state.events.filter((event) => event.id === built.event.id)).toHaveLength(1);
    expect(restored.state.objectGraph.relations.map((relation) => relation.id).sort())
      .toEqual(["incoming", "task-event"]);
    expect(restored.state.pendingRelations).toEqual([]);
    expect(restored.state.trash).toEqual([]);
  });

  it("Task restore leaves a relation pending while its other endpoint is unavailable", () => {
    const built = fixture();
    const taskId = legacyObjectReference("task", built.state.tasks[0].id);
    const related = add(built.state, {
      id: "temporarily-missing", kind: "links", fromId: taskId, toId: "native-b"
    });
    const deleted = deleteTaskFromDashboardState(related, built.state.tasks[0].id);
    const withoutNative = {
      ...deleted,
      objectGraph: {
        ...deleted.objectGraph,
        objects: deleted.objectGraph.objects.filter((object) => object.id !== "native-b")
      }
    };
    const restored = restoreTrashEntryInDashboardState(withoutNative, withoutNative.trash[0].id);

    expect(restored.state.pendingRelations.map((entry) => entry.relation.id))
      .toEqual(["temporarily-missing"]);
    expect(restored.state.objectGraph.relations).toEqual([]);
  });

  it("Event deletion captures incoming and outgoing relations and restore returns them", () => {
    const built = fixture();
    const eventId = legacyObjectReference("event", built.event.id);
    let state = add(built.state, { id: "event-in", kind: "links", fromId: "native-a", toId: eventId });
    state = add(state, { id: "event-out", kind: "embeds", fromId: eventId, toId: "native-b" });
    const deleted = deleteEventFromDashboardState(state, built.event.id);
    const snapshot = deleted.trash[0].snapshot;
    expect(snapshot.kind).toBe("event");
    if (snapshot.kind !== "event") throw new Error("Expected Event tombstone.");
    expect(snapshot.relations.map((relation) => relation.id).sort()).toEqual(["event-in", "event-out"]);
    expect(() => assertPersistedRelationEndpoints(deleted)).not.toThrow();

    const restored = restoreTrashEntryInDashboardState(deleted, deleted.trash[0].id);
    expect(restored.state.events.filter((event) => event.id === built.event.id)).toHaveLength(1);
    expect(restored.state.objectGraph.relations.map((relation) => relation.id).sort())
      .toEqual(["event-in", "event-out"]);
  });

  it("permanent LifeArea deletion purges live and pending relations but keeps unrelated data", () => {
    const built = fixture();
    const area = built.state.lifeAreas[0];
    const areaId = legacyObjectReference("area", area.id);
    built.state.projects = built.state.projects.map((project, index) =>
      index === 0 ? { ...project, areaId: area.id, area: area.title } : project
    );
    let state = add(built.state, { id: "area-live", kind: "links", fromId: areaId, toId: "native-a" });
    state = add(state, { id: "unrelated", kind: "links", fromId: "native-a", toId: "native-b" });
    state = {
      ...state,
      pendingRelations: [
        pending({ id: "area-pending", kind: "links", fromId: areaId, toId: "missing", order: 0, createdAt: now }),
        pending({ id: "keep-pending", kind: "links", fromId: "native-a", toId: "missing", order: 0, createdAt: now })
      ]
    };

    const deleted = deleteLifeAreaFromDashboardState(state, area.id, now);
    expect(deleted.lifeAreas.some((entry) => entry.id === area.id)).toBe(false);
    expect(deleted.projects[0].areaId).toBeNull();
    expect(deleted.objectGraph.relations.map((relation) => relation.id)).toEqual(["unrelated"]);
    expect(deleted.pendingRelations.map((entry) => entry.relation.id)).toEqual(["keep-pending"]);
    expect(deleted.objectGraph.objects.map((object) => object.id).sort()).toEqual(["native-a", "native-b"]);
  });

  it("purge and empty trash include a Task and every linked Event endpoint", () => {
    const built = fixture();
    const taskId = legacyObjectReference("task", built.state.tasks[0].id);
    const eventId = legacyObjectReference("event", built.event.id);
    const deleted = deleteTaskFromDashboardState(built.state, built.state.tasks[0].id);
    const hiddenRelation: ObjectRelation = {
      id: "hidden-recovery", kind: "links", fromId: taskId, toId: eventId,
      order: 0, createdAt: now
    };
    const stateWithPending: DashboardState = {
      ...deleted,
      objectGraph: {
        ...deleted.objectGraph,
        relations: [{
          id: "dangling-live", kind: "links", fromId: taskId, toId: "native-a",
          order: 0, createdAt: now
        }]
      },
      trash: deleted.trash.map((entry) => entry.snapshot.kind === "task"
        ? { ...entry, snapshot: { ...entry.snapshot, relations: [hiddenRelation] } }
        : entry),
      pendingRelations: [
        pending({ id: "task-pending", kind: "links", fromId: taskId, toId: "missing", order: 0, createdAt: now }),
        pending({ id: "event-pending", kind: "links", fromId: eventId, toId: "missing", order: 0, createdAt: now }),
        pending({ id: "unrelated", kind: "links", fromId: "native-a", toId: "missing", order: 0, createdAt: now })
      ]
    };

    const purged = purgeTrashEntryFromDashboardState(stateWithPending, stateWithPending.trash[0].id);
    expect(purged.pendingRelations.map((entry) => entry.relation.id)).toEqual(["unrelated"]);
    expect(purged.objectGraph.relations).toEqual([]);
    expect(purged.trash).toEqual([]);

    const emptied = emptyTrashFromDashboardState(stateWithPending);
    expect(emptied.pendingRelations.map((entry) => entry.relation.id)).toEqual(["unrelated"]);
    expect(emptied.objectGraph.relations).toEqual([]);
    expect(emptied.trash).toEqual([]);
  });

  it("purging Event B removes Task A recovery relation and prevents an eternal pending entry", () => {
    const built = fixture();
    const task = built.state.tasks[0];
    const standaloneEvent = { ...built.event, id: "standalone-event", taskId: null };
    const taskId = legacyObjectReference("task", task.id);
    const eventId = legacyObjectReference("event", standaloneEvent.id);
    let state: DashboardState = { ...built.state, events: [standaloneEvent] };
    state = add(state, { id: "task-to-event", kind: "links", fromId: taskId, toId: eventId });

    const taskDeleted = deleteTaskFromDashboardState(state, task.id);
    const taskTrashId = taskDeleted.trash.find((entry) => entry.snapshot.kind === "task")!.id;
    const taskSnapshotBefore = taskDeleted.trash.find((entry) => entry.id === taskTrashId)!.snapshot;
    if (taskSnapshotBefore.kind !== "task") throw new Error("Expected Task snapshot.");
    expect(taskSnapshotBefore.relations.map((relation) => relation.id)).toEqual(["task-to-event"]);

    const eventDeleted = deleteEventFromDashboardState(taskDeleted, standaloneEvent.id);
    const eventTrashId = eventDeleted.trash.find((entry) => entry.snapshot.kind === "event")!.id;
    const eventPurged = purgeTrashEntryFromDashboardState(eventDeleted, eventTrashId);
    const taskSnapshotAfter = eventPurged.trash.find((entry) => entry.id === taskTrashId)!.snapshot;
    if (taskSnapshotAfter.kind !== "task") throw new Error("Expected Task snapshot.");
    expect(taskSnapshotAfter.relations).toEqual([]);

    const restored = restoreTrashEntryInDashboardState(eventPurged, taskTrashId);
    expect(restored.restored).toBe(true);
    expect(restored.state.objectGraph.relations).toEqual([]);
    expect(restored.state.pendingRelations).toEqual([]);
  });

  it("permanent LifeArea deletion removes its relation from an Object tombstone", () => {
    const built = fixture();
    const area = built.state.lifeAreas[0];
    const areaId = legacyObjectReference("area", area.id);
    const object = built.state.objectGraph.objects.find((entry) => entry.id === "native-a")!;
    const relation: ObjectRelation = {
      id: "object-area", kind: "links", fromId: object.id, toId: areaId,
      order: 0, createdAt: now
    };
    const state: DashboardState = {
      ...built.state,
      objectGraph: {
        ...built.state.objectGraph,
        objects: built.state.objectGraph.objects.filter((entry) => entry.id !== object.id)
      },
      trash: [objectTrashEntry(object, [relation], now, "object-trash")]
    };

    const deleted = deleteLifeAreaFromDashboardState(state, area.id, now);
    expect(deleted.trash[0].snapshot.relations).toEqual([]);
    expect(deleted.objectGraph.objects.some((entry) => entry.id === "native-b")).toBe(true);
  });
});
