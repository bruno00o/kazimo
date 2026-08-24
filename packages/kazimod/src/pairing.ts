import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from "@kazimo/shared";

const BYTE_RANGE = 256;
const UNBIASED_LIMIT = BYTE_RANGE - (BYTE_RANGE % PAIRING_CODE_ALPHABET.length);

export function generatePairingCode(): string {
  const chars: string[] = [];
  const bytes = new Uint8Array(PAIRING_CODE_LENGTH);
  while (chars.length < PAIRING_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) continue;
      const char = PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
      if (char === undefined) continue;
      chars.push(char);
      if (chars.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return chars.join("");
}
