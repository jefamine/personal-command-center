import { describe, expect, it } from "vitest";
import type { Note, ReadingItem } from "../../types";
import {
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem
} from "../documents/documentContract";
import type { DocumentRecord } from "../documents/documentContract";
import { parseDocumentWikiReferences, wikiBindingForToken } from "../documents/documentWikiLinks";
import { createTextBlock, createUniversalObject, type ObjectRelation } from "../objects/objectGraph";
import { planDocumentReferenceRename } from "./documentRelationOperations";

const now = "2026-07-22T09:00:00.000Z";

function note(id: string, title: string, body = ""): Note {
  return {
    id, title, body, projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
}

function relationFor(source: DocumentRecord, target: DocumentRecord, origin: "wiki-link" | "wiki-embed"): ObjectRelation {
  const token = parseDocumentWikiReferences(source.content)[0];
  return {
    id: `${origin}-relation`,
    kind: origin === "wiki-link" ? "links" : "embeds",
    fromId: source.id,
    toId: target.id,
    origin,
    binding: wikiBindingForToken(token),
    order: 0,
    createdAt: now
  } as ObjectRelation;
}

describe("coordinated document rename planning", () => {
  it("rewrites only the exact bound token and preserves unrelated text", () => {
    const source = documentFromNote(note("source", "Источник", "Старое имя в тексте; [[Старое имя]]."));
    const target = documentFromNote(note("target", "Старое имя"));
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [relationFor(source, target, "wiki-link")], [source, target]);
    expect(plan.sources[0].content).toBe("Старое имя в тексте; [[Новое имя]].");
    expect(plan.sources[0].bindings[0].token).toMatchObject({ label: "Новое имя", kind: "link" });
  });

  it("rewrites a bound embed without flattening its target", () => {
    const source = documentFromNote(note("source", "Источник", "![[Старое имя]]"));
    const target = documentFromNote(note("target", "Старое имя"));
    const plan = planDocumentReferenceRename(target.id, "Новое имя", [relationFor(source, target, "wiki-embed")], [source, target]);
    expect(plan.sources[0].content).toBe("![[Новое имя]]");
    expect(plan.sources[0].bindings[0].token.kind).toBe("embed");
  });

  it("skips read-only materials and structured native documents", () => {
    const target = documentFromNote(note("target", "Цель"));
    const materialData: ReadingItem = {
      id: "material", title: "Материал", summary: "[[Цель]]", body: "", url: "", source: "", tags: [], createdAt: now
    };
    const material = documentFromReadingItem(materialData);
    const structured = documentFromNativeObject(createUniversalObject({
      id: "structured", roles: ["document"], title: "Структура",
      blocks: [createTextBlock("[[Цель]]", "one"), createTextBlock("Второй блок", "two")]
    }, { now }));
    if (!structured) throw new Error("fixture failed");
    const materialRelation = relationFor(material, target, "wiki-link");
    const structuredRelation = relationFor(structured, target, "wiki-link");
    const plan = planDocumentReferenceRename(target.id, "Новая цель", [materialRelation, structuredRelation], [material, structured, target]);
    expect(plan.sources).toEqual([]);
    expect(plan.skippedSources).toEqual(expect.arrayContaining([
      { id: material.id, reason: "read-only" },
      { id: structured.id, reason: "structured" }
    ]));
  });

  it("returns an explicit skip when a repeated token cannot be matched safely", () => {
    const original = documentFromNote(note("source", "Источник", "[[Цель]] [[Цель]]"));
    const target = documentFromNote(note("target", "Цель"));
    const relation = relationFor(original, target, "wiki-link");
    const changed = { ...original, content: `x ${original.content}` };
    const before = structuredClone([relation, changed, target]);
    const plan = planDocumentReferenceRename(target.id, "Новая цель", [relation], [changed, target]);
    expect(plan.sources).toEqual([]);
    expect(plan.skippedSources).toContainEqual({ id: changed.id, reason: "binding-ambiguous" });
    expect([relation, changed, target]).toEqual(before);
  });
});
