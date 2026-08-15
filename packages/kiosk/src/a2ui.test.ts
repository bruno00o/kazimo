/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { A2uiNode } from "@kazimo/shared";
import { pruneTree } from "./a2ui";

const column = (...children: A2uiNode[]): A2uiNode => ({ kind: "column", children });
const card = (...children: A2uiNode[]): A2uiNode => ({ kind: "card", children });
const row = (...children: A2uiNode[]): A2uiNode => ({ kind: "row", children });
const text = (value: string): A2uiNode => ({ kind: "text", text: value });

describe("pruneTree", () => {
  test("drops containers nested deeper than three levels", () => {
    const tree = column(card(row(column(text("too deep")), text("kept"))));
    expect(pruneTree(tree)).toEqual(column(card(row(text("kept")))));
  });

  test("caps rows at two content children", () => {
    const tree = row(text("one"), text("two"), text("three"));
    expect(pruneTree(tree)).toEqual(row(text("one"), text("two")));
  });

  test("keeps a divider between two row children but not after", () => {
    const divider: A2uiNode = { kind: "divider" };
    const tree = row(text("min"), divider, text("max"), divider, text("extra"));
    expect(pruneTree(tree)).toEqual(row(text("min"), divider, text("max")));
  });

  test("caps the total number of leaves", () => {
    const tree = column(...Array.from({ length: 20 }, (_, i) => text(`item ${i}`)));
    const pruned = pruneTree(tree);
    expect(pruned?.kind).toBe("column");
    if (pruned?.kind === "column") expect(pruned.children.length).toBe(12);
  });

  test("caps list items", () => {
    const tree: A2uiNode = { kind: "list", items: Array.from({ length: 10 }, (_, i) => `line ${i}`) };
    const pruned = pruneTree(tree);
    if (pruned?.kind === "list") expect(pruned.items.length).toBe(6);
    else throw new Error("expected a list");
  });

  test("drops containers left empty by pruning", () => {
    const tree = column(card(row(column(text("too deep")))));
    expect(pruneTree(tree)).toBeNull();
  });

  test("keeps a simple tree untouched", () => {
    const tree = column(text("hello"), { kind: "divider" }, text("world"));
    expect(pruneTree(tree)).toEqual(tree);
  });
});
