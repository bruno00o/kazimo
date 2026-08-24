export const GRID_GAP = 6;
export const MAX_VISIBLE_TILES = 9;

export type Grid = {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
};

const gridShape = (count: number): { columns: number; rows: number } => {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 1, rows: 2 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 2, rows: 3 };
  return { columns: 3, rows: 3 };
};

export const visibleRemoteCount = (total: number): number => {
  if (total <= 1) return Math.max(total, 0);
  return Math.min(total, MAX_VISIBLE_TILES - 1);
};

export const gridFor = (count: number, width: number, height: number): Grid => {
  const tiles = Math.min(Math.max(count, 1), MAX_VISIBLE_TILES);
  const { columns, rows } = gridShape(tiles);
  return {
    columns,
    rows,
    tileWidth: Math.max(Math.floor((width - GRID_GAP * (columns + 1)) / columns), 0),
    tileHeight: Math.max(Math.floor((height - GRID_GAP * (rows + 1)) / rows), 0),
  };
};
