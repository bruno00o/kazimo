import type { PhotoRef } from "@kazimo/shared";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { type EncryptedFile, encryptedMediaUrl, plainMediaUrl } from "./media";

export async function photoFromEvent(client: MatrixClient, event: MatrixEvent): Promise<PhotoRef | null> {
  await client.decryptEventIfNeeded(event);
  if (event.getType() !== "m.room.message") return null;
  const content = event.getContent();
  if (content.msgtype !== "m.image") return null;

  const file = content.file as EncryptedFile | undefined;
  const mxcUrl = content.url as string | undefined;
  const url = file
    ? await encryptedMediaUrl(client, file)
    : mxcUrl
      ? await plainMediaUrl(client, mxcUrl)
      : null;
  if (!url) return null;

  const body = content.body as string | undefined;
  const caption = body && !/\.(jpe?g|png|gif|webp|heic)$/i.test(body) ? body : null;

  return {
    url,
    caption,
    sender: event.getSender() ?? null,
    timestamp: event.getTs(),
  };
}

export async function loadRecentPhotos(client: MatrixClient, room: Room, limit = 20): Promise<PhotoRef[]> {
  await client.scrollback(room, 100).catch(() => room);
  const events = room.getLiveTimeline().getEvents();
  const photos: PhotoRef[] = [];
  for (const event of [...events].reverse()) {
    if (photos.length >= limit) break;
    const photo = await photoFromEvent(client, event);
    if (photo) photos.push(photo);
  }
  return photos;
}
