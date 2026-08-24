import { describe, expect, test } from "bun:test";
import { GRID_GAP, gridFor, MAX_VISIBLE_TILES, visibleRemoteCount } from "./callLayout";

const WIDTH = 390;
const HEIGHT = 844;

const shapeOf = (count: number) => {
  const grid = gridFor(count, WIDTH, HEIGHT);
  return { columns: grid.columns, rows: grid.rows };
};

describe("gridFor", () => {
  test("a single tile fills the container", () => {
    expect(shapeOf(1)).toEqual({ columns: 1, rows: 1 });
  });

  test("two tiles stack in two rows", () => {
    expect(shapeOf(2)).toEqual({ columns: 1, rows: 2 });
  });

  test("three and four tiles use a square of four", () => {
    expect(shapeOf(3)).toEqual({ columns: 2, rows: 2 });
    expect(shapeOf(4)).toEqual({ columns: 2, rows: 2 });
  });

  test("five and six tiles use two columns of three rows", () => {
    expect(shapeOf(5)).toEqual({ columns: 2, rows: 3 });
    expect(shapeOf(6)).toEqual({ columns: 2, rows: 3 });
  });

  test("seven to nine tiles use a square of nine", () => {
    expect(shapeOf(7)).toEqual({ columns: 3, rows: 3 });
    expect(shapeOf(8)).toEqual({ columns: 3, rows: 3 });
    expect(shapeOf(9)).toEqual({ columns: 3, rows: 3 });
  });

  test("more tiles than the cap stay on the square of nine", () => {
    expect(shapeOf(MAX_VISIBLE_TILES + 1)).toEqual({ columns: 3, rows: 3 });
    expect(shapeOf(40)).toEqual({ columns: 3, rows: 3 });
  });

  test("an empty grid falls back to a single tile", () => {
    expect(shapeOf(0)).toEqual({ columns: 1, rows: 1 });
  });

  test("tiles fill the container minus the gaps around and between them", () => {
    const grid = gridFor(4, WIDTH, HEIGHT);
    expect(grid.tileWidth).toBe((WIDTH - GRID_GAP * 3) / 2);
    expect(grid.tileHeight).toBe((HEIGHT - GRID_GAP * 3) / 2);
    expect(grid.tileWidth * grid.columns + GRID_GAP * (grid.columns + 1)).toBe(WIDTH);
    expect(grid.tileHeight * grid.rows + GRID_GAP * (grid.rows + 1)).toBe(HEIGHT);
  });

  test("no grid overflows the container, and none wastes more than a pixel per tile", () => {
    for (let count = 1; count <= MAX_VISIBLE_TILES; count += 1) {
      const grid = gridFor(count, WIDTH, HEIGHT);
      const used = grid.tileWidth * grid.columns + GRID_GAP * (grid.columns + 1);
      const stacked = grid.tileHeight * grid.rows + GRID_GAP * (grid.rows + 1);
      expect(used).toBeLessThanOrEqual(WIDTH);
      expect(used).toBeGreaterThan(WIDTH - grid.columns);
      expect(stacked).toBeLessThanOrEqual(HEIGHT);
      expect(stacked).toBeGreaterThan(HEIGHT - grid.rows);
    }
  });

  test("tiles never take a negative size in a container smaller than its gaps", () => {
    const grid = gridFor(9, 8, 8);
    expect(grid.tileWidth).toBe(0);
    expect(grid.tileHeight).toBe(0);
  });
});

describe("visibleRemoteCount", () => {
  test("keeps every remote while the local tile is a medallion", () => {
    expect(visibleRemoteCount(0)).toBe(0);
    expect(visibleRemoteCount(1)).toBe(1);
  });

  test("keeps every remote up to the cap left by the local tile", () => {
    expect(visibleRemoteCount(2)).toBe(2);
    expect(visibleRemoteCount(5)).toBe(5);
    expect(visibleRemoteCount(8)).toBe(8);
  });

  test("drops the remotes that no longer fit next to the local tile", () => {
    expect(visibleRemoteCount(9)).toBe(8);
    expect(visibleRemoteCount(30)).toBe(8);
  });

  test("never returns a negative count", () => {
    expect(visibleRemoteCount(-3)).toBe(0);
  });
});
