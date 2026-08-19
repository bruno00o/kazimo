import { createHash } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import type { A2uiNode } from "@kazimo/shared";
import sharp from "sharp";

export const IMAGE_CACHE_DIR = `${process.env.HOME}/.kazimo/cache/images`;
export const IMAGE_ROUTE_PREFIX = "/img/";

const FETCH_TIMEOUT_MS = 8000;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 1280;
const WEBP_QUALITY = 82;
const CACHE_MAX_FILES = 300;

const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'<>|)\]]+/g;

export const ensureImageCacheDir = () => mkdir(IMAGE_CACHE_DIR, { recursive: true });

export function imageUrlsIn(reports: string[]): Set<string> {
  const urls = new Set<string>();
  for (const report of reports) {
    for (const match of report.matchAll(IMAGE_URL_PATTERN)) {
      urls.add(match[0]);
    }
  }
  return urls;
}

const fileFor = (url: string) => `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.webp`;

async function evictOldest() {
  const entries = await readdir(IMAGE_CACHE_DIR).catch(() => []);
  if (entries.length <= CACHE_MAX_FILES) return;
  const dated = await Promise.all(
    entries.map(async (name) => ({
      name,
      mtime: await stat(`${IMAGE_CACHE_DIR}/${name}`).then(
        (s) => s.mtimeMs,
        () => 0,
      ),
    })),
  );
  dated.sort((a, b) => a.mtime - b.mtime);
  for (const { name } of dated.slice(0, entries.length - CACHE_MAX_FILES)) {
    await unlink(`${IMAGE_CACHE_DIR}/${name}`).catch(() => {});
  }
}

export async function cacheImage(url: string): Promise<string | null> {
  const file = fileFor(url);
  const path = `${IMAGE_CACHE_DIR}/${file}`;
  if (await Bun.file(path).exists()) return IMAGE_ROUTE_PREFIX + file;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD_BYTES) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) return null;
    const resized = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    await Bun.write(path, resized);
    void evictOldest();
    return IMAGE_ROUTE_PREFIX + file;
  } catch {
    return null;
  }
}

export type ImageResolver = (url: string) => Promise<string | null>;

export async function resolveImages(
  node: A2uiNode,
  allowed: Set<string>,
  resolve: ImageResolver,
): Promise<A2uiNode | null> {
  if (node.kind === "image") {
    if (!allowed.has(node.url)) return null;
    const local = await resolve(node.url);
    return local ? { ...node, url: local } : null;
  }
  if (node.kind === "card" || node.kind === "row" || node.kind === "column") {
    const children = await Promise.all(node.children.map((child) => resolveImages(child, allowed, resolve)));
    const kept = children.filter((child): child is A2uiNode => child !== null);
    return kept.length ? { ...node, children: kept } : null;
  }
  return node;
}

export async function serveCachedImage(pathname: string): Promise<Response | null> {
  const file = pathname.slice(IMAGE_ROUTE_PREFIX.length);
  if (!/^[a-f0-9]{24}\.webp$/.test(file)) return null;
  const cached = Bun.file(`${IMAGE_CACHE_DIR}/${file}`);
  if (!(await cached.exists())) return null;
  return new Response(cached, {
    headers: { "content-type": "image/webp", "cache-control": "max-age=86400" },
  });
}
