import { describe, expect, test } from "bun:test";
import type { A2uiNode } from "@kazimo/shared";
import { decodeComposerReply, withoutImages } from "./a2ui";

describe("decodeComposerReply", () => {
  test("accepts a valid tree", () => {
    const reply = decodeComposerReply({
      tree: {
        kind: "card",
        children: [
          { kind: "number", value: "23", label: "today" },
          { kind: "list", items: ["one", "two"] },
        ],
      },
    });
    expect(reply.tree?.kind).toBe("card");
  });

  test("accepts a null tree", () => {
    expect(decodeComposerReply({ tree: null }).tree).toBeNull();
  });

  test("rejects an unknown kind", () => {
    expect(() => decodeComposerReply({ tree: { kind: "chart", values: [1, 2] } })).toThrow();
  });

  test("rejects a missing field", () => {
    expect(() => decodeComposerReply({ tree: { kind: "title" } })).toThrow();
  });
});

describe("withoutImages", () => {
  test("removes image nodes and empty parents", () => {
    const tree: A2uiNode = {
      kind: "column",
      children: [
        { kind: "text", text: "kept" },
        { kind: "card", children: [{ kind: "image", url: "https://example.com/a.jpg" }] },
      ],
    };
    expect(withoutImages(tree)).toEqual({ kind: "column", children: [{ kind: "text", text: "kept" }] });
  });

  test("returns null when only images remain", () => {
    expect(withoutImages({ kind: "image", url: "https://example.com/a.jpg" })).toBeNull();
  });
});
