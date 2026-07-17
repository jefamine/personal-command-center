import { describe, expect, it } from "vitest";
import { createTextBlock, createUniversalObject } from "../domain/objects/objectGraph";
import { blocksAfterSimpleBodyEdit, hasSimpleEditableBody } from "./ObjectView";

describe("universal object body editing", () => {
  it("edits the single plain-text block without changing its identity", () => {
    const object = createUniversalObject({
      id: "simple-document",
      blocks: [createTextBlock("До", "plain-block")]
    });

    expect(hasSimpleEditableBody(object)).toBe(true);
    expect(blocksAfterSimpleBodyEdit(object, "После")).toEqual([
      { ...object.blocks[0], text: "После" }
    ]);
  });

  it("preserves a structured document until the block editor is available", () => {
    const object = createUniversalObject({
      id: "structured-document",
      blocks: [
        { ...createTextBlock("Заголовок", "heading-block"), type: "heading" },
        createTextBlock("Абзац", "text-block")
      ]
    });

    expect(hasSimpleEditableBody(object)).toBe(false);
    expect(blocksAfterSimpleBodyEdit(object, "Склеенный текст")).toBe(object.blocks);
    expect(object.blocks.map((block) => block.text)).toEqual(["Заголовок", "Абзац"]);
  });
});
