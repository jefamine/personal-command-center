import { describe, expect, it } from "vitest";
import { createInitialState } from "../../data/seed";
import type { Note, ReadingItem } from "../../types";
import { createTextBlock, createUniversalObject } from "../objects/objectGraph";
import {
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem,
  type DocumentRecord
} from "./documentContract";
import {
  bindDocumentReference,
  reconcileDocumentReferences
} from "../relations/relationRepository";
import {
  buildDocumentWikiLinkIndex,
  documentEmbedTraversalState,
  matchWikiBinding,
  normalizeDocumentWikiTitle,
  parseDocumentWikiLinks,
  parseDocumentWikiReferences,
  wikiBindingForToken
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
      expect.objectContaining({ label: "Моя ссылка", raw: "[[Моя ссылка]]", start: 6, end: 20, kind: "link" })
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

  it("keeps an unbound legacy token title-based until reconciliation creates a binding", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Старое имя]]"));
    const target = documentFromNote(noteFixture("target", "Старое имя"));
    const renamedTarget = documentFromNote(noteFixture("target", "Новое имя"));

    expect(buildDocumentWikiLinkIndex([source, target]).outgoingFor(source.id)[0].status).toBe("resolved");
    expect(buildDocumentWikiLinkIndex([source, renamedTarget]).outgoingFor(source.id)[0].status).toBe("unresolved");
  });
});

