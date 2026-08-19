import { describe, expect, test } from "bun:test";
import type { A2uiNode } from "@kazimo/shared";
import { imageUrlsIn, resolveImages } from "./images";

const ALLOWED = "https://example.com/photos/bridge.jpg";
const fakeResolver = async (url: string) => (url === ALLOWED ? "/img/abc.webp" : null);

describe("imageUrlsIn", () => {
  test("extracts urls from tool reports", () => {
    const urls = imageUrlsIn([
      `ImageSearch: a bridge at sunset: ${ALLOWED} | another: https://example.com/b.png`,
      "Weather: 21C, sunny",
    ]);
    expect(urls.has(ALLOWED)).toBe(true);
    expect(urls.has("https://example.com/b.png")).toBe(true);
    expect(urls.size).toBe(2);
  });
});

describe("resolveImages", () => {
  test("rewrites an allowed image to its local url", async () => {
    const tree: A2uiNode = { kind: "image", url: ALLOWED, caption: "the bridge" };
    const resolved = await resolveImages(tree, new Set([ALLOWED]), fakeResolver);
    expect(resolved).toEqual({ kind: "image", url: "/img/abc.webp", caption: "the bridge" });
  });

  test("drops an image whose url is not in the reports", async () => {
    const tree: A2uiNode = {
      kind: "column",
      children: [
        { kind: "text", text: "kept" },
        { kind: "image", url: "https://model-invented.example/x.jpg" },
      ],
    };
    const resolved = await resolveImages(tree, new Set([ALLOWED]), fakeResolver);
    expect(resolved).toEqual({ kind: "column", children: [{ kind: "text", text: "kept" }] });
  });

  test("drops an image whose download fails and empty parents with it", async () => {
    const failing = "https://example.com/gone.jpg";
    const tree: A2uiNode = { kind: "card", children: [{ kind: "image", url: failing }] };
    const resolved = await resolveImages(tree, new Set([failing]), async () => null);
    expect(resolved).toBeNull();
  });

  test("leaves trees without images untouched", async () => {
    const tree: A2uiNode = { kind: "number", value: "21", label: "today" };
    expect(await resolveImages(tree, new Set(), fakeResolver)).toEqual(tree);
  });
});
