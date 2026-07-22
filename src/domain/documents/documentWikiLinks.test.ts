import { describe, expect, it } from "vitest";
import type { Note, ReadingItem } from "../../types";
import { createTextBlock, createUniversalObject } from "../objects/objectGraph";
import {
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem,
  type DocumentRecord
} from "./documentContract";
import {
  buildDocumentWikiLinkIndex,
  documentEmbedTraversalState,
  normalizeDocumentWikiTitle,
  parseDocumentWikiLinks,
  parseDocumentWikiReferences
} from "./documentWikiLinks";

const now = "2026-07-22T09:00:00.000Z";

function noteFixture(id: string, title: string, body = ""): Note {
  return {
    id, title, body, projectId: null, tags: [], pinned: false,
    contentUpdatedAt: now, reflection: null, createdAt: now, updatedAt: now
  };
}

function documents(...entries: Note[]): DocumentRecord[] {
  return entries.map(documentFromNote);
}

describe("document wiki reference parser", () => {
  it("parses [[Title]] as a link with trimmed label, positions, and source order", () => {
    const input = "Текст [[  Моя ссылка  ]] и [[Вторая]]";
    expect(parseDocumentWikiReferences(input)).toMatchObject([
      { kind: "link", label: "Моя ссылка", raw: "[[  Моя ссылка  ]]", start: 6 },
      { kind: "link", label: "Вторая" }
    ]);
    expect(input).toBe("Текст [[  Моя ссылка  ]] и [[Вторая]]");
  });

  it("parses ![[Title]] as an embed and excludes it from the link-only parser", () => {
    expect(parseDocumentWikiReferences("![[Встраивание]]")[0]).toMatchObject({
      kind: "embed", label: "Встраивание"
    });
    expect(parseDocumentWikiLinks("![[Встраивание]] и [[Ссылка]]").map((token) => token.label))
      .toEqual(["Ссылка"]);
  });

  it("ignores blank and unclosed tokens without mutating the input", () => {
    const input = "[[ ]] и [[без конца";
    expect(parseDocumentWikiReferences(input)).toEqual([]);
    expect(input).toBe("[[ ]] и [[без конца");
  });

  it("normalizes case and surrounding whitespace only for title matching", () => {
    expect(normalizeDocumentWikiTitle("  МОЯ   Ссылка  ")).toBe("моя ссылка");
  });
});

