import { describe, expect, test } from "bun:test";
import { normalizePairingCode } from "@kazimo/shared";
import { isPairingCode, parsePairingQr, parsePairingReply } from "./pairing";

const FRAME = "@frame:matrix.example.org";
const CONTROL_ROOM = "!control:matrix.example.org";

const qr = (payload: Record<string, unknown>): string => JSON.stringify(payload);

describe("the shared code normalizer this screen relies on", () => {
  test("uppercases and strips what a human types between the groups", () => {
    expect(normalizePairingCode("a3fk-9z2m")).toBe("A3FK9Z2M");
    expect(normalizePairingCode("  A3FK 9Z2M  ")).toBe("A3FK9Z2M");
    expect(normalizePairingCode("A3FK9Z2M")).toBe("A3FK9Z2M");
  });
});

describe("isPairingCode", () => {
  test("accepts eight characters of the frame alphabet", () => {
    expect(isPairingCode("A3FK9Z2M")).toBe(true);
    expect(isPairingCode("22222222")).toBe(true);
  });

  test("rejects the wrong length", () => {
    expect(isPairingCode("")).toBe(false);
    expect(isPairingCode("A3FK9Z2")).toBe(false);
    expect(isPairingCode("A3FK9Z2MM")).toBe(false);
  });

  test("rejects the characters the frame never emits", () => {
    expect(isPairingCode("A3FK9Z2U")).toBe(false);
    expect(isPairingCode("A3FK9Z2I")).toBe(false);
    expect(isPairingCode("A3FK9Z20")).toBe(false);
    expect(isPairingCode("A3FK-9Z2M")).toBe(false);
  });
});

describe("parsePairingQr", () => {
  test("reads a frame payload", () => {
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: FRAME, c: "A3FK9Z2M" }))).toEqual({
      userId: FRAME,
      code: "A3FK9Z2M",
    });
  });

  test("normalizes the user id and the code", () => {
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: "frame:Matrix.Example.ORG", c: "a3fk-9z2m" }))).toEqual({
      userId: FRAME,
      code: "A3FK9Z2M",
    });
  });

  test("ignores extra fields", () => {
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: FRAME, c: "A3FK9Z2M", v: 2 }))).toEqual({
      userId: FRAME,
      code: "A3FK9Z2M",
    });
  });

  test("rejects anything that is not a frame payload", () => {
    expect(parsePairingQr("")).toBeNull();
    expect(parsePairingQr("not json")).toBeNull();
    expect(parsePairingQr("[]")).toBeNull();
    expect(parsePairingQr("null")).toBeNull();
    expect(parsePairingQr("https://example.org")).toBeNull();
    expect(parsePairingQr(qr({ k: "other", u: FRAME, c: "A3FK9Z2M" }))).toBeNull();
  });

  test("rejects a missing or malformed field", () => {
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: FRAME }))).toBeNull();
    expect(parsePairingQr(qr({ k: "kazimo-pair", c: "A3FK9Z2M" }))).toBeNull();
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: FRAME, c: 12345678 }))).toBeNull();
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: "frame", c: "A3FK9Z2M" }))).toBeNull();
    expect(parsePairingQr(qr({ k: "kazimo-pair", u: FRAME, c: "A3FK9Z2" }))).toBeNull();
  });
});

describe("parsePairingReply", () => {
  test("reads the control room of a success", () => {
    expect(parsePairingReply(`kazimo-paired ${CONTROL_ROOM}`)).toEqual({
      kind: "paired",
      controlRoomId: CONTROL_ROOM,
    });
    expect(parsePairingReply(`  kazimo-paired ${CONTROL_ROOM}  `)).toEqual({
      kind: "paired",
      controlRoomId: CONTROL_ROOM,
    });
  });

  test("reads a refusal", () => {
    expect(parsePairingReply("kazimo-pair-failed")).toEqual({ kind: "failed" });
    expect(parsePairingReply("kazimo-pair-failed unknown code")).toEqual({ kind: "failed" });
  });

  test("ignores an unrelated message", () => {
    expect(parsePairingReply("")).toEqual({ kind: "none" });
    expect(parsePairingReply("Ola!")).toEqual({ kind: "none" });
    expect(parsePairingReply("kazimo-pair A3FK9Z2M")).toEqual({ kind: "none" });
    expect(parsePairingReply("kazimo-paired")).toEqual({ kind: "none" });
  });

  test("ignores a success without a usable room id", () => {
    expect(parsePairingReply("kazimo-paired ")).toEqual({ kind: "none" });
    expect(parsePairingReply("kazimo-paired control")).toEqual({ kind: "none" });
    expect(parsePairingReply("kazimo-paired !control")).toEqual({ kind: "none" });
    expect(parsePairingReply("kazimo-paired !control matrix.example.org")).toEqual({ kind: "none" });
  });
});
