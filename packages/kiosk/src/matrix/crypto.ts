import type { MatrixClient } from "matrix-js-sdk";
import { type CryptoCallbacks, deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api";

export function secretStorageCallbacks(passphrase: string | null): CryptoCallbacks {
  let cached: { keyId: string; key: Uint8Array<ArrayBuffer> } | null = null;

  return {
    getSecretStorageKey: async ({ keys }) => {
      if (cached && keys[cached.keyId]) return [cached.keyId, cached.key];
      if (!passphrase) return null;
      for (const [keyId, info] of Object.entries(keys)) {
        const derivation = info.passphrase;
        if (!derivation?.salt || !derivation.iterations) continue;
        const key = await deriveRecoveryKeyFromPassphrase(passphrase, derivation.salt, derivation.iterations);
        cached = { keyId, key };
        return [keyId, key];
      }
      return null;
    },
    cacheSecretStorageKey: (keyId, _keyInfo, key) => {
      cached = { keyId, key };
    },
  };
}

export async function ensureCryptoIdentity(matrix: MatrixClient, passphrase: string | null): Promise<void> {
  const crypto = matrix.getCrypto();
  if (!crypto || !passphrase) return;

  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: (makeRequest) => makeRequest(null),
  });

  await crypto.bootstrapSecretStorage({
    createSecretStorageKey: () => crypto.createRecoveryKeyFromPassphrase(passphrase),
  });

  const backup = await crypto.checkKeyBackupAndEnable();
  if (!backup) {
    await crypto.resetKeyBackup();
    return;
  }

  if (!(await crypto.getSessionBackupPrivateKey())) {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    const restored = await crypto.restoreKeyBackup();
    console.log(`key backup restored: ${restored.imported}/${restored.total} keys`);
  }
}
