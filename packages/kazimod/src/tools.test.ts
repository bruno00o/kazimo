import { describe, expect, test } from "bun:test";
import type { Contact } from "@kazimo/shared";
import { itemImage, matchContacts } from "./tools";

describe("itemImage", () => {
  test("finds an enclosure image", () => {
    const item = `<item><title>t</title><enclosure url="https://ex.com/a.jpg" type="image/jpeg"/></item>`;
    expect(itemImage(item)).toBe("https://ex.com/a.jpg");
  });

  test("finds a media:content image by extension", () => {
    const item = `<item><media:content url="https://ex.com/b.png" width="640"/></item>`;
    expect(itemImage(item)).toBe("https://ex.com/b.png");
  });

  test("finds a media:content image by medium attribute", () => {
    const item = `<item><media:content medium="image" url="https://ex.com/c"/></item>`;
    expect(itemImage(item)).toBe("https://ex.com/c");
  });

  test("returns null when the item has no image", () => {
    expect(itemImage("<item><title>t</title></item>")).toBeNull();
  });

  test("ignores audio enclosures", () => {
    const item = `<item><enclosure url="https://ex.com/a.mp3" type="audio/mpeg"/></item>`;
    expect(itemImage(item)).toBeNull();
  });
});

describe("itemImage rtp style", () => {
  test("finds a plain img src and decodes entities", () => {
    const item = `<item><title>t</title><img src="https://cdn.ex.pt/a?w=350&amp;q=50"/></item>`;
    expect(itemImage(item)).toBe("https://cdn.ex.pt/a?w=350&q=50");
  });
});

describe("matchContacts", () => {
  const contacts: Contact[] = [
    { userId: "@joao:ex.pt", displayName: "João Silva", roomId: "!a" },
    { userId: "@maria:ex.pt", displayName: "Maria", roomId: "!b" },
    { userId: "@mariana:ex.pt", displayName: "Mariana", roomId: "!c" },
  ];

  test("matches ignoring case and diacritics", () => {
    expect(matchContacts(contacts, "joao silva").map((c) => c.userId)).toEqual(["@joao:ex.pt"]);
  });

  test("matches by first name", () => {
    expect(matchContacts(contacts, "João").map((c) => c.userId)).toEqual(["@joao:ex.pt"]);
  });

  test("prefers an exact name over a partial one", () => {
    expect(matchContacts(contacts, "maria").map((c) => c.userId)).toEqual(["@maria:ex.pt"]);
  });

  test("returns every partial match when nothing is exact", () => {
    expect(matchContacts(contacts, "mari").map((c) => c.userId)).toEqual(["@maria:ex.pt", "@mariana:ex.pt"]);
  });

  test("returns nothing for an unknown or empty name", () => {
    expect(matchContacts(contacts, "Rui")).toEqual([]);
    expect(matchContacts(contacts, "  ")).toEqual([]);
  });
});
