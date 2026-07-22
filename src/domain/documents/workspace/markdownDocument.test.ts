import { describe, expect, it } from "vitest";
import {
  addPsozhId,
  parseMarkdownDocument,
  patchMarkdownMetadata,
  replaceMarkdownBody
} from "./markdownDocument";

describe("Markdown document frontmatter", () => {
  it("treats a file without initial frontmatter as an unmanaged body", () => {
    const source = "# Заголовок\n\nТекст";

    const document = parseMarkdownDocument(source);

    expect(document).toMatchObject({
      hasBom: false,
      lineEnding: "\n",
      rawPrefix: "",
      rawFrontmatter: null,
      body: source,
      bodyOffset: 0,
      frontmatterStatus: "absent",
      metadataEditable: true,
      metadata: { psozhId: null, tags: [], aliases: [] }
    });
  });

  it("reads supported scalar, inline and block forms with BOM and CRLF", () => {
    const source = [
      "\uFEFF---",
      "psozh-id: 'legacy:v12:note:one' # stable identity",
      "tags: [\"мысль\", работа, 'личное']",
      "aliases:",
      "  - \"Первое имя\"",
      "  - 'Второе имя'",
      "---",
      "Тело\r\nсо второй строкой"
    ].join("\r\n");

    const document = parseMarkdownDocument(source);

    expect(document.lineEnding).toBe("\r\n");
    expect(document.hasBom).toBe(true);
    expect(document.frontmatterStatus).toBe("valid");
    expect(document.metadata).toEqual({
      psozhId: "legacy:v12:note:one",
      tags: ["мысль", "работа", "личное"],
      aliases: ["Первое имя", "Второе имя"]
    });
    expect(document.body).toBe("Тело\r\nсо второй строкой");
    expect(document.rawPrefix + document.body).toBe(source);
    expect(document.rawFrontmatter).toContain("psozh-id: 'legacy:v12:note:one'");
  });

  it("accepts one scalar tag or alias and removes exact duplicates", () => {
    const source = "---\nНазвание свойства: сохранить\ntags: мысль\naliases: [Имя, Имя]\n---\nТекст";

    expect(parseMarkdownDocument(source).metadata).toEqual({
      psozhId: null,
      tags: ["мысль"],
      aliases: ["Имя"]
    });
  });

  it("fills an existing empty identity field instead of adding a duplicate key", () => {
    const source = "---\npsozh-id: null\nunknown: keep\n---\nBody";

    const result = addPsozhId(source, "doc-1");

    expect(result).toMatchObject({
      status: "ok",
      content: "---\npsozh-id: \"doc-1\"\nunknown: keep\n---\nBody"
    });
    if (result.status === "ok") {
      expect(result.document.frontmatterStatus).toBe("valid");
      expect(result.document.metadata.psozhId).toBe("doc-1");
    }
  });

  it("preserves the complete original prefix byte-for-byte when replacing a body", () => {
    const source = "\uFEFF---\r\n# comment\r\ncustom:  { keep: this }\r\ntags: [one]\r\n---\r\nСтарый текст";
    const parsed = parseMarkdownDocument(source);

    const result = replaceMarkdownBody(parsed, "Новый\r\nтекст");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.content).toBe(`${parsed.rawPrefix}Новый\r\nтекст`);
    expect(result.content.slice(0, parsed.rawPrefix.length)).toBe(parsed.rawPrefix);
    expect(result.document.metadata.tags).toEqual(["one"]);
  });

  it("still permits a body-only update when recognized metadata is too complex", () => {
    const source = "---\ntags: { nested: true }\nunknown: keep\n---\nДо";
    const parsed = parseMarkdownDocument(source);

    expect(parsed.frontmatterStatus).toBe("unsupported");
    const result = replaceMarkdownBody(parsed, "После");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.content).toBe("---\ntags: { nested: true }\nunknown: keep\n---\nПосле");
  });

  it("marks an unclosed initial frontmatter block malformed and blocks body replacement", () => {
    const source = "---\ntags: [one]\nТекст без закрывающего разделителя";
    const parsed = parseMarkdownDocument(source);

    expect(parsed).toMatchObject({
      frontmatterStatus: "malformed",
      metadataEditable: false,
      bodyOffset: null,
      rawPrefix: source
    });
    expect(replaceMarkdownBody(parsed, "Нельзя")).toMatchObject({
      status: "blocked",
      code: "malformed-frontmatter"
    });
  });

  it("keeps a closed but malformed YAML prefix intact during a body-only update", () => {
    const source = "---\nnot a property\n---\nДо";
    const parsed = parseMarkdownDocument(source);

    expect(parsed.frontmatterStatus).toBe("malformed");
    expect(replaceMarkdownBody(parsed, "После")).toMatchObject({
      status: "ok",
      content: "---\nnot a property\n---\nПосле"
    });
  });

  it("adds psozh-id immediately before the closing delimiter without reformatting anything", () => {
    const source = "\uFEFF---\r\n# keep this comment\r\ntitle:  Old formatting\r\ncustom:\r\n  nested: true\r\n---\r\nBody";

    const result = addPsozhId(source, "legacy:v12:note:one");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.content).toBe(
      "\uFEFF---\r\n# keep this comment\r\ntitle:  Old formatting\r\ncustom:\r\n  nested: true\r\npsozh-id: \"legacy:v12:note:one\"\r\n---\r\nBody"
    );
    expect(result.document.metadata.psozhId).toBe("legacy:v12:note:one");
  });

  it("creates a minimal frontmatter block for an unmanaged file and preserves its BOM and body", () => {
    const source = "\uFEFFПервая строка\r\nВторая";

    const result = addPsozhId(source, "doc-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.content).toBe(
      "\uFEFF---\r\npsozh-id: \"doc-1\"\r\n---\r\nПервая строка\r\nВторая"
    );
  });

  it("is idempotent for the same identity and refuses to replace another identity", () => {
    const source = "---\npsozh-id: existing\n---\nBody";

    expect(addPsozhId(source, "existing")).toMatchObject({
      status: "ok",
      content: source,
      changed: false
    });
    expect(addPsozhId(source, "different")).toMatchObject({
      status: "blocked",
      code: "identity-conflict"
    });
  });

  it("patches only requested metadata and preserves unknown properties, comments, order and body", () => {
    const source = [
      "---",
      "# leading comment",
      "unknown:  keep-format",
      "tags:",
      "  - old",
      "tail: yes",
      "---",
      "Body"
    ].join("\n");

    const result = patchMarkdownMetadata(source, {
      tags: ["new", "new", "second"],
      aliases: ["Alias"]
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.content).toBe([
      "---",
      "# leading comment",
      "unknown:  keep-format",
      "tags: [\"new\", \"second\"]",
      "tail: yes",
      "aliases: [\"Alias\"]",
      "---",
      "Body"
    ].join("\n"));
    expect(result.document.metadata).toMatchObject({
      tags: ["new", "second"],
      aliases: ["Alias"]
    });
  });

  it("creates frontmatter for a metadata patch without changing the old body", () => {
    const result = patchMarkdownMetadata("Body", { tags: ["one"] });

    expect(result).toMatchObject({
      status: "ok",
      content: "---\ntags: [\"one\"]\n---\nBody"
    });
  });

  it("blocks every metadata mutation for malformed or unsupported frontmatter", () => {
    const malformed = "---\ntags: [one]\ntags: [two]\n---\nBody";
    const unsupported = "---\naliases: { short: Long }\n---\nBody";

    expect(parseMarkdownDocument(malformed).frontmatterStatus).toBe("malformed");
    expect(addPsozhId(malformed, "doc-1")).toMatchObject({
      status: "blocked",
      code: "malformed-frontmatter"
    });
    expect(patchMarkdownMetadata(malformed, { tags: ["safe"] })).toMatchObject({
      status: "blocked",
      code: "malformed-frontmatter"
    });
    expect(parseMarkdownDocument(unsupported).frontmatterStatus).toBe("unsupported");
    expect(addPsozhId(unsupported, "doc-1")).toMatchObject({
      status: "blocked",
      code: "unsupported-metadata"
    });
    expect(patchMarkdownMetadata(unsupported, { aliases: ["safe"] })).toMatchObject({
      status: "blocked",
      code: "unsupported-metadata"
    });
  });

  it("rejects empty or multiline identity and metadata values", () => {
    expect(addPsozhId("Body", "  ")).toMatchObject({
      status: "blocked",
      code: "invalid-value"
    });
    expect(addPsozhId("Body", "one\ntwo")).toMatchObject({
      status: "blocked",
      code: "invalid-value"
    });
    expect(patchMarkdownMetadata("Body", { tags: ["one\ntwo"] })).toMatchObject({
      status: "blocked",
      code: "invalid-value"
    });
  });
});
