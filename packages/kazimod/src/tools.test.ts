import { describe, expect, test } from "bun:test";
import { itemImage } from "./tools";

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
