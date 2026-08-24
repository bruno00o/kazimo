export const PAIRING_QR_KIND = "kazimo-pair";
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const PAIRING_GROUP_SIZE = 4;

export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function formatPairingCode(code: string): string {
  const compact = normalizePairingCode(code);
  if (compact.length <= PAIRING_GROUP_SIZE) return compact;
  return `${compact.slice(0, PAIRING_GROUP_SIZE)}-${compact.slice(PAIRING_GROUP_SIZE)}`;
}

export function codesMatch(a: string, b: string): boolean {
  const left = normalizePairingCode(a);
  return left.length === PAIRING_CODE_LENGTH && left === normalizePairingCode(b);
}

export function pairingQrPayload(userId: string, code: string): string {
  return JSON.stringify({ k: PAIRING_QR_KIND, u: userId, c: normalizePairingCode(code) });
}
