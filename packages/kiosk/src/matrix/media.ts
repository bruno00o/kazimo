import { decryptAttachment } from "matrix-encrypt-attachment";
import type { MatrixClient } from "matrix-js-sdk";

export interface EncryptedFile {
  url: string;
  key: { alg: string; ext: boolean; k: string; key_ops: string[]; kty: string };
  iv: string;
  hashes: { [alg: string]: string };
  v: string;
}

const cache = new Map<string, string>();

async function fetchAuthed(client: MatrixClient, mxcUrl: string): Promise<ArrayBuffer | null> {
  const http = client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, true, true);
  if (!http) return null;
  const res = await fetch(http, {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
  });
  if (!res.ok) return null;
  return res.arrayBuffer();
}

export async function plainMediaUrl(client: MatrixClient, mxcUrl: string): Promise<string | null> {
  const hit = cache.get(mxcUrl);
  if (hit) return hit;
  const bytes = await fetchAuthed(client, mxcUrl);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes]));
  cache.set(mxcUrl, url);
  return url;
}

export async function encryptedMediaUrl(client: MatrixClient, file: EncryptedFile): Promise<string | null> {
  const hit = cache.get(file.url);
  if (hit) return hit;
  const bytes = await fetchAuthed(client, file.url);
  if (!bytes) return null;
  try {
    const clear = await decryptAttachment(bytes, file);
    const url = URL.createObjectURL(new Blob([clear]));
    cache.set(file.url, url);
    return url;
  } catch {
    return null;
  }
}
