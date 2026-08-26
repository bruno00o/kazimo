import { describe, expect, test } from "bun:test";
import { ApnsKeyError, base64Url, createJwtProvider, importSigningKey, JWT_REFRESH_MS, signJwt } from "./jwt";

const pemOf = (der: ArrayBuffer): string => {
  const body = base64Url(new Uint8Array(der)).replace(/-/g, "+").replace(/_/g, "/");
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  const lines = padded.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

const generateKeyPem = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return { pem: pemOf(der), publicKey: pair.publicKey };
};

const decodeSegment = (segment: string) => {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
};

const signatureBytes = (segment: string) => {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

describe("signJwt", () => {
  test("produces a header and payload apns accepts", async () => {
    const { pem } = await generateKeyPem();
    const key = await importSigningKey(pem);
    const jwt = await signJwt(key, { keyId: "KEYID12345", teamId: "TEAMID6789", issuedAt: 1700000000 });
    const [header, payload] = jwt.split(".");
    expect(decodeSegment(header as string)).toEqual({ alg: "ES256", kid: "KEYID12345", typ: "JWT" });
    expect(decodeSegment(payload as string)).toEqual({ iss: "TEAMID6789", iat: 1700000000 });
  });

  test("signs with es256 so the matching public key verifies it", async () => {
    const { pem, publicKey } = await generateKeyPem();
    const key = await importSigningKey(pem);
    const jwt = await signJwt(key, { keyId: "KEYID12345", teamId: "TEAMID6789", issuedAt: 1700000000 });
    const [header, payload, signature] = jwt.split(".");
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signatureBytes(signature as string),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(verified).toBe(true);
    expect(signatureBytes(signature as string).length).toBe(64);
  });

  test("rejects a key that is not a pkcs8 pem block", () => {
    expect(() => importSigningKey("not a key")).toThrow(ApnsKeyError);
  });
});

describe("createJwtProvider", () => {
  test("reuses one token until the refresh window closes", async () => {
    const { pem } = await generateKeyPem();
    const key = await importSigningKey(pem);
    let clock = 1_000_000;
    const provider = createJwtProvider(key, "KEYID12345", "TEAMID6789", () => clock);
    const first = await provider.token();
    clock += JWT_REFRESH_MS - 1000;
    expect(await provider.token()).toBe(first);
    clock += 2000;
    expect(await provider.token()).not.toBe(first);
  });

  test("mints once when several rings race", async () => {
    const { pem } = await generateKeyPem();
    const key = await importSigningKey(pem);
    const provider = createJwtProvider(key, "KEYID12345", "TEAMID6789", () => 1_000_000);
    const [a, b, c] = await Promise.all([provider.token(), provider.token(), provider.token()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
