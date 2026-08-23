import type { ImageSource } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  getMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
  type MediaType,
  requestMediaLibraryPermissionsAsync,
} from "expo-image-picker";
import { type ISendEventResponse, type MatrixClient, MsgType } from "matrix-js-sdk";
import { Blurhash } from "react-native-blurhash";

const BEARER_PREFIX = "Bearer ";
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;
const BLURHASH_KEY = "xyz.amorgan.blurhash";
const PHOTO_COMPRESSION = 0.8;
const PHOTO_FILE_NAME = "photo.jpg";
const PHOTO_MEDIA_TYPES: MediaType[] = ["images"];
const PHOTO_MIME_TYPE = "image/jpeg";
const PICKER_QUALITY = 1;
const RESIZE_METHOD = "scale";
const ALLOW_DIRECT_LINKS = false;
const USE_AUTHENTICATION = true;
const NO_PROGRESS = 0;
const SMALLEST_SIDE = 1;

export const CHAT_THUMBNAIL_EDGE = 1024;
export const FULL_SCREEN_EDGE = 2048;
export const UPLOAD_LONG_EDGE = 2048;

export type Photo = { uri: string; width: number; height: number };

export type PhotoToSend = Photo & { blurhash: string | null };

export type BubbleSize = { width: number; height: number };

type PhotoInfo = {
  mimetype: string;
  size: number;
  w: number;
  h: number;
  [BLURHASH_KEY]?: string;
};

type PhotoEventContent = {
  msgtype: MsgType.Image;
  body: string;
  url: string;
  info: PhotoInfo;
};

export const authenticatedImageSource = (
  client: MatrixClient,
  mxc: string,
  width: number,
  height: number,
): ImageSource => {
  const uri = client.mxcUrlToHttp(
    mxc,
    width,
    height,
    RESIZE_METHOD,
    ALLOW_DIRECT_LINKS,
    undefined,
    USE_AUTHENTICATION,
  );
  const token = client.getAccessToken();
  return {
    uri: uri ?? undefined,
    headers: token === null ? undefined : { Authorization: `${BEARER_PREFIX}${token}` },
    cacheKey: `${mxc}:${width}x${height}`,
  };
};

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

export const pickPhoto = async (): Promise<Photo | null> => {
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
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
};

export const preparePhoto = async (uri: string): Promise<Photo> => {
  const context = ImageManipulator.manipulate(uri);
  const loaded = await context.renderAsync();
  const resize = longEdgeResize(loaded.width, loaded.height, UPLOAD_LONG_EDGE);
  const rendered = resize === null ? loaded : await context.resize(resize).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_COMPRESSION });
  return { uri: saved.uri, width: saved.width, height: saved.height };
};

export const blurhashOf = async (uri: string): Promise<string | null> => {
  try {
    return await Blurhash.encode(uri, BLURHASH_COMPONENTS_X, BLURHASH_COMPONENTS_Y);
  } catch {
    return null;
  }
};

export const photoContent = (mxc: string, size: number, photo: PhotoToSend): PhotoEventContent => {
  const info: PhotoInfo = { mimetype: PHOTO_MIME_TYPE, size, w: photo.width, h: photo.height };
  if (photo.blurhash !== null) info[BLURHASH_KEY] = photo.blurhash;
  return { msgtype: MsgType.Image, body: PHOTO_FILE_NAME, url: mxc, info };
};

export const sendPhoto = async (
  client: MatrixClient,
  roomId: string,
  photo: PhotoToSend,
  onProgress?: (fraction: number) => void,
): Promise<ISendEventResponse> => {
  const blob = await (await fetch(photo.uri)).blob();
  const uploaded = await client.uploadContent(blob, {
    type: PHOTO_MIME_TYPE,
    name: PHOTO_FILE_NAME,
    progressHandler:
      onProgress === undefined
        ? undefined
        : ({ loaded, total }) => onProgress(total > 0 ? loaded / total : NO_PROGRESS),
  });
  return client.sendMessage(roomId, photoContent(uploaded.content_uri, blob.size, photo));
};
