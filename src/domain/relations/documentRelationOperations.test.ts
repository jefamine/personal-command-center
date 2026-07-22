import { describe, expect, it, vi } from "vitest";
import type { Note, ReadingItem } from "../../types";
import {
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem,
  type DocumentRecord
} from "../documents/documentContract";
import { buildDocumentWikiLinkIndex } from "../documents/documentWikiLinks";
import { createTextBlock, createUniversalObject } from "../objects/objectGraph";
import {
  applyDocumentReferenceRenamePlan,
  planDocumentReferenceRename
} from "./documentRelationOperations";

const now = "2026-07-22T09:00:00.000Z";

function note(id: string, title: string, content = ""): DocumentRecord {
  const value: Note = {
    id, title, body: content, projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
  return documentFromNote(value);
}

describe("title-based document rename planning", () => {
  it("updates unique link and embed tokens but not ordinary matching text", () => {
    const source = note("source", "Источник", "Цель в тексте. [[Цель]] и ![[Цель]].");
    const target = note("target", "Цель");
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [source, target]);
    expect(plan.sources).toEqual([{
      sourceId: source.id,
      content: "Цель в тексте. [[Новое имя]] и ![[Новое имя]]."
    }]);
  });

  it("updates several uniquely resolved occurrences in one source", () => {
    const source = note("source", "Источник", "[[Цель]] / [[Цель]] / ![[Цель]]");
    const target = note("target", "Цель");
    expect(planDocumentReferenceRename(target.id, "Новая", [source, target]).sources[0].content)
      .toBe("[[Новая]] / [[Новая]] / ![[Новая]]");
  });

  it("does not rewrite ambiguous title tokens", () => {
    const source = note("source", "Источник", "[[Одинаково]]");
    const target = note("target", "Одинаково");
    const duplicate = note("duplicate", " одинаково ");
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [source, target, duplicate]);
    expect(plan.sources).toEqual([]);
    expect(plan.skippedSources).toContainEqual({ id: source.id, reason: "ambiguous-title" });
  });

  it("does not rewrite unresolved tokens", () => {
    const source = note("source", "Источник", "[[Несуществующее]]");
    const target = note("target", "Цель");
    expect(planDocumentReferenceRename(target.id, "Новое имя", [source, target]))
      .toEqual({ sources: [], skippedSources: [] });
  });

  it("skips read-only material and structured native sources", () => {
    const target = note("target", "Цель");
    const materialValue: ReadingItem = {
      id: "material", title: "Материал", summary: "", body: "[[Цель]]", url: "", source: "", tags: [], createdAt: now
    };
    const material = documentFromReadingItem(materialValue);
    const structured = documentFromNativeObject(createUniversalObject({
      id: "structured", roles: ["document"], title: "Структурный",
      blocks: [createTextBlock("[[Цель]]", "one"), createTextBlock("Второй блок", "two")]
    }, { now }));
    if (!structured) throw new Error("Structured fixture must resolve as a document.");
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [material, structured, target]);
    expect(plan.sources).toEqual([]);
    expect(plan.skippedSources).toEqual([
      { id: material.id, reason: "read-only" },
      { id: structured.id, reason: "structured" }
    ]);
  });

  it("applies source edits only through the canonical update callback and reports outcomes", () => {
    const source = note("source", "Источник", "[[Цель]]");
    const rejected = note("rejected", "Другой", "[[Цель]]");
    const target = note("target", "Цель");
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [source, rejected, target]);
    const revisionOwners: string[] = [];
    const update = vi.fn((id: DocumentRecord["id"], _content: string) => {
      revisionOwners.push(id);
      return id === rejected.id
        ? { status: "command-rejected" as const, id, message: "rejected" }
        : { status: "accepted" as const, id, source: source.source };
    });
    const summary = applyDocumentReferenceRenamePlan(plan, update);
    expect(update).toHaveBeenCalledTimes(2);
    expect(revisionOwners).toEqual([source.id, rejected.id]);
    expect(summary.updatedSources).toEqual([source.id]);
    expect(summary.rejectedSources).toEqual([{ id: rejected.id, reason: "command-rejected" }]);
    expect(summary.skippedSources).toEqual([]);
  });

  it("creates no persisted relation and backlinks rebuild from renamed canonical text", () => {
    const source = note("source", "Источник", "[[Цель]]");
    const target = note("target", "Цель");
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [source, target]);
    const updatedSource = { ...source, content: plan.sources[0].content };
    const renamedTarget = { ...target, title: "Новое имя" };
    const index = buildDocumentWikiLinkIndex([updatedSource, renamedTarget]);
    expect(plan.sources[0]).not.toHaveProperty("relation");
    expect(index.backlinksFor(target.id)).toMatchObject([{ sourceDocumentId: source.id }]);
  });
});
