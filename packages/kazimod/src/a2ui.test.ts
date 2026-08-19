import { describe, expect, test } from "bun:test";
import { decodeComposerReply } from "./a2ui";

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

describe("icon kind", () => {
  test("accepts a known icon name", () => {
    const reply = decodeComposerReply({ tree: { kind: "icon", name: "sun" } });
    expect(reply.tree).toEqual({ kind: "icon", name: "sun" });
  });

  test("rejects an unknown icon name", () => {
    expect(() => decodeComposerReply({ tree: { kind: "icon", name: "tornado" } })).toThrow();
  });
});
