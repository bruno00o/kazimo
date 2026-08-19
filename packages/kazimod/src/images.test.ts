import { describe, expect, test } from "bun:test";
import type { ComposerNode } from "./a2ui";
import { resolveComposerTree } from "./images";

const find = async (query: string) => (query === "seguro" ? "https://example.com/seguro.jpg" : null);
const cache = async (url: string) => (url === "https://example.com/seguro.jpg" ? "/img/abc.webp" : null);

describe("resolveComposerTree", () => {
  test("resolves an image query to a cached local url", async () => {
    const tree: ComposerNode = { kind: "image", query: "seguro", caption: "o presidente" };
    const resolved = await resolveComposerTree(tree, find, cache);
    expect(resolved).toEqual({ kind: "image", url: "/img/abc.webp", caption: "o presidente" });
  });

  test("drops an image whose query finds nothing and empties its parent", async () => {
    const tree: ComposerNode = { kind: "card", children: [{ kind: "image", query: "unknown" }] };
    expect(await resolveComposerTree(tree, find, cache)).toBeNull();
  });

  test("keeps siblings when one image is dropped", async () => {
    const tree: ComposerNode = {
      kind: "column",
      children: [
        { kind: "text", text: "kept" },
        { kind: "image", query: "unknown" },
      ],
    };
    const resolved = await resolveComposerTree(tree, find, cache);
    expect(resolved).toEqual({ kind: "column", children: [{ kind: "text", text: "kept" }] });
  });

  test("leaves trees without images untouched", async () => {
    const tree: ComposerNode = { kind: "number", value: "21", label: "today" };
    expect(await resolveComposerTree(tree, find, cache)).toEqual(tree);
  });
});
