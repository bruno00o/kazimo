const PEM_BODY = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/;

export const JWT_REFRESH_MS = 45 * 60 * 1000;

export class ApnsKeyError extends Error {}

export const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const encodeSegment = (value: object): string => base64Url(new TextEncoder().encode(JSON.stringify(value)));

export const pkcs8FromPem = (pem: string): Uint8Array<ArrayBuffer> => {
  const match = pem.match(PEM_BODY);
  if (!match?.[1]) throw new ApnsKeyError("the signing key is not a PKCS8 PEM block");
  const binary = atob(match[1].replace(/\s+/g, ""));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const importSigningKey = (pem: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("pkcs8", pkcs8FromPem(pem), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);

export interface JwtClaims {
  keyId: string;
  teamId: string;
  issuedAt: number;
}

export const signJwt = async (key: CryptoKey, claims: JwtClaims): Promise<string> => {
  const header = encodeSegment({ alg: "ES256", kid: claims.keyId, typ: "JWT" });
  const payload = encodeSegment({ iss: claims.teamId, iat: claims.issuedAt });
  const signed = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
};

export interface JwtProvider {
  readonly token: () => Promise<string>;
}

export const createJwtProvider = (
  key: CryptoKey,
  keyId: string,
  teamId: string,
  now: () => number = Date.now,
): JwtProvider => {
  let cached: { value: string; mintedAt: number } | null = null;
  let minting: Promise<string> | null = null;
  return {
    token: async () => {
      const at = now();
      if (cached && at - cached.mintedAt < JWT_REFRESH_MS) return cached.value;
      if (minting) return minting;
      minting = signJwt(key, { keyId, teamId, issuedAt: Math.floor(at / 1000) })
        .then((value) => {
          cached = { value, mintedAt: at };
          return value;
        })
        .finally(() => {
          minting = null;
        });
      return minting;
    },
  };
};
