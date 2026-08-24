import { describe, expect, test } from "bun:test";
import {
  codesMatch,
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  pairingQrPayload,
} from "@kazimo/shared";
import { generatePairingCode } from "./pairing";

const SAMPLE_SIZE = 500;

describe("generatePairingCode", () => {
  test("returns eight characters from the unambiguous alphabet", () => {
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const code = generatePairingCode();
      expect(code.length).toBe(PAIRING_CODE_LENGTH);
      for (const char of code) expect(PAIRING_CODE_ALPHABET).toContain(char);
    }
  });

  test("never emits a character a reader could confuse", () => {
    const banned = new Set(["0", "O", "1", "I", "L", "U"]);
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      for (const char of generatePairingCode()) expect(banned.has(char)).toBe(false);
    }
  });

  test("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) seen.add(generatePairingCode());
    expect(seen.size).toBe(SAMPLE_SIZE);
  });

  test("covers the whole alphabet over many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      for (const char of generatePairingCode()) seen.add(char);
    }
    expect(seen.size).toBe(PAIRING_CODE_ALPHABET.length);
  });
});

describe("normalizePairingCode", () => {
  test("strips dashes and spaces and uppercases", () => {
    expect(normalizePairingCode(" k7m2-qrvx ")).toBe("K7M2QRVX");
  });

  test("keeps confusable characters out instead of aliasing them", () => {
    expect(normalizePairingCode("OIL")).toBe("OIL");
    expect(codesMatch("OIL23456", "01123456")).toBe(false);
  });

  test("leaves an already normal code untouched", () => {
    expect(normalizePairingCode("K7M2QRVX")).toBe("K7M2QRVX");
  });
});

describe("formatPairingCode", () => {
  test("groups a generated code in two halves", () => {
    expect(formatPairingCode("K7M2QRVX")).toBe("K7M2-QRVX");
  });

  test("regroups a code that arrived formatted", () => {
    expect(formatPairingCode("k7m2-qrvx")).toBe("K7M2-QRVX");
  });

  test("leaves a short code ungrouped", () => {
    expect(formatPairingCode("K7M")).toBe("K7M");
  });
});

describe("codesMatch", () => {
  test("ignores case and dashes", () => {
    const code = generatePairingCode();
    expect(codesMatch(formatPairingCode(code).toLowerCase(), code)).toBe(true);
  });

  test("rejects a different code", () => {
    expect(codesMatch("K7M2QRVX", "K7M2QRVY")).toBe(false);
  });

  test("rejects an empty or truncated attempt", () => {
    expect(codesMatch("", "")).toBe(false);
    expect(codesMatch("K7M2", "K7M2")).toBe(false);
  });
});

describe("pairingQrPayload", () => {
  test("emits the exact contract keys in order", () => {
    expect(pairingQrPayload("@kazimo:example.org", "k7m2-qrvx")).toBe(
      '{"k":"kazimo-pair","u":"@kazimo:example.org","c":"K7M2QRVX"}',
    );
  });
});
