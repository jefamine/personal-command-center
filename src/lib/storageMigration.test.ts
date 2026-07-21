import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { noteDocumentId } from "../domain/documents/documentContract";
import { addUniversalObject, createUniversalObject } from "../domain/objects/objectGraph";
import type { Note } from "../types";
import { migrateState } from "./storage";

const now = "2026-07-22T09:00:00.000Z";

function note(id: string): Note {
  return {
    id, title: id, body: "", projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
}

describe("schema migration v15 → v16", () => {
  it("normalizes old saved relations as manual without changing endpoints", () => {
    const current = createInitialState();
    current.notes = [note("legacy-note")];
    current.objectGraph = addUniversalObject(
      current.objectGraph,
      createUniversalObject({ id: "native", roles: ["document"], title: "Native" }, { now })
    );
    const { pendingRelations: _pending, ...v15 } = current;
    const migrated = migrateState({
      ...v15,
      version: 15,
      objectGraph: {
        ...v15.objectGraph,
        relations: [{
          id: "old", kind: "links", fromId: "native", toId: noteDocumentId("legacy-note"),
          order: 0, createdAt: now
        }]
      }
    } as never);
    expect(migrated.version).toBe(16);
    expect(migrated.objectGraph.relations[0]).toMatchObject({
      id: "old", origin: "manual", fromId: "native", toId: noteDocumentId("legacy-note")
    });
    expect(migrated.pendingRelations).toEqual([]);
  });

  it("fails closed when a plausible legacy-prefixed endpoint does not exist", () => {
    const current = createInitialState();
    current.objectGraph = {
      ...current.objectGraph,
      relations: [{
        id: "fake", kind: "links", fromId: "legacy:v12:note:missing", toId: "legacy:v12:note:also-missing",
        order: 0, createdAt: now, origin: "manual"
      }]
    };
    expect(() => migrateState(current)).toThrow(/endpoint/u);
  });

  it("quarantines a dangling v15 relation instead of losing it during migration", () => {
    const current = createInitialState();
    const { pendingRelations: _pending, ...v15 } = current;
    const migrated = migrateState({
      ...v15,
      version: 15,
      objectGraph: {
        ...v15.objectGraph,
        relations: [{
          id: "dangling", kind: "links", fromId: "legacy:v12:note:missing",
          toId: "legacy:v12:note:also-missing", order: 0, createdAt: now
        }]
      }
    } as never);
    expect(migrated.objectGraph.relations).toEqual([]);
    expect(migrated.pendingRelations).toEqual([
      expect.objectContaining({ relation: expect.objectContaining({ id: "dangling", origin: "manual" }), reason: "missing-endpoints" })
    ]);
  });
});