describe("stable wiki bindings", () => {
  it("parses embeds separately from ordinary links", () => {
    const parsed = parseDocumentWikiReferences("[[Ссылка]] и ![[Встраивание]]");
    expect(parsed.map((token) => [token.kind, token.label])).toEqual([
      ["link", "Ссылка"], ["embed", "Встраивание"]
    ]);
    expect(parseDocumentWikiLinks("![[Встраивание]]")).toEqual([]);
  });

  it("creates bindings only for uniquely resolved manual tokens", () => {
    const state = createInitialState();
    state.notes = [noteFixture("source", "Источник", "[[Цель]] [[Нет]]"), noteFixture("target", "Цель")];
    const docs = state.notes.map(documentFromNote);
    const result = reconcileDocumentReferences(state, docs[0], docs, { now, idFactory: () => "wiki" });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      id: "wiki", fromId: docs[0].id, toId: docs[1].id, origin: "wiki-link"
    });
  });

  it("creates an embed binding and removes it when its exact token is deleted", () => {
    const state = createInitialState();
    state.notes = [noteFixture("source", "Источник", "![[Цель]]"), noteFixture("target", "Цель")];
    const docs = state.notes.map(documentFromNote);
    const created = reconcileDocumentReferences(state, docs[0], docs, { now, idFactory: () => "embed" });
    expect(created.created[0]).toMatchObject({ origin: "wiki-embed", kind: "embeds", toId: docs[1].id });

    const editedSource = documentFromNote(noteFixture("source", "Источник", "Токен удалён"));
    const removed = reconcileDocumentReferences(created.state, editedSource, [editedSource, docs[1]], { now });
    expect(removed.removed).toMatchObject([{ id: "embed", origin: "wiki-embed" }]);
    expect(removed.state.objectGraph.relations).toEqual([]);
    expect(removed.state.notes.some((entry) => entry.id === "target")).toBe(true);
  });

  it("does not mutate an unrelated manual relation while reconciling text", () => {
    const state = createInitialState();
    state.notes = [noteFixture("source", "Источник", "[[Цель]]"), noteFixture("target", "Цель")];
    const docs = state.notes.map(documentFromNote);
    state.objectGraph.relations = [{
      id: "manual", kind: "links", fromId: docs[0].id, toId: docs[1].id,
      origin: "manual", order: 0, createdAt: now
    }];
    const result = reconcileDocumentReferences(state, docs[0], docs, { now, idFactory: () => "wiki" });
    expect(result.state.objectGraph.relations).toContainEqual(expect.objectContaining({ id: "manual", origin: "manual" }));
    expect(result.state.objectGraph.relations).toContainEqual(expect.objectContaining({ id: "wiki", origin: "wiki-link" }));
  });

  it("does not choose a target for an ambiguous title", () => {
    const state = createInitialState();
    state.notes = [
      noteFixture("source", "Источник", "[[Одинаково]]"),
      noteFixture("one", "Одинаково"),
      noteFixture("two", "Одинаково")
    ];
    const docs = state.notes.map(documentFromNote);
    expect(reconcileDocumentReferences(state, docs[0], docs, { now }).created).toEqual([]);
  });

  it("explicit chooser keeps two equal labels bound to different target IDs", () => {
    const state = createInitialState();
    state.notes = [
      noteFixture("source", "Источник", "[[Одинаково]] затем [[Одинаково]]"),
      noteFixture("one", "Одинаково"),
      noteFixture("two", "Одинаково")
    ];
    const docs = state.notes.map(documentFromNote);
    const tokens = parseDocumentWikiReferences(docs[0].content);
    const first = bindDocumentReference(state, docs[0].id, docs[1].id, tokens[0], { now, idFactory: () => "one" });
    if (first.result.status !== "accepted") throw new Error("fixture failed");
    const second = bindDocumentReference(first.state, docs[0].id, docs[2].id, tokens[1], { now, idFactory: () => "two" });
    expect(second.result.status).toBe("accepted");
    expect(buildDocumentWikiLinkIndex(docs, second.state.objectGraph.relations).linksFor(docs[0].id)
      .map((link) => link.targetDocumentId)).toEqual([docs[1].id, docs[2].id]);
  });

  it("never uses occurrence alone after an identical token is inserted", () => {
    const original = parseDocumentWikiReferences("до [[Цель]] после")[0];
    const binding = wikiBindingForToken(original);
    const changed = parseDocumentWikiReferences("[[Цель]] до [[Цель]] после");
    expect(matchWikiBinding(binding, "link", changed).status).toBe("matched");
    expect((matchWikiBinding(binding, "link", changed) as { token: { start: number } }).token.start)
      .toBeGreaterThan(0);

    const ambiguous = parseDocumentWikiReferences("[[Цель]] [[Цель]]");
    const ambiguousBinding = wikiBindingForToken(ambiguous[0]);
    const rearranged = parseDocumentWikiReferences("x [[Цель]] [[Цель]]");
    expect(matchWikiBinding(ambiguousBinding, "link", rearranged).status).not.toBe("matched");
  });

  it("keeps navigation and backlinks on a stable ID after target title changes", () => {
    const source = documentFromNote(noteFixture("source", "Источник", "[[Старое имя]]"));
    const target = documentFromNote(noteFixture("target", "Старое имя"));
    const token = parseDocumentWikiReferences(source.content)[0];
    const relation = {
      id: "binding", kind: "links" as const, fromId: source.id, toId: target.id,
      origin: "wiki-link" as const, binding: wikiBindingForToken(token), order: 0, createdAt: now
    };
    const renamed = documentFromNote(noteFixture("target", "Новое имя"));
    const index = buildDocumentWikiLinkIndex([source, renamed], [relation]);
    expect(index.linksFor(source.id)[0]).toMatchObject({ status: "resolved", targetDocumentId: renamed.id, targetTitle: "Новое имя" });
    expect(index.backlinksFor(renamed.id)).toHaveLength(1);
  });
});

describe("embed traversal safety", () => {
  const a = documentFromNote(noteFixture("a", "A")).id;
  const b = documentFromNote(noteFixture("b", "B")).id;

  it("detects self-embed and A → B → A by stable ID", () => {
    expect(documentEmbedTraversalState(a, new Set([a]), 0)).toBe("cycle");
    expect(documentEmbedTraversalState(a, new Set([a, b]), 1)).toBe("cycle");
  });

  it("limits long embed chains but does not constrain ordinary links", () => {
    expect(documentEmbedTraversalState(b, new Set([a]), 3)).toBe("depth-limit");
    expect(documentEmbedTraversalState(b, new Set([a]), 2)).toBe("render");
    const cyclicLinks = documents(noteFixture("a", "A", "[[B]]"), noteFixture("b", "B", "[[A]]"));
    expect(buildDocumentWikiLinkIndex(cyclicLinks).outgoing).toHaveLength(2);
  });
});