describe("computed document reference index", () => {
  it("resolves exactly one matching title", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "См. [[Цель]]"),
      noteFixture("target", "Цель")
    );
    expect(buildDocumentWikiLinkIndex([source, target]).outgoingFor(source.id)[0]).toMatchObject({
      status: "resolved", targetDocumentId: target.id, start: 4, kind: "link"
    });
  });

  it("marks an absent title unresolved", () => {
    const [source] = documents(noteFixture("source", "Источник", "[[Нет такого]]"));
    expect(buildDocumentWikiLinkIndex([source]).outgoingFor(source.id)[0]).toMatchObject({
      status: "unresolved", label: "Нет такого"
    });
  });

  it("marks duplicate titles ambiguous without selecting an ID", () => {
    const [source, first, second] = documents(
      noteFixture("source", "Источник", "[[Одинаково]]"),
      noteFixture("first", "Одинаково"),
      noteFixture("second", " одинаково ")
    );
    const link = buildDocumentWikiLinkIndex([source, first, second]).outgoingFor(source.id)[0];
    expect(link.status).toBe("ambiguous");
    expect(link.targetDocumentId).toBeUndefined();
  });

  it("marks a unique self-reference and does not create a backlink", () => {
    const [source] = documents(noteFixture("source", "Источник", "[[Источник]]"));
    const index = buildDocumentWikiLinkIndex([source]);
    expect(index.outgoingFor(source.id)[0]).toMatchObject({ status: "self", targetDocumentId: source.id });
    expect(index.backlinksFor(source.id)).toEqual([]);
  });

  it("deduplicates repeated mentions from one source but retains distinct sources", () => {
    const [first, second, target] = documents(
      noteFixture("first", "Первый", "[[Цель]] и снова [[Цель]]"),
      noteFixture("second", "Второй", "![[Цель]]"),
      noteFixture("target", "Цель")
    );
    const index = buildDocumentWikiLinkIndex([first, second, target]);
    expect(index.outgoingFor(first.id)).toHaveLength(2);
    expect(index.backlinksFor(target.id).map((entry) => [entry.sourceTitle, entry.kind]))
      .toEqual([["Первый", "link"], ["Второй", "embed"]]);
  });

  it("removes a backlink immediately when the canonical token is removed", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "[[Цель]]"),
      noteFixture("target", "Цель")
    );
    expect(buildDocumentWikiLinkIndex([source, target]).backlinksFor(target.id)).toHaveLength(1);
    const edited = { ...source, content: "Токен удалён" };
    expect(buildDocumentWikiLinkIndex([edited, target]).backlinksFor(target.id)).toEqual([]);
  });

  it("becomes unresolved when target is absent and resolves again when it returns", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "[[Цель]]"),
      noteFixture("target", "Цель")
    );
    expect(buildDocumentWikiLinkIndex([source]).outgoingFor(source.id)[0].status).toBe("unresolved");
    expect(buildDocumentWikiLinkIndex([source, target]).outgoingFor(source.id)[0].status).toBe("resolved");
  });

  it("uses current target content for a live embed without copying it into the index", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "![[Цель]]"),
      noteFixture("target", "Цель", "Первая версия")
    );
    const updatedTarget = { ...target, content: "Новая версия" };
    const reference = buildDocumentWikiLinkIndex([source, updatedTarget]).embedsFor(source.id)[0];
    expect(reference).toMatchObject({ status: "resolved", targetDocumentId: target.id });
    expect([source, updatedTarget].find((entry) => entry.id === reference.targetDocumentId)?.content)
      .toBe("Новая версия");
    expect(reference).not.toHaveProperty("content");
  });

  it("supports Note, native document, and material through DocumentRecord", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Нативный]] ![[Материал]]"));
    const native = documentFromNativeObject(createUniversalObject({
      id: "native-document", roles: ["document"], title: "Нативный", blocks: [createTextBlock("")]
    }, { now }));
    const material: ReadingItem = {
      id: "material", title: "Материал", summary: "", body: "", url: "", source: "", tags: [], createdAt: now
    };
    if (!native) throw new Error("Native fixture must be a document.");
    const index = buildDocumentWikiLinkIndex([source, native, documentFromReadingItem(material)]);
    expect(index.outgoingFor(source.id).map((entry) => entry.status)).toEqual(["resolved", "resolved"]);
  });

  it("does not mutate inputs and needs no persisted relation cache", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Цель]]"));
    const target = documentFromNote(noteFixture("target", "Цель"));
    const before = structuredClone([source, target]);
    const first = buildDocumentWikiLinkIndex([source, target]);
    const rebuilt = buildDocumentWikiLinkIndex(structuredClone([source, target]));
    expect([source, target]).toEqual(before);
    expect(rebuilt.outgoing).toEqual(first.outgoing);
  });
});

describe("embed traversal safety", () => {
  const a = documentFromNote(noteFixture("a", "A")).id;
  const b = documentFromNote(noteFixture("b", "B")).id;

  it("detects self-embed and A → B → A by stable ID", () => {
    expect(documentEmbedTraversalState(a, new Set([a]), 0)).toBe("cycle");
    expect(documentEmbedTraversalState(a, new Set([a, b]), 1)).toBe("cycle");
  });

  it("limits embed depth to three while ordinary link cycles remain valid", () => {
    expect(documentEmbedTraversalState(b, new Set([a]), 3)).toBe("depth-limit");
    expect(documentEmbedTraversalState(b, new Set([a]), 2)).toBe("render");
    const cyclicLinks = documents(noteFixture("a", "A", "[[B]]"), noteFixture("b", "B", "[[A]]"));
    expect(buildDocumentWikiLinkIndex(cyclicLinks).outgoing).toHaveLength(2);
  });
});
