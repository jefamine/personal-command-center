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
  normalizeDocumentWikiTitle,
  parseDocumentWikiLinks
} from "./documentWikiLinks";

const now = "2026-07-22T09:00:00.000Z";

function noteFixture(id: string, title: string, body = ""): Note {
  return {
    id,
    title,
    body,
    projectId: null,
    tags: [],
    pinned: false,
    contentUpdatedAt: now,
    reflection: null,
    createdAt: now,
    updatedAt: now
  };
}

function documents(...entries: Note[]): DocumentRecord[] {
  return entries.map(documentFromNote);
}

describe("document wiki-link parser", () => {
  it("finds a single ordinary link and retains its label and positions", () => {
    expect(parseDocumentWikiLinks("Текст [[Моя ссылка]] дальше.")).toEqual([
      { label: "Моя ссылка", raw: "[[Моя ссылка]]", start: 6, end: 20 }
    ]);
  });

  it("keeps several links in their source order", () => {
    expect(parseDocumentWikiLinks("[[Первая]] и [[Вторая]]").map((token) => token.label))
      .toEqual(["Первая", "Вторая"]);
  });

  it("normalizes spaces and Russian case only for matching", () => {
    expect(normalizeDocumentWikiTitle("  МОЯ   Ссылка  ")).toBe("моя ссылка");
  });

  it("ignores blank tokens and an unclosed token without changing source text", () => {
    const content = "[[ ]] и [[без конца";
    expect(parseDocumentWikiLinks(content)).toEqual([]);
    expect(content).toBe("[[ ]] и [[без конца");
  });

  it("does not treat an embed as an ordinary link", () => {
    expect(parseDocumentWikiLinks("![[Встраивание]] и [[Ссылка]]").map((token) => token.label))
      .toEqual(["Ссылка"]);
  });
});

describe("computed document wiki-link index", () => {
  it("resolves a unique title", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "См. [[Цель]]"),
      noteFixture("target", "Цель")
    );

    expect(buildDocumentWikiLinkIndex([source, target]).outgoingFor(source.id)).toMatchObject([
      { status: "resolved", label: "Цель", targetDocumentId: target.id, targetTitle: "Цель" }
    ]);
  });

  it("marks absent titles unresolved", () => {
    const [source] = documents(noteFixture("source", "Источник", "[[Нет такого]]"));
    expect(buildDocumentWikiLinkIndex([source]).outgoingFor(source.id)[0]).toMatchObject({
      status: "unresolved",
      label: "Нет такого"
    });
  });

  it("marks repeated titles ambiguous instead of choosing one", () => {
    const [source, first, second] = documents(
      noteFixture("source", "Источник", "[[Одинаково]]"),
      noteFixture("first", "Одинаково"),
      noteFixture("second", " одинаково ")
    );
    const link = buildDocumentWikiLinkIndex([source, first, second]).outgoingFor(source.id)[0];
    expect(link.status).toBe("ambiguous");
    expect(link.targetDocumentId).toBeUndefined();
  });

  it("marks a unique self link without a navigable target", () => {
    const [source] = documents(noteFixture("source", "Источник", "[[Источник]]"));
    const link = buildDocumentWikiLinkIndex([source]).outgoingFor(source.id)[0];
    expect(link).toMatchObject({ status: "self", targetDocumentId: source.id });
    expect(buildDocumentWikiLinkIndex([source]).backlinksFor(source.id)).toEqual([]);
  });

  it("does not duplicate a backlink when one source mentions the target repeatedly", () => {
    const [source, target] = documents(
      noteFixture("source", "Источник", "[[Цель]] и снова [[Цель]]"),
      noteFixture("target", "Цель")
    );
    const index = buildDocumentWikiLinkIndex([source, target]);
    expect(index.outgoingFor(source.id)).toHaveLength(2);
    expect(index.backlinksFor(target.id)).toHaveLength(1);
    expect(index.backlinksFor(target.id)[0]).toMatchObject({ sourceDocumentId: source.id, order: 0 });
  });

  it("creates one backlink for every distinct source", () => {
    const [first, second, target] = documents(
      noteFixture("first", "Первый", "[[Цель]]"),
      noteFixture("second", "Второй", "[[Цель]]"),
      noteFixture("target", "Цель")
    );
    expect(buildDocumentWikiLinkIndex([first, second, target]).backlinksFor(target.id)
      .map((link) => link.sourceTitle)).toEqual(["Первый", "Второй"]);
  });

  it("accepts Note, native document, and material through the shared contract", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Нативный]] [[Материал]]"));
    const native = documentFromNativeObject(createUniversalObject({
      id: "native-document",
      roles: ["document"],
      title: "Нативный",
      blocks: [createTextBlock("")]
    }, { now }));
    const material: ReadingItem = {
      id: "material", title: "Материал", summary: "", body: "", url: "", source: "", tags: [], createdAt: now
    };
    if (!native) throw new Error("Native fixture must be a document.");

    const index = buildDocumentWikiLinkIndex([source, native, documentFromReadingItem(material)]);
    expect(index.outgoingFor(source.id).map((link) => link.status)).toEqual(["resolved", "resolved"]);
  });

  it("never mutates its input documents", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Цель]]"));
    const target = documentFromNote(noteFixture("target", "Цель"));
    const before = structuredClone([source, target]);

    buildDocumentWikiLinkIndex([source, target]);

    expect([source, target]).toEqual(before);
  });

  it("becomes unresolved after a target rename, the known title-link limitation", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Старое имя]]"));
    const target = documentFromNote(noteFixture("target", "Старое имя"));
    const renamedTarget = documentFromNote(noteFixture("target", "Новое имя"));

    expect(buildDocumentWikiLinkIndex([source, target]).outgoingFor(source.id)[0].status).toBe("resolved");
    expect(buildDocumentWikiLinkIndex([source, renamedTarget]).outgoingFor(source.id)[0].status).toBe("unresolved");
  });
});
