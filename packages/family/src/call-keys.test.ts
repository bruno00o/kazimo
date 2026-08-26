import { describe, expect, test } from "bun:test";
import {
  CallKeyStore,
  decodeBase64,
  encodeBase64,
  OWN_KEY_INDEX,
  ownKeyContent,
  type ParticipantKey,
  parseKeyMessage,
  participantIdentity,
  RECEIVE_KEYS_CAPABILITY,
  SEND_KEYS_CAPABILITY,
  splitIdentity,
} from "./call-keys";

const ROOM_ID = "!room:kazimo.test";
const SENDER = "@frame:kazimo.test";
const DEVICE = "FRAMEDEVICE";
const KEY_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

const message = (overrides: Record<string, unknown> = {}, content: Record<string, unknown> = {}) => ({
  type: "io.element.call.encryption_keys",
  sender: SENDER,
  content: {
    keys: { index: 3, key: encodeBase64(KEY_BYTES) },
    room_id: ROOM_ID,
    member: { id: `${SENDER}:${DEVICE}`, claimed_device_id: DEVICE },
    session: { call_id: "", application: "m.call", scope: "m.room" },
    sent_ts: 1,
    ...content,
  },
  ...overrides,
});

describe("base64", () => {
  test("round trips arbitrary byte lengths", () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = (index * 37 + 11) % 256;
      const decoded = decodeBase64(encodeBase64(bytes));
      expect(decoded).not.toBeNull();
      expect([...(decoded as Uint8Array)]).toEqual([...bytes]);
    }
  });

  test("matches known vectors", () => {
    expect(encodeBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect([...(decodeBase64("aGk=") as Uint8Array)]).toEqual([104, 105]);
    expect([...(decodeBase64("aGk") as Uint8Array)]).toEqual([104, 105]);
  });

  test("accepts base64url and rejects junk", () => {
    const bytes = new Uint8Array([251, 255, 190]);
    const standard = encodeBase64(bytes);
    const url = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect([...(decodeBase64(url) as Uint8Array)]).toEqual([...bytes]);
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("aGkga")).toBeNull();
  });
});

describe("identities", () => {
  test("builds and splits the livekit identity", () => {
    const identity = participantIdentity(SENDER, DEVICE);
    expect(identity).toBe("@frame:kazimo.test:FRAMEDEVICE");
    expect(splitIdentity(identity)).toEqual({ userId: SENDER, deviceId: DEVICE });
  });

  test("rejects identities that are not user plus device", () => {
    expect(splitIdentity("deadbeefdeadbeef")).toBeNull();
    expect(splitIdentity("@frame:kazimo.test")).toBeNull();
    expect(splitIdentity("@frame:kazimo.test:")).toBeNull();
    expect(splitIdentity(":FRAMEDEVICE")).toBeNull();
  });
});

describe("capability strings", () => {
  test("target the encryption keys event type", () => {
    expect(RECEIVE_KEYS_CAPABILITY).toBe(
      "org.matrix.msc3819.receive.to_device:io.element.call.encryption_keys",
    );
    expect(SEND_KEYS_CAPABILITY).toBe("org.matrix.msc3819.send.to_device:io.element.call.encryption_keys");
  });
});

describe("parseKeyMessage", () => {
  test("accepts a well formed element call key", () => {
    const parsed = parseKeyMessage(ROOM_ID, message());
    expect(parsed).not.toBeNull();
    expect(parsed?.userId).toBe(SENDER);
    expect(parsed?.deviceId).toBe(DEVICE);
    expect(parsed?.identity).toBe("@frame:kazimo.test:FRAMEDEVICE");
    expect(parsed?.index).toBe(3);
    expect([...(parsed as ParticipantKey).key]).toEqual([...KEY_BYTES]);
  });

  test("accepts a key with index zero and no room id", () => {
    const parsed = parseKeyMessage(
      ROOM_ID,
      message({}, { room_id: undefined, keys: { index: 0, key: "aGk=" } }),
    );
    expect(parsed?.index).toBe(0);
  });

  test("drops another room, another event type and cleartext delivery", () => {
    expect(parseKeyMessage("!other:kazimo.test", message())).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({ type: "m.room.message" }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({ encrypted: false }))).toBeNull();
  });

  test("drops malformed content", () => {
    expect(parseKeyMessage(ROOM_ID, null)).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({ sender: 42 }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({ sender: "frame:kazimo.test" }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({ content: "nope" }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: undefined }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: 1 } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: "1", key: "aGk=" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: 1.5, key: "aGk=" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: -1, key: "aGk=" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: 256, key: "aGk=" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: 0, key: "" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { keys: { index: 0, key: "!!!" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { member: undefined }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { member: { id: "x" } }))).toBeNull();
    expect(parseKeyMessage(ROOM_ID, message({}, { member: { claimed_device_id: "" } }))).toBeNull();
  });
});

describe("ownKeyContent", () => {
  test("mirrors the element call to-device shape and round trips through the parser", () => {
    const content = ownKeyContent(ROOM_ID, "@phone:kazimo.test", "PHONEDEVICE", KEY_BYTES);
    expect(content.session).toEqual({ call_id: "", application: "m.call", scope: "m.room" });
    expect(content.member).toEqual({
      id: "@phone:kazimo.test:PHONEDEVICE",
      claimed_device_id: "PHONEDEVICE",
    });
    expect(content.keys).toEqual({ index: OWN_KEY_INDEX, key: encodeBase64(KEY_BYTES) });

    const parsed = parseKeyMessage(ROOM_ID, {
      type: "io.element.call.encryption_keys",
      sender: "@phone:kazimo.test",
      content,
    });
    expect(parsed?.identity).toBe("@phone:kazimo.test:PHONEDEVICE");
    expect(parsed?.index).toBe(OWN_KEY_INDEX);
    expect([...(parsed as ParticipantKey).key]).toEqual([...KEY_BYTES]);
  });
});

describe("CallKeyStore", () => {
  const keyOf = (index: number, identity = "@frame:kazimo.test:FRAMEDEVICE") => ({
    userId: SENDER,
    deviceId: DEVICE,
    identity,
    index,
    key: KEY_BYTES,
  });

  test("replays keys that arrived before the media session attached", () => {
    const store = new CallKeyStore();
    store.add(keyOf(0));
    store.add(keyOf(1));
    const applied: number[] = [];
    store.attach((key) => applied.push(key.index));
    expect(applied).toEqual([0, 1]);
  });

  test("forwards keys that arrive after attaching", () => {
    const store = new CallKeyStore();
    const applied: number[] = [];
    store.attach((key) => applied.push(key.index));
    store.add(keyOf(2));
    expect(applied).toEqual([2]);
  });

  test("keeps the newest key per identity and index", () => {
    const store = new CallKeyStore();
    store.add(keyOf(0));
    store.add({ ...keyOf(0), key: new Uint8Array([9]) });
    store.add(keyOf(0, "@other:kazimo.test:OTHER"));
    expect(store.count).toBe(2);
    const applied: Uint8Array[] = [];
    store.attach((key) => applied.push(key.key));
    expect([...(applied[0] as Uint8Array)]).toEqual([9]);
  });

  test("stops forwarding once detached", () => {
    const store = new CallKeyStore();
    const applied: number[] = [];
    store.attach((key) => applied.push(key.index));
    store.detach();
    store.add(keyOf(4));
    expect(applied).toEqual([]);
  });
});
