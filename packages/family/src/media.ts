import { type ClientLike, MediaSource } from "@unomed/react-native-matrix-sdk";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  getMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
  type MediaType,
  requestMediaLibraryPermissionsAsync,
} from "expo-image-picker";
import { Blurhash } from "react-native-blurhash";

const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;
const CACHE_DIRECTORY = "matrix-media";
const FULL_SIZE_KEY = "full";
const PHOTO_COMPRESSION = 0.8;
const PHOTO_MEDIA_TYPES: MediaType[] = ["images"];
const PHOTO_MIME_TYPE = "image/jpeg";
const PICKER_QUALITY = 1;
const SMALLEST_SIDE = 1;
const UNSAFE_KEY_CHARACTERS = /[^a-zA-Z0-9]+/g;
const KEY_SEPARATOR = "-";
const USE_MEDIA_CACHE = true;

export const CHAT_THUMBNAIL_EDGE = 1024;
export const FULL_SCREEN_EDGE = 2048;
export const UPLOAD_LONG_EDGE = 2048;

export type Photo = { uri: string; width: number; height: number; size: number };

export type PhotoToSend = Photo & { blurhash: string | null };

export type BubbleSize = { width: number; height: number };

export type MediaRef = { mxc: string; json: string | null };

export const fitWithin = (
  width: number | null,
  height: number | null,
  maxWidth: number,
  maxHeight: number,
): BubbleSize => {
  if (width === null || height === null || width <= 0 || height <= 0) {
    const side = Math.min(maxWidth, maxHeight);
    return { width: side, height: side };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(Math.round(width * scale), SMALLEST_SIDE),
    height: Math.max(Math.round(height * scale), SMALLEST_SIDE),
  };
};

export const longEdgeResize = (
  width: number,
  height: number,
  maxLongEdge: number,
): { width?: number; height?: number } | null => {
  if (width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= maxLongEdge) return null;
  return width >= height ? { width: maxLongEdge } : { height: maxLongEdge };
};

export const mediaCacheKey = (mxc: string, edge: number | null): string => {
  const sanitized = mxc.replace(UNSAFE_KEY_CHARACTERS, KEY_SEPARATOR).replace(/^-|-$/g, "");
  return `${sanitized}${KEY_SEPARATOR}${edge === null ? FULL_SIZE_KEY : edge}`;
};

export const localPathOf = (uri: string): string => uri.replace(/^file:\/\//, "");

export const pickPhoto = async (): Promise<{ uri: string } | null> => {
  const current = await getMediaLibraryPermissionsAsync();
  const permission = current.granted ? current : await requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await launchImageLibraryAsync({
    mediaTypes: PHOTO_MEDIA_TYPES,
    quality: PICKER_QUALITY,
    exif: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? { uri: asset.uri } : null;
};

export const preparePhoto = async (uri: string): Promise<Photo> => {
  const context = ImageManipulator.manipulate(uri);
  const loaded = await context.renderAsync();
  const resize = longEdgeResize(loaded.width, loaded.height, UPLOAD_LONG_EDGE);
  const rendered = resize === null ? loaded : await context.resize(resize).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_COMPRESSION });
  return { uri: saved.uri, width: saved.width, height: saved.height, size: new File(saved.uri).size };
};

export const blurhashOf = async (uri: string): Promise<string | null> => {
  try {
    return await Blurhash.encode(uri, BLURHASH_COMPONENTS_X, BLURHASH_COMPONENTS_Y);
  } catch {
    return null;
  }
};

const cacheFile = (mxc: string, edge: number | null): File => {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, mediaCacheKey(mxc, edge));
};

const sourceOf = (ref: MediaRef) =>
  ref.json === null ? MediaSource.fromUrl(ref.mxc) : MediaSource.fromJson(ref.json);

export const photoUri = async (client: ClientLike, ref: MediaRef, edge: number | null): Promise<string> => {
  const file = cacheFile(ref.mxc, edge);
  if (file.exists) return file.uri;
  const source = sourceOf(ref);

  if (edge === null) {
    const handle = await client.getMediaFile(source, undefined, PHOTO_MIME_TYPE, USE_MEDIA_CACHE, undefined);
    if (handle.persist(localPathOf(file.uri))) return file.uri;
    file.write(new Uint8Array(await client.getMediaContent(source)));
    return file.uri;
  }

  const thumbnail = await client.getMediaThumbnail(source, BigInt(edge), BigInt(edge));
  file.write(new Uint8Array(thumbnail));
  return file.uri;
};
